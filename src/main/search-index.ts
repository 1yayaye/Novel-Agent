import { createHash, randomUUID } from 'node:crypto'
import { sep } from 'node:path'
import type Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { splitIntoChunks } from './chunker'
import { ProjectError, ProjectStore } from './project-store'
import type { ConnectionStore } from './connection-store'
import type { ModelGateway } from './model-gateway'
import type {
  HybridSearchInput,
  IndexStatusResult,
  KeywordSearchInput,
  RebuildIndexResult,
  SearchResultItem,
  SearchSourceType,
  VectorIndexMeta
} from '../shared/project'

type DatabaseHandle = Database.Database

interface FtsMatchRow {
  rowid: number
  source_type: SearchSourceType
  source_id: string
  title: string
  content: string
  snippet_text: string | null
  rank: number
}

function ensureSqliteVecLoaded(db: DatabaseHandle): boolean {
  try {
    db.loadExtension(sqliteVec.getLoadablePath())
    return true
  } catch {
    return false
  }
}

function escapeLike(str: string): string {
  return str.replace(/([%_\\])/g, '\\$1')
}

function escapeFts5Query(query: string): string {
  // Wrap in double quotes and escape internal quotes for trigram exact sequence match
  const sanitized = query.replace(/"/g, '""')
  return `"${sanitized}"`
}

/**
 * Generate a clean text excerpt with highlight offsets around the match.
 */
function createExcerpt(text: string, query: string, maxWindow = 120): { excerpt: string; highlightOffsets: Array<[number, number]>; matchOffsetInText: number } {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let matchIndex = lowerText.indexOf(lowerQuery)
  if (matchIndex === -1) {
    matchIndex = 0
  }

  const queryLen = query.length
  const halfWindow = Math.floor((maxWindow - queryLen) / 2)
  let start = Math.max(0, matchIndex - halfWindow)
  let end = Math.min(text.length, matchIndex + queryLen + halfWindow)

  let prefix = ''
  let suffix = ''
  if (start > 0) {
    prefix = '...'
  }
  if (end < text.length) {
    suffix = '...'
  }

  const rawSnippet = text.slice(start, end)
  const excerpt = `${prefix}${rawSnippet}${suffix}`

  const highlightStart = prefix.length + (matchIndex - start)
  const highlightEnd = highlightStart + queryLen

  const highlightOffsets: Array<[number, number]> = [[highlightStart, highlightEnd]]

  return {
    excerpt,
    highlightOffsets,
    matchOffsetInText: matchIndex
  }
}

export class SearchIndex {
  private readonly syncQueues = new Map<string, Promise<unknown>>()
  private readonly vectorQueues = new Map<string, Promise<unknown>>()
  private modelGateway?: ModelGateway
  private connectionStore?: ConnectionStore

  constructor(
    private readonly store: ProjectStore,
    modelGateway?: ModelGateway,
    connectionStore?: ConnectionStore
  ) {
    this.modelGateway = modelGateway
    this.connectionStore = connectionStore
  }

  setModelGateway(modelGateway: ModelGateway): void {
    this.modelGateway = modelGateway
  }

  setConnectionStore(connectionStore: ConnectionStore): void {
    this.connectionStore = connectionStore
  }

  /**
   * Get the current status of the search index (both FTS and Vector).
   */
  getStatus(sessionId: string): IndexStatusResult {
    return this.store.read(sessionId, (db) => {
      const meta = db.prepare('SELECT search_revision, indexed_revision, search_index_error FROM project_meta LIMIT 1').get() as {
        search_revision: number
        indexed_revision: number
        search_index_error: string | null
      } | undefined

      if (!meta) {
        throw new ProjectError('DATABASE_ERROR', '缺少项目元数据')
      }

      const vecMetaRow = db.prepare('SELECT embedding_connection_fingerprint, model, dimensions, state, processed_count, total_count, last_error, updated_at FROM vector_index_meta WHERE id = 1 LIMIT 1').get() as {
        embedding_connection_fingerprint: string | null
        model: string | null
        dimensions: number | null
        state: 'missing' | 'building' | 'ready' | 'stale' | 'failed'
        processed_count: number
        total_count: number
        last_error: string | null
        updated_at: number
      } | undefined

      const vectorMeta: VectorIndexMeta | undefined = vecMetaRow
        ? {
            embeddingConnectionFingerprint: vecMetaRow.embedding_connection_fingerprint,
            model: vecMetaRow.model,
            dimensions: vecMetaRow.dimensions,
            state: vecMetaRow.state,
            processedCount: vecMetaRow.processed_count,
            totalCount: vecMetaRow.total_count,
            lastError: vecMetaRow.last_error,
            updatedAt: vecMetaRow.updated_at
          }
        : undefined

      return {
        state: meta.search_revision === meta.indexed_revision ? 'current' : 'needs_rebuild',
        searchRevision: meta.search_revision,
        indexedRevision: meta.indexed_revision,
        lastError: meta.search_index_error,
        vectorMeta
      }
    })
  }

  /**
   * Enqueue a serial background sync job for FTS and optional vector indexing.
   */
  sync(sessionId: string, connectionId?: string): Promise<void> {
    const currentQueue = this.syncQueues.get(sessionId) ?? Promise.resolve()
    const ftsWork = currentQueue.then(() => {
      try {
        this.executeSync(sessionId)
        return true
      } catch (err) {
        // Record masked error without rolling back author data
        const errMsg = err instanceof Error ? err.message : String(err)
        try {
          this.store.transaction(sessionId, (db) => {
            db.prepare('UPDATE project_meta SET search_index_error = ?').run(errMsg)
          })
        } catch {}
        return false
      }
    })
    const nextQueue = ftsWork.finally(() => {
      if (this.syncQueues.get(sessionId) === nextQueue) {
        this.syncQueues.delete(sessionId)
      }
    })

    this.syncQueues.set(sessionId, nextQueue)
    if (!this.modelGateway || !this.connectionStore) {
      return nextQueue.then(() => undefined)
    }

    const currentVectorQueue = this.vectorQueues.get(sessionId) ?? Promise.resolve()
    const vectorWork = currentVectorQueue.then(async () => {
      if (await ftsWork) {
        try {
          await this.syncVector(sessionId, connectionId)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          try {
            this.store.transaction(sessionId, (db) => {
              db.prepare('UPDATE project_meta SET search_index_error = ?').run(errMsg)
            })
          } catch {}
        }
      }
    })
    const nextVectorQueue = vectorWork.finally(() => {
      if (this.vectorQueues.get(sessionId) === nextVectorQueue) {
        this.vectorQueues.delete(sessionId)
      }
    })
    this.vectorQueues.set(sessionId, nextVectorQueue)
    return nextVectorQueue
  }

  /**
   * Rebuild the entire FTS search index and vector index from scratch.
   */
  async rebuild(sessionId: string, includeVector = true): Promise<RebuildIndexResult> {
    const currentQueue = this.syncQueues.get(sessionId) ?? Promise.resolve()
    const rebuildWork = currentQueue.then(() => this.executeRebuild(sessionId))
    const nextQueue = rebuildWork.catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      try {
        this.store.transaction(sessionId, (db) => {
          db.prepare('UPDATE project_meta SET search_index_error = ?').run(errMsg)
        })
      } catch {}
    }).finally(() => {
      if (this.syncQueues.get(sessionId) === nextQueue) {
        this.syncQueues.delete(sessionId)
      }
    })
    this.syncQueues.set(sessionId, nextQueue)

    if (!includeVector || !this.modelGateway || !this.connectionStore) {
      return rebuildWork
    }

    const currentVectorQueue = this.vectorQueues.get(sessionId) ?? Promise.resolve()
    const vectorWork = currentVectorQueue.then(async () => {
      const result = await rebuildWork
      await this.syncVector(sessionId)
      return result
    })
    const nextVectorQueue = vectorWork.catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      try {
        this.store.transaction(sessionId, (db) => {
          db.prepare('UPDATE project_meta SET search_index_error = ?').run(errMsg)
        })
      } catch {}
    }).finally(() => {
      if (this.vectorQueues.get(sessionId) === nextVectorQueue) {
        this.vectorQueues.delete(sessionId)
      }
    })
    this.vectorQueues.set(sessionId, nextVectorQueue)
    return vectorWork
  }

  /**
   * Background Vector Index synchronization with batching, checkpointing and state tracking.
   */
  async syncVector(sessionId: string, explicitConnectionId?: string): Promise<void> {
    if (!this.modelGateway || !this.connectionStore) {
      return
    }

    // 1. Determine connection to use
    let targetConnectionId = explicitConnectionId
    if (!targetConnectionId) {
      // Check connections for an 'embeddings' connection
      const connections = this.connectionStore.list()
      const embConn = connections.find((c) => c.kind === 'embedding')
      if (embConn) {
        targetConnectionId = embConn.id
      }
    }

    if (!targetConnectionId) {
      this.store.transaction(sessionId, (db) => {
        db.prepare("UPDATE vector_index_meta SET state = 'missing', updated_at = ? WHERE id = 1").run(Date.now())
      })
      return
    }

    let connectionSummary: { id: string; baseUrl: string; model: string; batchSize: number; recentDimensions?: number | null } | undefined
    try {
      const { connection } = this.connectionStore.getInternal(targetConnectionId)
      connectionSummary = connection
    } catch {
      this.store.transaction(sessionId, (db) => {
        db.prepare("UPDATE vector_index_meta SET state = 'missing', updated_at = ? WHERE id = 1").run(Date.now())
      })
      return
    }

    const fingerprint = createHash('sha256').update(`${connectionSummary.baseUrl}:${connectionSummary.model}`).digest('hex').slice(0, 24)

    // 2. Prepare database & verify existing metadata
    let shouldReset = false
    let currentDimensions: number | null = null
    let lastVectorUpdatedAt = 0

    this.store.read(sessionId, (db) => {
      ensureSqliteVecLoaded(db)
      const meta = db.prepare('SELECT embedding_connection_fingerprint, model, dimensions, state, updated_at FROM vector_index_meta WHERE id = 1').get() as {
        embedding_connection_fingerprint: string | null
        model: string | null
        dimensions: number | null
        state: string
        updated_at: number
      } | undefined

      if (meta) {
        lastVectorUpdatedAt = meta.updated_at
        if (meta.embedding_connection_fingerprint !== fingerprint || meta.model !== connectionSummary!.model) {
          shouldReset = true
        } else {
          currentDimensions = meta.dimensions
        }
      }
    })

    if (shouldReset) {
      this.store.transaction(sessionId, (db) => {
        ensureSqliteVecLoaded(db)
        try {
          db.exec('DROP TABLE IF EXISTS content_vector')
        } catch {}
        db.prepare(`
          UPDATE vector_index_meta
          SET embedding_connection_fingerprint = ?, model = ?, dimensions = NULL,
              state = 'building', processed_count = 0, total_count = 0, last_error = NULL, updated_at = ?
          WHERE id = 1
        `).run(fingerprint, connectionSummary!.model, Date.now())
      })
      currentDimensions = null
    }

    // 3. Find all candidate units needing vectors
    const candidateUnits = this.store.read(sessionId, (db) => {
      ensureSqliteVecLoaded(db)
      const hasVectorTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_vector'").get() !== undefined

      const rows = db.prepare(`
        SELECT s.rowid, s.source_type, s.source_id,
               CASE
                 WHEN s.source_type = 'chapter_chunk' THEN cc.content
                 WHEN s.source_type = 'knowledge_entry' THEN ke.title || '\n' || ke.author_content
               END as text_content,
               CASE
                 WHEN s.source_type = 'chapter_chunk' THEN cc.created_at
                 WHEN s.source_type = 'knowledge_entry' THEN ke.updated_at
               END as source_updated_at
        FROM search_rowid s
        LEFT JOIN content_chunk cc ON cc.id = s.source_id AND cc.state = 'current'
        LEFT JOIN chapter ch ON ch.id = cc.chapter_id AND ch.deleted_at IS NULL
        LEFT JOIN knowledge_entry ke ON ke.id = s.source_id AND ke.state = 'active'
        WHERE (s.source_type = 'chapter_chunk' AND cc.id IS NOT NULL)
           OR (s.source_type = 'knowledge_entry' AND ke.id IS NOT NULL AND length(trim(ke.author_content)) > 0)
      `).all() as Array<{
        rowid: number
        source_type: SearchSourceType
        source_id: string
        text_content: string | null
        source_updated_at: number | null
      }>

      if (!hasVectorTable) {
        return rows.filter((r) => r.text_content && r.text_content.trim().length > 0)
      }

      // Check which rowids already exist in content_vector
      const existingRowids = new Set<number>()
      try {
        const existing = db.prepare('SELECT rowid FROM content_vector').all() as Array<{ rowid: number }>
        for (const e of existing) {
          existingRowids.add(e.rowid)
        }
      } catch {}

      return rows.filter((r) => r.text_content && r.text_content.trim().length > 0 && (
        !existingRowids.has(r.rowid) || (r.source_updated_at ?? 0) >= lastVectorUpdatedAt
      ))
    })

    const totalCount = this.store.read(sessionId, (db) => {
      const countRow = db.prepare(`
        SELECT count(*) as count
        FROM search_rowid s
        LEFT JOIN content_chunk cc ON cc.id = s.source_id AND cc.state = 'current'
        LEFT JOIN chapter ch ON ch.id = cc.chapter_id AND ch.deleted_at IS NULL
        LEFT JOIN knowledge_entry ke ON ke.id = s.source_id AND ke.state = 'active'
        WHERE (s.source_type = 'chapter_chunk' AND cc.id IS NOT NULL)
           OR (s.source_type = 'knowledge_entry' AND ke.id IS NOT NULL AND length(trim(ke.author_content)) > 0)
      `).get() as { count: number }
      return countRow.count
    })

    if (candidateUnits.length === 0) {
      this.store.transaction(sessionId, (db) => {
        db.prepare(`
          UPDATE vector_index_meta
          SET embedding_connection_fingerprint = ?, model = ?, state = 'ready',
              processed_count = ?, total_count = ?, last_error = NULL, updated_at = ?
          WHERE id = 1
        `).run(fingerprint, connectionSummary!.model, totalCount, totalCount, Date.now())
      })
      return
    }

    // 4. Process candidates in batches
    const batchSize = Math.max(1, Math.min(connectionSummary.batchSize || 16, 64))
    let processed = totalCount - candidateUnits.length

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        UPDATE vector_index_meta
        SET embedding_connection_fingerprint = ?, model = ?, state = 'building',
            processed_count = ?, total_count = ?, last_error = NULL, updated_at = ?
        WHERE id = 1
      `).run(fingerprint, connectionSummary!.model, processed, totalCount, Date.now())
    })

    for (let i = 0; i < candidateUnits.length; i += batchSize) {
      const batch = candidateUnits.slice(i, i + batchSize)
      const texts = batch.map((b) => b.text_content!)

      try {
        const embResult = await this.modelGateway.createEmbeddings({
          connectionId: targetConnectionId,
          texts,
          isContentRequest: true
        })

        const currentBatch = this.store.read(sessionId, (db) => {
          const placeholders = batch.map(() => '?').join(', ')
          return db.prepare(`
            SELECT s.rowid, s.source_type, s.source_id,
                   CASE
                     WHEN s.source_type = 'chapter_chunk' THEN cc.content
                     WHEN s.source_type = 'knowledge_entry' THEN ke.title || '\n' || ke.author_content
                   END as text_content
            FROM search_rowid s
            LEFT JOIN content_chunk cc ON cc.id = s.source_id AND cc.state = 'current'
            LEFT JOIN knowledge_entry ke ON ke.id = s.source_id AND ke.state = 'active'
            WHERE s.rowid IN (${placeholders})
          `).all(...batch.map((item) => item.rowid)) as Array<{
            rowid: number
            source_type: SearchSourceType
            source_id: string
            text_content: string | null
          }>
        })
        const currentByRowid = new Map(currentBatch.map((row) => [row.rowid, row]))
        const sourceChanged = batch.some((item) => {
          const current = currentByRowid.get(item.rowid)
          return !current || current.source_type !== item.source_type || current.source_id !== item.source_id || current.text_content !== item.text_content
        })

        if (sourceChanged) {
          this.store.transaction(sessionId, (db) => {
            const hasVectorTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_vector'").get() !== undefined
            if (hasVectorTable) {
              const deleteVec = db.prepare('DELETE FROM content_vector WHERE rowid = ?')
              for (const item of batch) deleteVec.run(BigInt(item.rowid))
            }
            db.prepare(`
              UPDATE vector_index_meta
              SET state = 'stale', processed_count = ?, total_count = ?, last_error = NULL, updated_at = ?
              WHERE id = 1
            `).run(processed, totalCount, Date.now())
          })
          continue
        }

        const dims = embResult.dimensions

        // Ensure virtual table exists before starting batch transaction
        this.store.read(sessionId, (db) => {
          ensureSqliteVecLoaded(db)
          if (!currentDimensions || currentDimensions !== dims) {
            currentDimensions = dims
            try {
              db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS content_vector USING vec0(embedding float[${dims}])`)
            } catch {}
          }
        })

        // Transactionally save batch
        this.store.transaction(sessionId, (db) => {
          const insertVec = db.prepare('INSERT OR REPLACE INTO content_vector(rowid, embedding) VALUES (?, ?)')
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j]
            const vec = embResult.embeddings[j]
            insertVec.run(BigInt(item.rowid), JSON.stringify(vec))
          }

          processed += batch.length
          const isComplete = processed >= totalCount
          db.prepare(`
            UPDATE vector_index_meta
            SET dimensions = ?, state = ?, processed_count = ?, total_count = ?,
                last_error = NULL, updated_at = ?
            WHERE id = 1
          `).run(dims, isComplete ? 'ready' : 'building', processed, totalCount, Date.now())
        })
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.store.transaction(sessionId, (db) => {
          db.prepare(`
            UPDATE vector_index_meta
            SET state = 'failed', last_error = ?, updated_at = ?
            WHERE id = 1
          `).run(errMsg, Date.now())
        })
        break
      }
    }
  }

  private executeSync(sessionId: string): void {
    // 1. Capture target search_revision before indexing
    let targetRevision = 0
    let metaId = ''
    let creativeRules = ''

    this.store.read(sessionId, (db) => {
      const meta = db.prepare('SELECT id, creative_rules, search_revision FROM project_meta LIMIT 1').get() as {
        id: string
        creative_rules: string
        search_revision: number
      }
      targetRevision = meta.search_revision
      metaId = meta.id
      creativeRules = meta.creative_rules
    })

    // 2. Perform indexing in transaction
    this.store.transaction(sessionId, (db) => {
      // Find all active chapters
      const chapters = db.prepare('SELECT id, title, content, version FROM chapter WHERE deleted_at IS NULL ORDER BY position').all() as Array<{
        id: string
        title: string
        content: string
        version: number
      }>

      const activeChapterIds = new Set(chapters.map((c) => c.id))

      // Clean up search rows for deleted chapters
      const oldChunkRows = db.prepare("SELECT rowid, source_id FROM search_rowid WHERE source_type = 'chapter_chunk'").all() as Array<{
        rowid: number
        source_id: string
      }>

      // Check existing content_chunks
      const existingChunks = db.prepare("SELECT id, chapter_id, chapter_version, state FROM content_chunk WHERE source_type = 'chapter'").all() as Array<{
        id: string
        chapter_id: string
        chapter_version: number
        state: string
      }>

      const chunkMap = new Map<string, typeof existingChunks[0]>()
      for (const ch of existingChunks) {
        chunkMap.set(ch.id, ch)
      }

      const deleteContentFtsStmt = db.prepare('DELETE FROM content_fts WHERE rowid = ?')
      const deleteSearchRowidStmt = db.prepare('DELETE FROM search_rowid WHERE rowid = ?')

      for (const row of oldChunkRows) {
        const chunk = chunkMap.get(row.source_id)
        if (!chunk || !activeChapterIds.has(chunk.chapter_id) || chunk.state === 'stale') {
          deleteContentFtsStmt.run(row.rowid)
          deleteSearchRowidStmt.run(row.rowid)
        }
      }

      // Pre-compiled statements hoisted outside loops
      const selectCurrentChunksStmt = db.prepare("SELECT id FROM content_chunk WHERE chapter_id = ? AND state = 'current' AND chunk_kind = 'temporary'")
      const insertContentChunkStmt = db.prepare(`
        INSERT INTO content_chunk(id, source_type, source_id, chapter_id, chapter_version, chunk_kind, start_offset, end_offset, content, state, created_at)
        VALUES (?, 'chapter', ?, ?, ?, 'temporary', ?, ?, ?, 'current', ?)
      `)
      const upsertSearchRowidChunkStmt = db.prepare(`
        INSERT INTO search_rowid(source_type, source_id)
        VALUES ('chapter_chunk', ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET source_id = excluded.source_id
        RETURNING rowid
      `)
      const insertContentFtsStmt = db.prepare('INSERT INTO content_fts(rowid, title, content, source_type) VALUES (?, ?, ?, ?)')
      const upsertCreativeRulesRowidStmt = db.prepare(`
        INSERT INTO search_rowid(source_type, source_id)
        VALUES ('creative_rules', ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET source_id = excluded.source_id
        RETURNING rowid
      `)
      const selectCreativeRulesRowidStmt = db.prepare("SELECT rowid FROM search_rowid WHERE source_type = 'creative_rules' AND source_id = ?")
      const upsertStyleSampleRowidStmt = db.prepare(`
        INSERT INTO search_rowid(source_type, source_id)
        VALUES ('style_sample', ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET source_id = excluded.source_id
        RETURNING rowid
      `)
      const upsertKnowledgeRowidStmt = db.prepare(`
        INSERT INTO search_rowid(source_type, source_id)
        VALUES ('knowledge_entry', ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET source_id = excluded.source_id
        RETURNING rowid
      `)
      const updateProjectMetaRevisionStmt = db.prepare(`
        UPDATE project_meta
        SET indexed_revision = ?, search_index_error = NULL
        WHERE search_revision = ?
      `)

      // Re-index each active chapter if it lacks current chunks
      for (const chap of chapters) {
        const currentChunks = selectCurrentChunksStmt.all(chap.id) as Array<{ id: string }>
        if (currentChunks.length === 0 && chap.content.length > 0) {
          // Generate new chunks
          const newChunks = splitIntoChunks(chap.content)
          const now = Date.now()
          for (const chunk of newChunks) {
            insertContentChunkStmt.run(chunk.id, chap.id, chap.id, chap.version, chunk.startOffset, chunk.endOffset, chunk.content, now)
            const row = upsertSearchRowidChunkStmt.get(chunk.id) as { rowid: number }
            deleteContentFtsStmt.run(row.rowid)
            insertContentFtsStmt.run(
              row.rowid,
              chap.title,
              chunk.content,
              'chapter_chunk'
            )
          }
        }
      }

      // Sync creative rules
      if (creativeRules.trim().length > 0) {
        const row = upsertCreativeRulesRowidStmt.get(metaId) as { rowid: number }
        deleteContentFtsStmt.run(row.rowid)
        insertContentFtsStmt.run(
          row.rowid,
          '创作规则',
          creativeRules,
          'creative_rules'
        )
      } else {
        const row = selectCreativeRulesRowidStmt.get(metaId) as { rowid: number } | undefined
        if (row) {
          deleteContentFtsStmt.run(row.rowid)
          deleteSearchRowidStmt.run(row.rowid)
        }
      }

      // Sync style samples
      const styleSamples = db.prepare('SELECT id, name, content FROM style_sample').all() as Array<{ id: string; name: string; content: string }>
      const activeSampleIds = new Set(styleSamples.map((s) => s.id))
      const oldSampleRows = db.prepare("SELECT rowid, source_id FROM search_rowid WHERE source_type = 'style_sample'").all() as Array<{
        rowid: number
        source_id: string
      }>
      for (const row of oldSampleRows) {
        if (!activeSampleIds.has(row.source_id)) {
          deleteContentFtsStmt.run(row.rowid)
          deleteSearchRowidStmt.run(row.rowid)
        }
      }

      for (const sample of styleSamples) {
        const row = upsertStyleSampleRowidStmt.get(sample.id) as { rowid: number }
        deleteContentFtsStmt.run(row.rowid)
        insertContentFtsStmt.run(
          row.rowid,
          sample.name,
          sample.content,
          'style_sample'
        )
      }

      // Sync active knowledge entries
      const knowledgeEntries = db.prepare("SELECT id, title, author_content FROM knowledge_entry WHERE state = 'active'").all() as Array<{ id: string; title: string; author_content: string }>
      const activeEntryIds = new Set(knowledgeEntries.filter((e) => e.author_content.trim().length > 0).map((e) => e.id))
      const oldEntryRows = db.prepare("SELECT rowid, source_id FROM search_rowid WHERE source_type = 'knowledge_entry'").all() as Array<{
        rowid: number
        source_id: string
      }>
      for (const row of oldEntryRows) {
        if (!activeEntryIds.has(row.source_id)) {
          deleteContentFtsStmt.run(row.rowid)
          deleteSearchRowidStmt.run(row.rowid)
        }
      }

      for (const entry of knowledgeEntries) {
        if (entry.author_content.trim().length > 0) {
          const row = upsertKnowledgeRowidStmt.get(entry.id) as { rowid: number }
          deleteContentFtsStmt.run(row.rowid)
          insertContentFtsStmt.run(
            row.rowid,
            entry.title,
            entry.author_content,
            'knowledge_entry'
          )
        }
      }

      // Advance indexed_revision only if search_revision hasn't changed
      updateProjectMetaRevisionStmt.run(targetRevision, targetRevision)
    })
  }

  private executeRebuild(sessionId: string): RebuildIndexResult {
    let targetRevision = 0
    this.store.transaction(sessionId, (db) => {
      const meta = db.prepare('SELECT id, creative_rules, search_revision FROM project_meta LIMIT 1').get() as {
        id: string
        creative_rules: string
        search_revision: number
      }
      targetRevision = meta.search_revision

      // 1. Wipe search_rowid, content_fts, and stale content_chunks
      db.prepare('DELETE FROM content_fts').run()
      db.prepare('DELETE FROM search_rowid').run()
      db.prepare("DELETE FROM content_chunk WHERE chunk_kind = 'temporary'").run()

      // 2. Re-chunk all active chapters
      const chapters = db.prepare('SELECT id, title, content, version FROM chapter WHERE deleted_at IS NULL ORDER BY position').all() as Array<{
        id: string
        title: string
        content: string
        version: number
      }>

      // Pre-compiled statements for rebuild
      const insertContentChunkStmt = db.prepare(`
        INSERT INTO content_chunk(id, source_type, source_id, chapter_id, chapter_version, chunk_kind, start_offset, end_offset, content, state, created_at)
        VALUES (?, 'chapter', ?, ?, ?, 'temporary', ?, ?, ?, 'current', ?)
      `)
      const insertSearchRowidChunkStmt = db.prepare(`
        INSERT INTO search_rowid(source_type, source_id)
        VALUES ('chapter_chunk', ?)
      `)
      const insertContentFtsStmt = db.prepare('INSERT INTO content_fts(rowid, title, content, source_type) VALUES (?, ?, ?, ?)')
      const insertSearchRowidRulesStmt = db.prepare("INSERT INTO search_rowid(source_type, source_id) VALUES ('creative_rules', ?)")
      const insertSearchRowidStyleStmt = db.prepare("INSERT INTO search_rowid(source_type, source_id) VALUES ('style_sample', ?)")
      const insertSearchRowidKnowledgeStmt = db.prepare("INSERT INTO search_rowid(source_type, source_id) VALUES ('knowledge_entry', ?)")
      const updateProjectMetaRevisionStmt = db.prepare(`
        UPDATE project_meta
        SET indexed_revision = ?, search_index_error = NULL
        WHERE search_revision = ?
      `)

      const now = Date.now()
      for (const chap of chapters) {
        const chunks = splitIntoChunks(chap.content)
        for (const chunk of chunks) {
          insertContentChunkStmt.run(chunk.id, chap.id, chap.id, chap.version, chunk.startOffset, chunk.endOffset, chunk.content, now)
          const info = insertSearchRowidChunkStmt.run(chunk.id)
          insertContentFtsStmt.run(
            Number(info.lastInsertRowid),
            chap.title,
            chunk.content,
            'chapter_chunk'
          )
        }
      }

      // 3. Re-index creative rules
      if (meta.creative_rules.trim().length > 0) {
        const info = insertSearchRowidRulesStmt.run(meta.id)
        insertContentFtsStmt.run(
          Number(info.lastInsertRowid),
          '创作规则',
          meta.creative_rules,
          'creative_rules'
        )
      }

      // 4. Re-index style samples
      const styleSamples = db.prepare('SELECT id, name, content FROM style_sample').all() as Array<{ id: string; name: string; content: string }>
      for (const sample of styleSamples) {
        const info = insertSearchRowidStyleStmt.run(sample.id)
        insertContentFtsStmt.run(
          Number(info.lastInsertRowid),
          sample.name,
          sample.content,
          'style_sample'
        )
      }

      // 5. Re-index active knowledge entries
      const knowledgeEntries = db.prepare("SELECT id, title, author_content FROM knowledge_entry WHERE state = 'active'").all() as Array<{ id: string; title: string; author_content: string }>
      for (const entry of knowledgeEntries) {
        if (entry.author_content.trim().length > 0) {
          const info = insertSearchRowidKnowledgeStmt.run(entry.id)
          insertContentFtsStmt.run(
            Number(info.lastInsertRowid),
            entry.title,
            entry.author_content,
            'knowledge_entry'
          )
        }
      }

      // 6. Set indexed_revision = targetRevision
      updateProjectMetaRevisionStmt.run(targetRevision, targetRevision)
    })

    const finalStatus = this.getStatus(sessionId)
    return {
      success: true,
      searchRevision: finalStatus.searchRevision,
      indexedRevision: finalStatus.indexedRevision
    }
  }

  /**
   * Search keywords using FTS5 (>= 3 chars) or LIKE (< 3 chars).
   */
  searchKeyword(sessionId: string, input: KeywordSearchInput): SearchResultItem[] {
    const query = input.query.trim()
    if (!query) return []
    const limit = Math.min(input.limit ?? 100, 100)
    const filters = input.filters

    return this.store.read(sessionId, (db) => {
      let candidateResults: Array<{
        id: string
        sourceType: SearchSourceType
        sourceId: string // parent id (chapterId, entryId, etc.)
        chunkId: string
        title: string
        content: string
        rank: number
        chapterId?: string
        startOffset?: number
      }> = []

      // If query length >= 3, use FTS5 trigram search
      if (query.length >= 3) {
        try {
          const ftsQuery = escapeFts5Query(query)
          const rows = db.prepare(`
            SELECT
              c.rowid,
              s.source_type,
              s.source_id,
              c.title,
              c.content,
              snippet(content_fts, 1, '<mark>', '</mark>', '...', 25) AS snippet_text,
              bm25(content_fts) AS rank
            FROM content_fts c
            JOIN search_rowid s ON s.rowid = c.rowid
            WHERE content_fts MATCH ?
            ORDER BY rank ASC
            LIMIT ?
          `).all(ftsQuery, limit * 3) as FtsMatchRow[]

          const chunkInfoStmt = db.prepare(`
            SELECT cc.id, cc.chapter_id, cc.start_offset
            FROM content_chunk cc
            JOIN chapter ch ON ch.id = cc.chapter_id AND ch.deleted_at IS NULL
            WHERE cc.id = ? AND cc.state = 'current'
          `)

          for (const row of rows) {
            if (filters?.sourceTypes && !filters.sourceTypes.includes(row.source_type)) {
              continue
            }

            if (row.source_type === 'chapter_chunk') {
              const chunkInfo = chunkInfoStmt.get(row.source_id) as { id: string; chapter_id: string; start_offset: number } | undefined

              if (!chunkInfo) continue
              if (filters?.chapterIds && !filters.chapterIds.includes(chunkInfo.chapter_id)) {
                continue
              }

              candidateResults.push({
                id: chunkInfo.id,
                sourceType: 'chapter_chunk',
                sourceId: chunkInfo.chapter_id,
                chunkId: chunkInfo.id,
                title: row.title,
                content: row.content,
                rank: row.rank,
                chapterId: chunkInfo.chapter_id,
                startOffset: chunkInfo.start_offset
              })
            } else if (row.source_type === 'creative_rules') {
              candidateResults.push({
                id: row.source_id,
                sourceType: 'creative_rules',
                sourceId: row.source_id,
                chunkId: row.source_id,
                title: row.title,
                content: row.content,
                rank: row.rank
              })
            } else if (row.source_type === 'style_sample') {
              candidateResults.push({
                id: row.source_id,
                sourceType: 'style_sample',
                sourceId: row.source_id,
                chunkId: row.source_id,
                title: row.title,
                content: row.content,
                rank: row.rank
              })
            } else if (row.source_type === 'knowledge_entry') {
              candidateResults.push({
                id: row.source_id,
                sourceType: 'knowledge_entry',
                sourceId: row.source_id,
                chunkId: row.source_id,
                title: row.title,
                content: row.content,
                rank: row.rank
              })
            }
          }
        } catch {
          // If FTS query fails for any syntax reason, fallback to LIKE below
          candidateResults = []
        }
      }

      // If query length < 3 (or FTS returned no rows / threw), fallback to parameterized LIKE
      if (query.length < 3 || candidateResults.length === 0) {
        const likePattern = `%${escapeLike(query)}%`

        // 1. Chapter chunks
        if (!filters?.sourceTypes || filters.sourceTypes.includes('chapter_chunk')) {
          const chunkRows = db.prepare(`
            SELECT
              cc.id,
              cc.chapter_id,
              cc.start_offset,
              cc.content,
              ch.title
            FROM content_chunk cc
            JOIN chapter ch ON ch.id = cc.chapter_id AND ch.deleted_at IS NULL
            WHERE cc.state = 'current'
              AND (cc.content LIKE ? ESCAPE '\\' OR ch.title LIKE ? ESCAPE '\\')
            ORDER BY ch.position ASC, cc.start_offset ASC
            LIMIT ?
          `).all(likePattern, likePattern, limit * 2) as Array<{
            id: string
            chapter_id: string
            start_offset: number
            content: string
            title: string
          }>

          for (const cr of chunkRows) {
            if (filters?.chapterIds && !filters.chapterIds.includes(cr.chapter_id)) {
              continue
            }
            candidateResults.push({
              id: cr.id,
              sourceType: 'chapter_chunk',
              sourceId: cr.chapter_id,
              chunkId: cr.id,
              title: cr.title,
              content: cr.content,
              rank: 0,
              chapterId: cr.chapter_id,
              startOffset: cr.start_offset
            })
          }
        }

        // 2. Creative rules
        if (!filters?.sourceTypes || filters.sourceTypes.includes('creative_rules')) {
          const meta = db.prepare('SELECT id, creative_rules FROM project_meta WHERE creative_rules LIKE ? ESCAPE \'\\\' LIMIT 1').get(likePattern) as {
            id: string
            creative_rules: string
          } | undefined

          if (meta) {
            candidateResults.push({
              id: meta.id,
              sourceType: 'creative_rules',
              sourceId: meta.id,
              chunkId: meta.id,
              title: '创作规则',
              content: meta.creative_rules,
              rank: 0
            })
          }
        }

        // 3. Style samples
        if (!filters?.sourceTypes || filters.sourceTypes.includes('style_sample')) {
          const samples = db.prepare('SELECT id, name, content FROM style_sample WHERE name LIKE ? ESCAPE \'\\\' OR content LIKE ? ESCAPE \'\\\' LIMIT ?').all(likePattern, likePattern, limit) as Array<{
            id: string
            name: string
            content: string
          }>

          for (const s of samples) {
            candidateResults.push({
              id: s.id,
              sourceType: 'style_sample',
              sourceId: s.id,
              chunkId: s.id,
              title: s.name,
              content: s.content,
              rank: 0
            })
          }
        }

        // 4. Knowledge entries
        if (!filters?.sourceTypes || filters.sourceTypes.includes('knowledge_entry')) {
          const entries = db.prepare("SELECT id, title, author_content FROM knowledge_entry WHERE state = 'active' AND (title LIKE ? ESCAPE '\\' OR author_content LIKE ? ESCAPE '\\') LIMIT ?").all(likePattern, likePattern, limit) as Array<{
            id: string
            title: string
            author_content: string
          }>

          for (const e of entries) {
            candidateResults.push({
              id: e.id,
              sourceType: 'knowledge_entry',
              sourceId: e.id,
              chunkId: e.id,
              title: e.title,
              content: e.author_content,
              rank: 0
            })
          }
        }
      }

      // Deduplicate by parent document: keep the best scoring unit for each parent sourceId
      const parentMap = new Map<string, typeof candidateResults[0]>()
      for (const item of candidateResults) {
        const key = `${item.sourceType}:${item.sourceId}`
        if (!parentMap.has(key)) {
          parentMap.set(key, item)
        } else {
          const existing = parentMap.get(key)!
          if (item.rank < existing.rank) {
            parentMap.set(key, item)
          }
        }
      }

      const deduplicated = Array.from(parentMap.values()).slice(0, limit)

      // Transform into SearchResultItem with excerpts and precise highlight offsets
      return deduplicated.map((item): SearchResultItem => {
        const { excerpt, highlightOffsets, matchOffsetInText } = createExcerpt(item.content, query)
        const targetOffset = item.startOffset !== undefined ? item.startOffset + matchOffsetInText : matchOffsetInText

        return {
          id: item.id,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          title: item.title,
          excerpt,
          highlightOffsets,
          score: item.rank,
          target: {
            chapterId: item.chapterId,
            offset: targetOffset,
            entryId: item.sourceType === 'knowledge_entry' ? item.sourceId : undefined
          }
        }
      })
    })
  }

  /**
   * Hybrid Search with FTS5, Vector Search (sqlite-vec) and Reciprocal Rank Fusion (RRF, k=60).
   * SPEC 7.6
   */
  async searchHybrid(sessionId: string, input: HybridSearchInput): Promise<SearchResultItem[]> {
    const query = input.query.trim()
    if (!query) return []
    const limit = Math.min(input.limit ?? 100, 100)
    const filters = input.filters

    // 1. FTS5 Keyword search top 30
    const ftsResults = this.searchKeyword(sessionId, {
      sessionId,
      query,
      limit: 30,
      filters
    })

    // 2. Vector search top 30 (if ready and available)
    let vectorResults: Array<{
      id: string
      sourceType: SearchSourceType
      sourceId: string
      chunkId: string
      title: string
      content: string
      distance: number
      chapterId?: string
      startOffset?: number
    }> = []

    const status = this.getStatus(sessionId)
    if (status.vectorMeta?.state === 'ready' && this.modelGateway && this.connectionStore) {
      let targetConnectionId = input.connectionId
      if (!targetConnectionId) {
        const embConn = this.connectionStore.list().find((c) => c.kind === 'embedding')
        if (embConn) targetConnectionId = embConn.id
      }

      if (targetConnectionId) {
        try {
          const timeoutSignal = AbortSignal.timeout(8_000)
          const embResult = await this.modelGateway.createEmbeddings({
            connectionId: targetConnectionId,
            texts: [query],
            isContentRequest: true,
            signal: timeoutSignal
          })

          if (embResult.embeddings.length > 0) {
            const queryVec = embResult.embeddings[0]
            vectorResults = this.store.read(sessionId, (db) => {
              ensureSqliteVecLoaded(db)
              const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_vector'").get() !== undefined
              if (!hasTable) return []

              const vecRows = db.prepare(`
                SELECT rowid, distance
                FROM content_vector
                WHERE embedding MATCH ?
                ORDER BY distance ASC
                LIMIT 30
              `).all(JSON.stringify(queryVec)) as Array<{
                rowid: number
                distance: number
              }>

              const getSearchRow = db.prepare('SELECT source_type, source_id FROM search_rowid WHERE rowid = ?')
              const chunkInfoStmt = db.prepare(`
                SELECT cc.id, cc.chapter_id, cc.start_offset, cc.content, ch.title
                FROM content_chunk cc
                JOIN chapter ch ON ch.id = cc.chapter_id AND ch.deleted_at IS NULL
                WHERE cc.id = ? AND cc.state = 'current'
              `)
              const entryStmt = db.prepare("SELECT id, title, author_content FROM knowledge_entry WHERE id = ? AND state = 'active'")
              const results: typeof vectorResults = []

              for (const vRow of vecRows) {
                const sRow = getSearchRow.get(vRow.rowid) as { source_type: SearchSourceType; source_id: string } | undefined
                if (!sRow) continue

                const row = {
                  rowid: vRow.rowid,
                  distance: vRow.distance,
                  source_type: sRow.source_type,
                  source_id: sRow.source_id
                }

                if (filters?.sourceTypes && !filters.sourceTypes.includes(row.source_type)) {
                  continue
                }

                if (row.source_type === 'chapter_chunk') {
                  const chunkInfo = chunkInfoStmt.get(row.source_id) as { id: string; chapter_id: string; start_offset: number; content: string; title: string } | undefined

                  if (!chunkInfo) continue
                  if (filters?.chapterIds && !filters.chapterIds.includes(chunkInfo.chapter_id)) {
                    continue
                  }

                  results.push({
                    id: chunkInfo.id,
                    sourceType: 'chapter_chunk',
                    sourceId: chunkInfo.chapter_id,
                    chunkId: chunkInfo.id,
                    title: chunkInfo.title,
                    content: chunkInfo.content,
                    distance: row.distance,
                    chapterId: chunkInfo.chapter_id,
                    startOffset: chunkInfo.start_offset
                  })
                } else if (row.source_type === 'knowledge_entry') {
                  const entry = entryStmt.get(row.source_id) as { id: string; title: string; author_content: string } | undefined
                  if (!entry) continue

                  results.push({
                    id: entry.id,
                    sourceType: 'knowledge_entry',
                    sourceId: entry.id,
                    chunkId: entry.id,
                    title: entry.title,
                    content: entry.author_content,
                    distance: row.distance
                  })
                }
              }
              return results
            })
          }
        } catch {
          // Graceful fallback to FTS only
          vectorResults = []
        }
      }
    }

    // 3. RRF Reciprocal Rank Fusion with k=60 (SPEC 7.6)
    const k = 60
    const wFts = 1.0
    const wVec = 1.0

    interface CandidateFusion {
      id: string
      sourceType: SearchSourceType
      sourceId: string
      title: string
      content: string
      chapterId?: string
      startOffset?: number
      ftsRank?: number
      vecRank?: number
      rrfScore: number
    }

    const fusionMap = new Map<string, CandidateFusion>()

    ftsResults.forEach((item, index) => {
      const key = `${item.sourceType}:${item.sourceId}`
      const rank = index + 1
      const score = wFts / (k + rank)

      fusionMap.set(key, {
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        content: item.excerpt,
        chapterId: item.target.chapterId,
        startOffset: item.target.offset,
        ftsRank: rank,
        rrfScore: score
      })
    })

    vectorResults.forEach((item, index) => {
      const key = `${item.sourceType}:${item.sourceId}`
      const rank = index + 1
      const score = wVec / (k + rank)

      const existing = fusionMap.get(key)
      if (existing) {
        existing.vecRank = rank
        existing.rrfScore += score
        if (item.content.length > existing.content.length) {
          existing.content = item.content
        }
      } else {
        fusionMap.set(key, {
          id: item.id,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          title: item.title,
          content: item.content,
          chapterId: item.chapterId,
          startOffset: item.startOffset,
          vecRank: rank,
          rrfScore: score
        })
      }
    })

    // 4. Authority Weight Boosts (SPEC 7.6)
    const allCandidates = Array.from(fusionMap.values())
    for (const cand of allCandidates) {
      if (cand.sourceType === 'knowledge_entry') {
        cand.rrfScore += 0.02
      }
    }

    // 5. Sort descending by RRF score
    allCandidates.sort((a, b) => b.rrfScore - a.rrfScore)
    const sliced = allCandidates.slice(0, limit)

    // 6. Format to SearchResultItem
    return sliced.map((item): SearchResultItem => {
      const { excerpt, highlightOffsets, matchOffsetInText } = createExcerpt(item.content, query)
      const targetOffset = item.startOffset !== undefined ? item.startOffset + matchOffsetInText : matchOffsetInText

      return {
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        excerpt,
        highlightOffsets,
        score: item.rrfScore,
        target: {
          chapterId: item.chapterId,
          offset: targetOffset,
          entryId: item.sourceType === 'knowledge_entry' ? item.sourceId : undefined
        }
      }
    })
  }
}
