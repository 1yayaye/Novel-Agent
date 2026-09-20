import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  AiFactSuggestion,
  CharacterRelationship,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeState,
  SourceEvidence,
  SuggestionAcceptanceDraft,
  SuggestionAcceptancePreview,
  SuggestionState,
  SuccessResult
} from '../shared/project'
import { ProjectError, ProjectStore } from './project-store'
import type { SearchIndex } from './search-index'

type KnowledgeEntryRow = {
  id: string
  knowledge_kind: KnowledgeKind
  title: string
  aliases_json: string
  author_content: string
  tags_json: string
  identity: string | null
  current_state: string | null
  narrative_order: number | null
  story_time: string | null
  relative_time: string | null
  time_uncertain: number | null
  foreshadow_state: string | null
  version: number
  state: KnowledgeState
  created_at: number
  updated_at: number
}

type CharacterRelationshipRow = {
  id: string
  from_character_id: string
  to_character_id: string
  relation_type: string
  description: string
  version: number
  created_at: number
  updated_at: number
  from_character_title?: string
  to_character_title?: string
}

type AiFactSuggestionRow = {
  id: string
  knowledge_entry_id: string | null
  knowledge_kind: KnowledgeKind
  normalized_subject: string
  predicate: string
  value_json: string
  display_text: string
  state: SuggestionState
  confidence: number | null
  analysis_task_id: string
  version: number
  created_at: number
  reviewed_at: number | null
}

type SourceEvidenceRow = {
  id: string
  owner_type: 'ai_fact_suggestion' | 'consistency_issue' | 'report_section'
  owner_id: string
  chapter_id: string
  chapter_version: number
  start_offset: number
  end_offset: number
  excerpt: string
  state: 'valid' | 'stale' | 'missing'
  created_at: number
  chapter_title?: string
}

function parseJsonArray(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapKnowledgeEntry(row: KnowledgeEntryRow): KnowledgeEntry {
  return {
    id: row.id,
    knowledgeKind: row.knowledge_kind,
    title: row.title,
    aliases: parseJsonArray(row.aliases_json),
    authorContent: row.author_content,
    tags: parseJsonArray(row.tags_json),
    identity: row.identity,
    currentState: row.current_state,
    narrativeOrder: row.narrative_order,
    storyTime: row.story_time,
    relativeTime: row.relative_time,
    timeUncertain: row.time_uncertain === null ? null : Boolean(row.time_uncertain),
    foreshadowState: row.foreshadow_state,
    version: row.version,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapCharacterRelationship(row: CharacterRelationshipRow): CharacterRelationship {
  return {
    id: row.id,
    fromCharacterId: row.from_character_id,
    toCharacterId: row.to_character_id,
    relationType: row.relation_type,
    description: row.description,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fromCharacterTitle: row.from_character_title,
    toCharacterTitle: row.to_character_title
  }
}

function mapSourceEvidence(row: SourceEvidenceRow): SourceEvidence {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    chapterId: row.chapter_id,
    chapterVersion: row.chapter_version,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    excerpt: row.excerpt,
    state: row.state,
    createdAt: row.created_at,
    chapterTitle: row.chapter_title
  }
}

function mapAiFactSuggestion(row: AiFactSuggestionRow, evidences: SourceEvidence[] = []): AiFactSuggestion {
  return {
    id: row.id,
    knowledgeEntryId: row.knowledge_entry_id,
    knowledgeKind: row.knowledge_kind,
    normalizedSubject: row.normalized_subject,
    predicate: row.predicate,
    valueJson: row.value_json,
    displayText: row.display_text,
    state: row.state,
    confidence: row.confidence,
    analysisTaskId: row.analysis_task_id,
    version: row.version,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    evidences
  }
}

export class KnowledgeRepository {
  constructor(
    private readonly store: ProjectStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  // ==================== 知识条目 KnowledgeEntry ====================

  listEntries(
    sessionId: string,
    filters?: {
      kind?: KnowledgeKind
      state?: KnowledgeState
      query?: string
    }
  ): KnowledgeEntry[] {
    return this.store.read(sessionId, (db) => {
      let sql = 'SELECT * FROM knowledge_entry WHERE 1=1'
      const params: unknown[] = []

      if (filters?.kind) {
        sql += ' AND knowledge_kind = ?'
        params.push(filters.kind)
      }

      if (filters?.state) {
        sql += ' AND state = ?'
        params.push(filters.state)
      }

      if (filters?.query) {
        const queryPattern = `%${filters.query.trim().replace(/([%_\\])/g, '\\$1')}%`
        sql += " AND (title LIKE ? ESCAPE '\\' OR author_content LIKE ? ESCAPE '\\' OR aliases_json LIKE ? ESCAPE '\\')"
        params.push(queryPattern, queryPattern, queryPattern)
      }

      sql += ' ORDER BY created_at ASC'
      const rows = db.prepare(sql).all(...params) as KnowledgeEntryRow[]
      return rows.map(mapKnowledgeEntry)
    })
  }

  getEntry(sessionId: string, entryId: string): KnowledgeEntry {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(entryId) as KnowledgeEntryRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '知识条目不存在')
      return mapKnowledgeEntry(row)
    })
  }

  createEntry(
    sessionId: string,
    input: {
      kind: KnowledgeKind
      title: string
      aliases?: string[]
      authorContent?: string
      tags?: string[]
      identity?: string
      currentState?: string
      narrativeOrder?: number
      storyTime?: string
      relativeTime?: string
      timeUncertain?: boolean
      foreshadowState?: string
    }
  ): KnowledgeEntry {
    const id = randomUUID()
    const now = Date.now()
    const aliasesJson = JSON.stringify(input.aliases ?? [])
    const tagsJson = JSON.stringify(input.tags ?? [])
    const authorContent = input.authorContent ?? ''
    const timeUncertainInt = input.timeUncertain === undefined ? null : input.timeUncertain ? 1 : 0

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO knowledge_entry(
          id, knowledge_kind, title, aliases_json, author_content, tags_json,
          identity, current_state, narrative_order, story_time, relative_time,
          time_uncertain, foreshadow_state, version, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
      `).run(
        id,
        input.kind,
        input.title,
        aliasesJson,
        authorContent,
        tagsJson,
        input.identity ?? null,
        input.currentState ?? null,
        input.narrativeOrder ?? null,
        input.storyTime ?? null,
        input.relativeTime ?? null,
        timeUncertainInt,
        input.foreshadowState ?? null,
        now,
        now
      )

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})

    return {
      id,
      knowledgeKind: input.kind,
      title: input.title,
      aliases: input.aliases ?? [],
      authorContent,
      tags: input.tags ?? [],
      identity: input.identity ?? null,
      currentState: input.currentState ?? null,
      narrativeOrder: input.narrativeOrder ?? null,
      storyTime: input.storyTime ?? null,
      relativeTime: input.relativeTime ?? null,
      timeUncertain: input.timeUncertain ?? null,
      foreshadowState: input.foreshadowState ?? null,
      version: 1,
      state: 'active',
      createdAt: now,
      updatedAt: now
    }
  }

  updateEntry(
    sessionId: string,
    entryId: string,
    input: {
      title?: string
      aliases?: string[]
      authorContent?: string
      tags?: string[]
      identity?: string | null
      currentState?: string | null
      narrativeOrder?: number | null
      storyTime?: string | null
      relativeTime?: string | null
      timeUncertain?: boolean | null
      foreshadowState?: string | null
    },
    expectedVersion: number
  ): KnowledgeEntry {
    const now = Date.now()
    let updatedEntry: KnowledgeEntry | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(entryId) as KnowledgeEntryRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '知识条目不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '知识条目已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      const title = input.title ?? row.title
      const aliasesJson = input.aliases !== undefined ? JSON.stringify(input.aliases) : row.aliases_json
      const authorContent = input.authorContent !== undefined ? input.authorContent : row.author_content
      const tagsJson = input.tags !== undefined ? JSON.stringify(input.tags) : row.tags_json
      const identity = input.identity !== undefined ? input.identity : row.identity
      const currentState = input.currentState !== undefined ? input.currentState : row.current_state
      const narrativeOrder = input.narrativeOrder !== undefined ? input.narrativeOrder : row.narrative_order
      const storyTime = input.storyTime !== undefined ? input.storyTime : row.story_time
      const relativeTime = input.relativeTime !== undefined ? input.relativeTime : row.relative_time
      const timeUncertain = input.timeUncertain !== undefined ? (input.timeUncertain === null ? null : input.timeUncertain ? 1 : 0) : row.time_uncertain
      const foreshadowState = input.foreshadowState !== undefined ? input.foreshadowState : row.foreshadow_state

      db.prepare(`
        UPDATE knowledge_entry
        SET title = ?, aliases_json = ?, author_content = ?, tags_json = ?,
            identity = ?, current_state = ?, narrative_order = ?, story_time = ?,
            relative_time = ?, time_uncertain = ?, foreshadow_state = ?,
            version = ?, updated_at = ?
        WHERE id = ?
      `).run(
        title,
        aliasesJson,
        authorContent,
        tagsJson,
        identity,
        currentState,
        narrativeOrder,
        storyTime,
        relativeTime,
        timeUncertain,
        foreshadowState,
        nextVersion,
        now,
        entryId
      )

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)

      updatedEntry = {
        id: entryId,
        knowledgeKind: row.knowledge_kind,
        title,
        aliases: parseJsonArray(aliasesJson),
        authorContent,
        tags: parseJsonArray(tagsJson),
        identity,
        currentState,
        narrativeOrder,
        storyTime,
        relativeTime,
        timeUncertain: timeUncertain === null ? null : Boolean(timeUncertain),
        foreshadowState,
        version: nextVersion,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: now
      }
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return updatedEntry!
  }

  archiveEntry(sessionId: string, entryId: string, expectedVersion: number): KnowledgeEntry {
    const now = Date.now()
    let updatedEntry: KnowledgeEntry | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(entryId) as KnowledgeEntryRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '知识条目不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '知识条目已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE knowledge_entry
        SET state = 'archived', version = ?, updated_at = ?
        WHERE id = ?
      `).run(nextVersion, now, entryId)

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)

      updatedEntry = {
        ...mapKnowledgeEntry(row),
        state: 'archived',
        version: nextVersion,
        updatedAt: now
      }
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return updatedEntry!
  }

  restoreEntry(sessionId: string, entryId: string, expectedVersion: number): KnowledgeEntry {
    const now = Date.now()
    let updatedEntry: KnowledgeEntry | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(entryId) as KnowledgeEntryRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '知识条目不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '知识条目已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE knowledge_entry
        SET state = 'active', version = ?, updated_at = ?
        WHERE id = ?
      `).run(nextVersion, now, entryId)

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)

      updatedEntry = {
        ...mapKnowledgeEntry(row),
        state: 'active',
        version: nextVersion,
        updatedAt: now
      }
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return updatedEntry!
  }

  deleteEntry(sessionId: string, entryId: string, expectedVersion: number): SuccessResult {
    const now = Date.now()
    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, version FROM knowledge_entry WHERE id = ?').get(entryId) as {
        id: string
        version: number
      } | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '知识条目不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '知识条目已被其他修改覆盖，请重新载入')
      }

      // Delete relationships referencing this entry
      db.prepare('DELETE FROM character_relationship WHERE from_character_id = ? OR to_character_id = ?').run(entryId, entryId)
      // Delete the entry
      db.prepare('DELETE FROM knowledge_entry WHERE id = ?').run(entryId)

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return { success: true }
  }

  // ==================== 人物关系 CharacterRelationship ====================

  listRelationships(
    sessionId: string,
    characterId?: string,
    includeArchived = false
  ): CharacterRelationship[] {
    return this.store.read(sessionId, (db) => {
      let sql = `
        SELECT
          cr.id,
          cr.from_character_id,
          cr.to_character_id,
          cr.relation_type,
          cr.description,
          cr.version,
          cr.created_at,
          cr.updated_at,
          fe.title AS from_character_title,
          te.title AS to_character_title,
          fe.state AS from_state,
          te.state AS to_state
        FROM character_relationship cr
        JOIN knowledge_entry fe ON fe.id = cr.from_character_id
        JOIN knowledge_entry te ON te.id = cr.to_character_id
        WHERE 1=1
      `
      const params: unknown[] = []

      if (!includeArchived) {
        sql += " AND fe.state = 'active' AND te.state = 'active'"
      }

      if (characterId) {
        sql += ' AND (cr.from_character_id = ? OR cr.to_character_id = ?)'
        params.push(characterId, characterId)
      }

      sql += ' ORDER BY cr.created_at ASC'
      const rows = db.prepare(sql).all(...params) as Array<CharacterRelationshipRow & { from_state: string; to_state: string }>
      return rows.map(mapCharacterRelationship)
    })
  }

  getRelationship(sessionId: string, relationshipId: string): CharacterRelationship {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare(`
        SELECT
          cr.id,
          cr.from_character_id,
          cr.to_character_id,
          cr.relation_type,
          cr.description,
          cr.version,
          cr.created_at,
          cr.updated_at,
          fe.title AS from_character_title,
          te.title AS to_character_title
        FROM character_relationship cr
        JOIN knowledge_entry fe ON fe.id = cr.from_character_id
        JOIN knowledge_entry te ON te.id = cr.to_character_id
        WHERE cr.id = ?
      `).get(relationshipId) as CharacterRelationshipRow | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '人物关系不存在')
      return mapCharacterRelationship(row)
    })
  }

  createRelationship(
    sessionId: string,
    fromCharacterId: string,
    toCharacterId: string,
    relationType: string,
    description = ''
  ): CharacterRelationship {
    if (fromCharacterId === toCharacterId) {
      throw new ProjectError('VALIDATION_ERROR', '人物关系不能指向自身')
    }

    const id = randomUUID()
    const now = Date.now()
    let createdRel: CharacterRelationship | undefined

    this.store.transaction(sessionId, (db) => {
      const fromChar = db.prepare("SELECT id, title, knowledge_kind FROM knowledge_entry WHERE id = ?").get(fromCharacterId) as { id: string; title: string; knowledge_kind: string } | undefined
      const toChar = db.prepare("SELECT id, title, knowledge_kind FROM knowledge_entry WHERE id = ?").get(toCharacterId) as { id: string; title: string; knowledge_kind: string } | undefined

      if (!fromChar || fromChar.knowledge_kind !== 'character') {
        throw new ProjectError('VALIDATION_ERROR', '起始主体必须为有效人物条目')
      }
      if (!toChar || toChar.knowledge_kind !== 'character') {
        throw new ProjectError('VALIDATION_ERROR', '目标主体必须为有效人物条目')
      }

      db.prepare(`
        INSERT INTO character_relationship(id, from_character_id, to_character_id, relation_type, description, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, fromCharacterId, toCharacterId, relationType, description, now, now)

      createdRel = {
        id,
        fromCharacterId,
        toCharacterId,
        relationType,
        description,
        version: 1,
        createdAt: now,
        updatedAt: now,
        fromCharacterTitle: fromChar.title,
        toCharacterTitle: toChar.title
      }
    })

    return createdRel!
  }

  updateRelationship(
    sessionId: string,
    relationshipId: string,
    relationType: string,
    description = '',
    expectedVersion: number
  ): CharacterRelationship {
    const now = Date.now()
    let updatedRel: CharacterRelationship | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare(`
        SELECT
          cr.id,
          cr.from_character_id,
          cr.to_character_id,
          cr.version,
          cr.created_at,
          fe.title AS from_character_title,
          te.title AS to_character_title
        FROM character_relationship cr
        JOIN knowledge_entry fe ON fe.id = cr.from_character_id
        JOIN knowledge_entry te ON te.id = cr.to_character_id
        WHERE cr.id = ?
      `).get(relationshipId) as (CharacterRelationshipRow & { from_character_title: string; to_character_title: string }) | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '人物关系不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '人物关系已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE character_relationship
        SET relation_type = ?, description = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(relationType, description, nextVersion, now, relationshipId)

      updatedRel = {
        id: relationshipId,
        fromCharacterId: row.from_character_id,
        toCharacterId: row.to_character_id,
        relationType,
        description,
        version: nextVersion,
        createdAt: row.created_at,
        updatedAt: now,
        fromCharacterTitle: row.from_character_title,
        toCharacterTitle: row.to_character_title
      }
    })

    return updatedRel!
  }

  deleteRelationship(sessionId: string, relationshipId: string, expectedVersion: number): SuccessResult {
    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, version FROM character_relationship WHERE id = ?').get(relationshipId) as {
        id: string
        version: number
      } | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '人物关系不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '人物关系已被其他修改覆盖，请重新载入')
      }

      db.prepare('DELETE FROM character_relationship WHERE id = ?').run(relationshipId)
    })

    return { success: true }
  }

  // ==================== AI 建议与证据 AiFactSuggestion ====================

  listSuggestions(
    sessionId: string,
    filters?: {
      entryId?: string
      state?: SuggestionState
      kind?: KnowledgeKind
    }
  ): AiFactSuggestion[] {
    return this.store.read(sessionId, (db) => {
      let sql = 'SELECT * FROM ai_fact_suggestion WHERE 1=1'
      const params: unknown[] = []

      if (filters?.entryId) {
        sql += ' AND knowledge_entry_id = ?'
        params.push(filters.entryId)
      }

      if (filters?.state) {
        sql += ' AND state = ?'
        params.push(filters.state)
      }

      if (filters?.kind) {
        sql += ' AND knowledge_kind = ?'
        params.push(filters.kind)
      }

      sql += ' ORDER BY created_at ASC'
      const rows = db.prepare(sql).all(...params) as AiFactSuggestionRow[]

      // Fetch evidences for all returned suggestions
      const suggestionIds = rows.map((r) => r.id)
      const evidenceMap = new Map<string, SourceEvidence[]>()

      if (suggestionIds.length > 0) {
        const placeholders = suggestionIds.map(() => '?').join(',')
        const evidenceRows = db.prepare(`
          SELECT
            se.*,
            c.title AS chapter_title
          FROM source_evidence se
          LEFT JOIN chapter c ON c.id = se.chapter_id
          WHERE se.owner_type = 'ai_fact_suggestion' AND se.owner_id IN (${placeholders})
          ORDER BY se.created_at ASC
        `).all(...suggestionIds) as SourceEvidenceRow[]

        for (const evRow of evidenceRows) {
          const list = evidenceMap.get(evRow.owner_id) ?? []
          list.push(mapSourceEvidence(evRow))
          evidenceMap.set(evRow.owner_id, list)
        }
      }

      return rows.map((r) => mapAiFactSuggestion(r, evidenceMap.get(r.id) ?? []))
    })
  }

  getSuggestion(sessionId: string, suggestionId: string): AiFactSuggestion {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM ai_fact_suggestion WHERE id = ?').get(suggestionId) as AiFactSuggestionRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', 'AI 建议不存在')

      const evidenceRows = db.prepare(`
        SELECT
          se.*,
          c.title AS chapter_title
        FROM source_evidence se
        LEFT JOIN chapter c ON c.id = se.chapter_id
        WHERE se.owner_type = 'ai_fact_suggestion' AND se.owner_id = ?
        ORDER BY se.created_at ASC
      `).all(suggestionId) as SourceEvidenceRow[]

      const evidences = evidenceRows.map(mapSourceEvidence)
      return mapAiFactSuggestion(row, evidences)
    })
  }

  reviewSuggestion(
    sessionId: string,
    suggestionId: string,
    state: 'ignored' | 'conflict',
    expectedVersion: number
  ): AiFactSuggestion {
    const now = Date.now()
    let updated: AiFactSuggestion | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT * FROM ai_fact_suggestion WHERE id = ?').get(suggestionId) as AiFactSuggestionRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', 'AI 建议不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', 'AI 建议已被其他操作更新，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE ai_fact_suggestion
        SET state = ?, version = ?, reviewed_at = ?
        WHERE id = ?
      `).run(state, nextVersion, now, suggestionId)

      const evidenceRows = db.prepare(`
        SELECT se.*, c.title AS chapter_title
        FROM source_evidence se
        LEFT JOIN chapter c ON c.id = se.chapter_id
        WHERE se.owner_type = 'ai_fact_suggestion' AND se.owner_id = ?
        ORDER BY se.created_at ASC
      `).all(suggestionId) as SourceEvidenceRow[]

      updated = {
        ...mapAiFactSuggestion(row, evidenceRows.map(mapSourceEvidence)),
        state,
        version: nextVersion,
        reviewedAt: now
      }
    })

    return updated!
  }

  /**
   * Generates a pure in-memory draft preview for accepting a suggestion.
   * Does NOT write to the database or invoke any model.
   */
  previewSuggestionAcceptance(
    sessionId: string,
    suggestionId: string,
    targetEntryId?: string
  ): SuggestionAcceptancePreview {
    return this.store.read(sessionId, (db) => {
      const suggestion = this.getSuggestion(sessionId, suggestionId)

      let targetEntry: KnowledgeEntry | null = null
      let targetExpectedVersion: number | null = null
      let draft: SuggestionAcceptanceDraft

      if (targetEntryId) {
        const entryRow = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(targetEntryId) as KnowledgeEntryRow | undefined
        if (!entryRow) {
          throw new ProjectError('VALIDATION_ERROR', '指定的目标知识条目不存在')
        }
        if (entryRow.state === 'archived') {
          throw new ProjectError('VALIDATION_ERROR', '归档条目不可直接作为采纳目标，请先恢复条目')
        }

        targetEntry = mapKnowledgeEntry(entryRow)
        targetExpectedVersion = entryRow.version

        // Compose draft author content
        const existingContent = targetEntry.authorContent.trim()
        const combinedContent = existingContent.length > 0
          ? `${existingContent}\n\n${suggestion.displayText}`
          : suggestion.displayText

        draft = {
          title: targetEntry.title,
          kind: targetEntry.knowledgeKind,
          authorContent: combinedContent
        }
      } else {
        draft = {
          title: suggestion.normalizedSubject,
          kind: suggestion.knowledgeKind,
          authorContent: suggestion.displayText
        }
      }

      return {
        suggestion,
        targetEntry,
        draft,
        targetExpectedVersion
      }
    })
  }

  /**
   * Accepts a suggestion in a single atomic transaction.
   * Verifies versions for both the suggestion and the target entry (if existing).
   */
  acceptSuggestion(
    sessionId: string,
    input: {
      suggestionId: string
      expectedSuggestionVersion: number
      targetEntryId?: string
      targetExpectedVersion?: number
      draft: SuggestionAcceptanceDraft
    }
  ): KnowledgeEntry {
    const now = Date.now()
    let resultEntry: KnowledgeEntry | undefined

    this.store.transaction(sessionId, (db) => {
      // 1. Check suggestion
      const suggestion = db.prepare('SELECT * FROM ai_fact_suggestion WHERE id = ?').get(input.suggestionId) as AiFactSuggestionRow | undefined
      if (!suggestion) {
        throw new ProjectError('VALIDATION_ERROR', 'AI 建议不存在')
      }
      if (suggestion.state !== 'pending' && suggestion.state !== 'conflict') {
        throw new ProjectError('VALIDATION_ERROR', '该建议已处于终态，无法再次采纳')
      }
      if (suggestion.version !== input.expectedSuggestionVersion) {
        throw new ProjectError('VERSION_CONFLICT', 'AI 建议已被其他修改更新，请重新载入')
      }

      let finalEntryId: string

      // 2. Target entry handling
      if (input.targetEntryId) {
        finalEntryId = input.targetEntryId
        const entryRow = db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(input.targetEntryId) as KnowledgeEntryRow | undefined
        if (!entryRow) {
          throw new ProjectError('VALIDATION_ERROR', '指定的目标知识条目不存在')
        }
        if (entryRow.state === 'archived') {
          throw new ProjectError('VALIDATION_ERROR', '归档条目不可直接作为采纳目标，请先恢复条目')
        }
        if (input.targetExpectedVersion === undefined || entryRow.version !== input.targetExpectedVersion) {
          throw new ProjectError('VERSION_CONFLICT', '目标知识条目已被其他修改更新，请重新载入')
        }

        const nextEntryVersion = entryRow.version + 1
        db.prepare(`
          UPDATE knowledge_entry
          SET author_content = ?, version = ?, updated_at = ?
          WHERE id = ?
        `).run(input.draft.authorContent, nextEntryVersion, now, input.targetEntryId)

        resultEntry = {
          ...mapKnowledgeEntry(entryRow),
          authorContent: input.draft.authorContent,
          version: nextEntryVersion,
          updatedAt: now
        }
      } else {
        // Create new knowledge entry
        finalEntryId = randomUUID()
        db.prepare(`
          INSERT INTO knowledge_entry(
            id, knowledge_kind, title, aliases_json, author_content, tags_json,
            version, state, created_at, updated_at
          ) VALUES (?, ?, ?, '[]', ?, '[]', 1, 'active', ?, ?)
        `).run(
          finalEntryId,
          input.draft.kind,
          input.draft.title,
          input.draft.authorContent,
          now,
          now
        )

        resultEntry = {
          id: finalEntryId,
          knowledgeKind: input.draft.kind,
          title: input.draft.title,
          aliases: [],
          authorContent: input.draft.authorContent,
          tags: [],
          version: 1,
          state: 'active',
          createdAt: now,
          updatedAt: now
        }
      }

      // 3. Update suggestion
      const nextSuggestionVersion = suggestion.version + 1
      db.prepare(`
        UPDATE ai_fact_suggestion
        SET knowledge_entry_id = ?, state = 'accepted', version = ?, reviewed_at = ?
        WHERE id = ?
      `).run(finalEntryId, nextSuggestionVersion, now, input.suggestionId)

      // 4. Mark search index dirty
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return resultEntry!
  }

  // ==================== 辅助写入方法 (用于测试与后续分析任务) ====================

  createSuggestion(
    sessionId: string,
    input: {
      id?: string
      knowledgeEntryId?: string | null
      knowledgeKind: KnowledgeKind
      normalizedSubject: string
      predicate: string
      valueJson: string
      displayText: string
      confidence?: number | null
      analysisTaskId: string
    }
  ): AiFactSuggestion {
    const id = input.id ?? randomUUID()
    const now = Date.now()

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO ai_fact_suggestion(
          id, knowledge_entry_id, knowledge_kind, normalized_subject, predicate,
          value_json, display_text, state, confidence, analysis_task_id, version,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?)
      `).run(
        id,
        input.knowledgeEntryId ?? null,
        input.knowledgeKind,
        input.normalizedSubject,
        input.predicate,
        input.valueJson,
        input.displayText,
        input.confidence ?? null,
        input.analysisTaskId,
        now
      )
    })

    return {
      id,
      knowledgeEntryId: input.knowledgeEntryId ?? null,
      knowledgeKind: input.knowledgeKind,
      normalizedSubject: input.normalizedSubject,
      predicate: input.predicate,
      valueJson: input.valueJson,
      displayText: input.displayText,
      state: 'pending',
      confidence: input.confidence ?? null,
      analysisTaskId: input.analysisTaskId,
      version: 1,
      createdAt: now,
      evidences: []
    }
  }

  addEvidence(
    sessionId: string,
    input: {
      ownerType: 'ai_fact_suggestion' | 'consistency_issue' | 'report_section'
      ownerId: string
      chapterId: string
      chapterVersion: number
      startOffset: number
      endOffset: number
      excerpt: string
    }
  ): SourceEvidence {
    const id = randomUUID()
    const now = Date.now()

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO source_evidence(
          id, owner_type, owner_id, chapter_id, chapter_version,
          start_offset, end_offset, excerpt, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?)
      `).run(
        id,
        input.ownerType,
        input.ownerId,
        input.chapterId,
        input.chapterVersion,
        input.startOffset,
        input.endOffset,
        input.excerpt,
        now
      )
    })

    return {
      id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      chapterId: input.chapterId,
      chapterVersion: input.chapterVersion,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      excerpt: input.excerpt,
      state: 'valid',
      createdAt: now
    }
  }
}
