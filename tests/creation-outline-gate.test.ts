import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { CandidateService } from '../src/main/candidate-service'
import { CreationRunner } from '../src/main/creation-runner'

describe('T08: Outline Confirmation Gate & Creation Candidate Generation', () => {
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
  let chapterRepo: ChapterRepository
  let contextAssembler: ContextAssembler
  let candidateService: CandidateService
  let runner: CreationRunner
  let sessionId: string
  let connId: string
  let chapterId: string

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
    tempDir = mkdtempSync(join(tmpdir(), 'novel-creation-gate-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(connStore, diagnostics)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connStore)
    candidateService = new CandidateService(store, searchIndex)
    runner = new CreationRunner(store, gateway, connStore, contextAssembler, candidateService)

    const conn = connStore.create({
      name: 'Test LLM',
      kind: 'generation',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'gpt-4o',
      contextWindow: 16000,
      maxOutputTokens: 2000,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connId = conn.id
    connStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-gate.novelproj')
    store.create({ destination: projectPath, title: '门禁测试作品', description: '测试' }, [
      {
        title: '第一章 宗门大选',
        content: '韩立背负布包，步履坚定地走向广场。'
      }
    ])
    const session = await store.open(projectPath)
    sessionId = session.sessionId
    const chaps = chapterRepo.list(sessionId)
    chapterId = chaps[0].id
  })

  afterEach(async () => {
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('rejects candidate generation if session is not in content stage', async () => {
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      stage: 'direction',
      workflowType: 'creation_workflow',
      instruction: '方向确认',
      target: { chapterId }
    })

    await expect(runner.startCreation(sessionId, pkg.id)).rejects.toThrow('必须推进至 [content] 阶段')
  })

  it('rejects candidate generation if chapter outline is unconfirmed / in draft state', async () => {
    // Save draft chapter outline
    const draftOutline = store.saveChapterOutline(sessionId, {
      chapterId,
      content: '【本章目标】草稿大纲\n【场景节拍】1. 场景A',
      state: 'draft'
    })

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      stage: 'content',
      workflowType: 'creation_workflow',
      outlineId: draftOutline.id,
      instruction: '正文生成',
      target: { chapterId }
    })

    await expect(runner.startCreation(sessionId, pkg.id)).rejects.toThrow('目标章节的大纲尚未确认')
  })

  it('allows candidate generation once chapter outline is confirmed', async () => {
    // 1. Save and confirm chapter outline
    const draftOutline = store.saveChapterOutline(sessionId, {
      chapterId,
      content: '【本章目标】已锁定大纲\n【场景节拍】1. 选拔试炼；2. 灵根测试',
      state: 'draft'
    })
    const confirmedOutline = store.confirmChapterOutline(sessionId, draftOutline.id, draftOutline.version)
    expect(confirmedOutline.state).toBe('confirmed')

    // 2. Assemble context package in content stage
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      stage: 'content',
      workflowType: 'creation_workflow',
      outlineId: confirmedOutline.id,
      outlineVersion: confirmedOutline.version,
      instruction: '开始正文生成',
      target: { chapterId }
    })

    // Context package contains outline in Tier 9
    expect(pkg.userMessage).toContain('【项目大纲规划】')
    expect(pkg.userMessage).toContain('章大纲（第一章 宗门大选）')
    expect(pkg.userMessage).toContain('已锁定大纲')

    // 3. Mock LLM streaming response with isolated output tags
    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"<thinking>聚焦试炼紧张感</thinking><content>广场上人声鼎沸。韩立混在队伍末尾。"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const creationRes = await runner.startCreation(sessionId, pkg.id)
    expect(creationRes.candidateId).toBeDefined()
    expect(creationRes.taskId).toBeDefined()

    // Wait for stream to finish
    let cand = candidateService.getCandidate(sessionId, creationRes.candidateId)
    const deadline = Date.now() + 3000
    while (cand.state === 'streaming' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
      cand = candidateService.getCandidate(sessionId, creationRes.candidateId)
    }

    expect(cand.state).toBe('ready')
    expect(cand.hunks.length).toBeGreaterThan(0)
    // Pure text is extracted
    expect(cand.finalSynthesizedText).toContain('广场上人声鼎沸。韩立混在队伍末尾。')
    expect(cand.finalSynthesizedText).not.toContain('<thinking>')

    // Candidate is NOT automatically written back to chapter (Chapter content remains untouched)
    const chap = chapterRepo.get(sessionId, chapterId)
    expect(chap.content).toBe('韩立背负布包，步履坚定地走向广场。')
    expect(chap.version).toBe(1)
  })

  it('marks candidate stale if chapter outline state becomes stale during streaming', async () => {
    // 1. Save and confirm chapter outline
    const draftOutline = store.saveChapterOutline(sessionId, {
      chapterId,
      content: '【本章目标】确认版大纲',
      state: 'draft'
    })
    const confirmedOutline = store.confirmChapterOutline(sessionId, draftOutline.id, draftOutline.version)

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      stage: 'content',
      workflowType: 'creation_workflow',
      outlineId: confirmedOutline.id,
      outlineVersion: confirmedOutline.version,
      instruction: '正文生成',
      target: { chapterId }
    })

    // Mock slow streaming response
    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"云海翻腾。"}}]}\n\n')
      // While streaming, mark outline stale in DB
      store.transaction(sessionId, (db) => {
        db.prepare("UPDATE chapter_outline SET state = 'stale' WHERE id = ?").run(confirmedOutline.id)
      })
      setTimeout(() => {
        res.write('data: [DONE]\n\n')
        res.end()
      }, 50)
    }

    const creationRes = await runner.startCreation(sessionId, pkg.id)
    await new Promise((r) => setTimeout(r, 150))

    const cand = candidateService.getCandidate(sessionId, creationRes.candidateId)
    expect(cand.state).toBe('stale')
  })
})
