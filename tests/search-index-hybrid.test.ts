import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { KnowledgeRepository } from '../src/main/knowledge-repository'

describe('SearchIndex Vector Indexing & Hybrid Search (SPEC 7.6)', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  let tempDir: string
  let store: ProjectStore
  let connStore: ConnectionStore
  let diagnostics: DiagnosticsService
  let gateway: ModelGateway
  let searchIndex: SearchIndex
  let knowledgeRepo: KnowledgeRepository
  let sessionId: string
  let connId: string

  beforeAll(() => new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (requestHandler) {
        requestHandler(req, res)
      } else {
        res.writeHead(404)
        res.end()
      }
    }).listen(0, '127.0.0.1', () => {
      const address = server.address()
      serverPort = typeof address === 'object' && address ? address.port : 0
      serverUrl = `http://127.0.0.1:${serverPort}/v1`
      resolve()
    })
  }))

  afterAll(() => new Promise<void>((resolve) => {
    server.close(() => resolve())
  }))

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-search-hybrid-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(connStore, diagnostics)
    searchIndex = new SearchIndex(store, gateway, connStore)
    knowledgeRepo = new KnowledgeRepository(store, searchIndex)

    const conn = connStore.create({
      name: 'Embeddings Conn',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
      batchSize: 4
    })
    connId = conn.id
    connStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-hybrid.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙录', description: '测试' }, [
      { title: '第一章 山边小村', content: '韩立出生在天南越国镜州青牛镇五里沟，家中世代务农。三叔将他带去七玄门参加入门考核。' },
      { title: '第二章 墨大夫与长春功', content: '墨居仁收韩立与张铁为徒。韩立在神手谷中修炼长春功，夜间在草丛中捡到神秘小绿瓶。' },
      { title: '第三章 掌天瓶催熟灵药', content: '神秘小绿瓶能吸收月华凝聚绿液，韩立用绿液浇灌黄精等药材，发现药性大幅催熟。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId

    // Add a knowledge entry
    knowledgeRepo.createEntry(sessionId, {
      title: '掌天瓶',
      kind: 'world',
      authorContent: '仙界至宝，具有吸收月光灵气催熟灵药之神效。由韩立在神手谷中偶然拾得。'
    })

    // Setup mock vector embedding response
    requestHandler = async (req, res) => {
      let body = ''
      for await (const chunk of req) {
        body += chunk
      }
      const json = JSON.parse(body) as { input: string[] }
      const inputs = json.input

      const data = inputs.map((text, idx) => {
        // Return synthetic 4-dimensional vector based on content
        let v0 = 0.1
        let v1 = 0.1
        let v2 = 0.1
        let v3 = 0.1
        if (text.includes('小绿瓶') || text.includes('掌天瓶') || text.includes('催熟')) {
          v0 = 0.9
          v1 = 0.8
        }
        if (text.includes('韩立') || text.includes('七玄门')) {
          v2 = 0.7
        }
        return { embedding: [v0, v1, v2, v3], index: idx }
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data,
        usage: { prompt_tokens: inputs.length * 10, total_tokens: inputs.length * 10 }
      }))
    }

    await searchIndex.sync(sessionId, connId)
  })

  afterEach(async () => {
    try {
      await store.closeAll()
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('builds vector index and updates vectorMeta to ready state', () => {
    const status = searchIndex.getStatus(sessionId)
    if (status.vectorMeta?.state !== 'ready') {
      console.error('VECTOR META LAST ERROR:', status.vectorMeta?.lastError)
    }
    expect(status.state).toBe('current')
    expect(status.vectorMeta).toBeDefined()
    expect(status.vectorMeta?.state).toBe('ready')
    expect(status.vectorMeta?.dimensions).toBe(4)
    expect(status.vectorMeta?.processedCount).toBeGreaterThanOrEqual(4)
    expect(status.vectorMeta?.totalCount).toBeGreaterThanOrEqual(4)
    expect(status.vectorMeta?.lastError).toBeNull()
  })

  it('does not commit an embedding result after its source content changes', async () => {
    const entryId = randomUUID()
    const now = Date.now()
    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO knowledge_entry(
          id, knowledge_kind, title, aliases_json, author_content, tags_json,
          identity, current_state, narrative_order, story_time, relative_time,
          time_uncertain, foreshadow_state, version, state, created_at, updated_at
        ) VALUES (?, 'world', '延迟更新条目', '[]', 'OLD_CONTENT', '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'active', ?, ?)
      `).run(entryId, now, now)
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    let firstStartedResolve!: () => void
    const firstStarted = new Promise<void>((resolve) => { firstStartedResolve = resolve })
    let releaseFirst!: () => void
    let newInputReceived = false
    const firstResponseReleased = new Promise<void>((resolve) => { releaseFirst = resolve })
    requestHandler = async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const inputs = (JSON.parse(body) as { input: string[] }).input
      newInputReceived ||= inputs.some((input) => input.includes('NEW_CONTENT'))
      if (inputs.some((input) => input.includes('OLD_CONTENT'))) {
        firstStartedResolve()
        await firstResponseReleased
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: inputs.map((input, index) => ({
          embedding: input.includes('OLD_CONTENT') ? [1, 0, 0, 0] : [0, 1, 0, 0],
          index
        }))
      }))
    }

    const firstSync = searchIndex.sync(sessionId, connId)
    await firstStarted

    store.transaction(sessionId, (db) => {
      db.prepare('UPDATE knowledge_entry SET author_content = ?, version = 2, updated_at = ? WHERE id = ?').run('NEW_CONTENT', Date.now(), entryId)
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(Date.now())
    })
    const secondSync = searchIndex.sync(sessionId, connId)
    releaseFirst()
    await Promise.all([firstSync, secondSync])

    const results = searchIndex.searchKeyword(sessionId, { sessionId, query: 'NEW_CONTENT' })
    expect(results.some((result) => result.sourceId === entryId)).toBe(true)
    expect(newInputReceived).toBe(true)
    const status = searchIndex.getStatus(sessionId)
    expect(status.vectorMeta?.state).toBe('ready')
  })

  it('performs hybrid search with RRF scoring and authority boost for knowledge entries', async () => {
    const results = await searchIndex.searchHybrid(sessionId, {
      sessionId,
      query: '掌天瓶催熟灵药',
      limit: 10,
      connectionId: connId
    })

    expect(results.length).toBeGreaterThan(0)
    // The knowledge entry should receive high rank and +0.02 authority boost
    const knowledgeResult = results.find((r) => r.sourceType === 'knowledge_entry')
    expect(knowledgeResult).toBeDefined()
    expect(knowledgeResult?.title).toBe('掌天瓶')

    // Chapter chunks should also be retrieved and ranked
    const chapterChunkResult = results.find((r) => r.sourceType === 'chapter_chunk')
    expect(chapterChunkResult).toBeDefined()
  })

  it('falls back gracefully to FTS search when vector index state is missing or fails', async () => {
    // Break mock server to simulate failure
    requestHandler = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Embedding server error' }))
    }

    const results = await searchIndex.searchHybrid(sessionId, {
      sessionId,
      query: '长春功',
      connectionId: connId
    })

    // Should return results from FTS without throwing
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe('第二章 墨大夫与长春功')
  })

  it('lets a later FTS sync finish while an earlier vector sync is waiting', async () => {
    const addKnowledgeEntry = (title: string, content: string) => {
      const id = randomUUID()
      const now = Date.now()
      store.transaction(sessionId, (db) => {
        db.prepare(`
          INSERT INTO knowledge_entry(
            id, knowledge_kind, title, aliases_json, author_content, tags_json,
            identity, current_state, narrative_order, story_time, relative_time,
            time_uncertain, foreshadow_state, version, state, created_at, updated_at
          ) VALUES (?, 'world', ?, '[]', ?, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'active', ?, ?)
        `).run(id, title, content, now, now)
        db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
      })
    }

    let releaseFirstVector!: () => void
    const firstVectorReleased = new Promise<void>((resolve) => {
      releaseFirstVector = resolve
    })
    let firstVectorStarted!: () => void
    const firstVectorRequest = new Promise<void>((resolve) => {
      firstVectorStarted = resolve
    })
    let requestCount = 0
    requestHandler = async (_req, res) => {
      requestCount++
      if (requestCount === 1) {
        firstVectorStarted()
        await firstVectorReleased
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4], index: 0 }]
      }))
    }

    addKnowledgeEntry('第一个停顿条目', '第一个停顿向量条目')
    const firstSync = searchIndex.sync(sessionId, connId)
    await firstVectorRequest

    addKnowledgeEntry('第二个本地条目', '第二个本地索引立即可见')
    const secondSync = searchIndex.sync(sessionId, connId)
    await new Promise<void>((resolve) => setImmediate(resolve))

    const results = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '第二个本地索引立即可见'
    })
    expect(results.some((result) => result.title === '第二个本地条目')).toBe(true)

    releaseFirstVector()
    await Promise.all([firstSync, secondSync])
  })

  it('returns FTS results when hybrid embedding reaches its deadline', async () => {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => originalTimeout(Math.min(milliseconds, 20)))
    requestHandler = (_req, _res) => {
      // Leave the response pending until the query timeout aborts the request.
    }

    try {
      const results = await searchIndex.searchHybrid(sessionId, {
        sessionId,
        query: '长春功',
        connectionId: connId
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].title).toBe('第二章 墨大夫与长春功')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('rebuilds vector index cleanly when model/fingerprint changes', async () => {
    const newConn = connStore.create({
      name: 'New Embeddings Model',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-large',
      apiKey: 'test-key-2'
    })
    connStore.confirmContentTarget(newConn.id, calculateContentTargetFingerprint(newConn.baseUrl, newConn.model))

    // Re-sync with new connection
    await searchIndex.sync(sessionId, newConn.id)

    const status = searchIndex.getStatus(sessionId)
    expect(status.vectorMeta?.model).toBe('text-embedding-3-large')
    expect(status.vectorMeta?.state).toBe('ready')
  })
})
