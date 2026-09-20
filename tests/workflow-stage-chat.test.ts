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
import { ChatService } from '../src/main/chat-service'
import { parseStageOutput } from '../src/main/output-parser'

describe('T07: Same-Session Direction Confirmation & Chapter Outline Generation', () => {
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
  let chatService: ChatService
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
    server.closeAllConnections?.()
    server.close(() => resolve())
  }))

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-workflow-stage-chat-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(connStore, diagnostics)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connStore)
    chatService = new ChatService(store, gateway, connStore, contextAssembler, searchIndex)

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

    const projectPath = join(tempDir, 'test-stage-chat.novelproj')
    store.create({ destination: projectPath, title: '分阶段会话作品', description: '测试' }, [
      {
        title: '第一章 破晓入宗',
        content: '少年韩立怀揣神秘铜瓶走入七玄门。'
      }
    ])
    const session = await store.open(projectPath)
    sessionId = session.sessionId
    const chaps = chapterRepo.list(sessionId)
    chapterId = chaps[0].id

    // Seed Book Outline
    store.transaction(sessionId, (db) => {
      const now = Date.now()
      db.prepare(`
        INSERT INTO book_outline(id, content, version, state, created_at, updated_at)
        VALUES ('book-1', '全书宏观主线：凡人修仙求道之路。', 1, 'confirmed', ?, ?)
      `).run(now, now)
    })
  })

  afterEach(async () => {
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('runs multi-stage creation workflow in the same chat session from direction to chapter outline to content', async () => {
    // 1. Create creation_workflow session -> starts at direction stage
    const workflowSession = chatService.createSession({
      sessionId,
      title: '第一章 续写工作流',
      workflowType: 'creation_workflow',
      targetChapterId: chapterId,
      connectionId: connId
    })

    expect(workflowSession.workflowType).toBe('creation_workflow')
    expect(workflowSession.stage).toBe('direction')
    expect(workflowSession.targetChapterId).toBe(chapterId)

    // 2. Direction Stage: User asks to continue chapter
    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const text = `
<direction>
【本章核心方向】
聚焦韩立在七玄门的考核初选与立足过程，突出资源匮乏下的谨慎心性。
</direction>
<questions>
1. 试炼过程中是否揭示铜瓶能够催熟草药的异象？
2. 考核长老对韩立的态度是冷漠还是暗中留意？
3. 是否在同门中引入竞争对手？
</questions>
`
      res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }

    let nextDone: (() => void) | null = null
    chatService.setCallbacks({
      onDone: () => {
        nextDone?.()
        nextDone = null
      }
    })
    const waitForDone = () => new Promise<void>((resolve) => { nextDone = resolve })

    const doneDir = waitForDone()
    const dirSendRes = await chatService.sendMessage({
      sessionId,
      chatSessionId: workflowSession.id,
      content: '请帮我梳理第一章的续写方向与核心冲突。'
    })
    expect(dirSendRes.messageId).toBeDefined()

    // Wait for streaming deterministically via onDone
    await doneDir

    let messages = chatService.listMessages({ sessionId, chatSessionId: workflowSession.id })
    expect(messages.length).toBe(2)
    const assistantDirMsg = messages[1]
    expect(assistantDirMsg.role).toBe('assistant')
    expect(assistantDirMsg.content).toContain('【本章核心方向】')
    expect(assistantDirMsg.content).toContain('【本章核心方向】')

    // Parse direction output
    const parsedDir = parseStageOutput('direction', assistantDirMsg.content) as any
    expect(parsedDir.questions.length).toBe(3)
    expect(parsedDir.direction).toContain('聚焦韩立在七玄门的考核初选')

    // 3. User responds to questions & advances stage to chapter_outline
    const stage2Session = chatService.updateStage({
      sessionId,
      chatSessionId: workflowSession.id,
      stage: 'chapter_outline',
      expectedVersion: workflowSession.version
    })
    expect(stage2Session.stage).toBe('chapter_outline')
    expect(stage2Session.version).toBe(2)

    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const outlineText = `
<chapter_outline>
【本章目标】
通过七玄门初选考核，确立药园杂役身份，获得安稳修炼环境。

【场景节拍】
1. 演武场报名：众人嘲笑五里沟出身，韩立沉默排队。
2. 基础体能考核：悬崖攀爬，韩立凭借韧劲与细心勉强过关。
3. 分配去向：长老见其资质平庸，将其分发至神手谷药园。

【人物与动机】
- 韩立：求生立足，尽可能低调不引人注目。
- 考核执事：公事公办，轻视无背景弟子。

【冲突与信息增量】
韩立察觉怀中铜瓶在靠近药园土壤时有微弱发热反应。

【连续性风险】
前文离开五里沟时携带的干粮与碎银需与现实消耗吻合。

【结尾钩子】
踏入神手谷竹林，迎面走来面色阴沉的墨大夫。
</chapter_outline>
`
      res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(outlineText)}}}]}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const doneOutline = waitForDone()
    const outlineSendRes = await chatService.sendMessage({
      sessionId,
      chatSessionId: workflowSession.id,
      content: '确认方向：暂不透露铜瓶秘密，低调通过考核。请输出六模块章大纲。'
    })
    expect(outlineSendRes.messageId).toBeDefined()
    await doneOutline

    messages = chatService.listMessages({ sessionId, chatSessionId: workflowSession.id })
    expect(messages.length).toBe(4)
    const assistantOutlineMsg = messages[3]
    expect(assistantOutlineMsg.content).toContain('【本章目标】')

    // Parse outline
    const parsedOutline = parseStageOutput('chapter_outline', assistantOutlineMsg.content) as any
    expect(parsedOutline.modules.goal).toContain('通过七玄门初选考核')
    expect(parsedOutline.modules.endingHook).toContain('面色阴沉的墨大夫')

    // 4. Save chapter outline to database, edit it, and confirm it
    const savedOutline = store.saveChapterOutline(sessionId, {
      chapterId,
      content: parsedOutline.outline,
      state: 'draft'
    })
    expect(savedOutline.state).toBe('draft')

    // Author edits and confirms outline
    const confirmedOutline = store.confirmChapterOutline(sessionId, savedOutline.id, savedOutline.version)
    expect(confirmedOutline.state).toBe('confirmed')

    // 5. Advance stage to content and link confirmed outline
    const stage3Session = chatService.updateStage({
      sessionId,
      chatSessionId: workflowSession.id,
      stage: 'content',
      outlineId: confirmedOutline.id,
      outlineVersion: confirmedOutline.version,
      expectedVersion: stage2Session.version
    })
    expect(stage3Session.stage).toBe('content')
    expect(stage3Session.outlineId).toBe(confirmedOutline.id)
    expect(stage3Session.outlineVersion).toBe(confirmedOutline.version)

    // 6. Verify session history persistence & reopening
    const reloadedSession = chatService.getSession({ sessionId, chatSessionId: workflowSession.id })
    expect(reloadedSession.stage).toBe('content')
    expect(reloadedSession.outlineId).toBe(confirmedOutline.id)

    const reloadedMessages = chatService.listMessages({ sessionId, chatSessionId: workflowSession.id })
    expect(reloadedMessages.length).toBe(4)
    expect(reloadedMessages[0].content).toContain('请帮我梳理第一章的续写方向')
    expect(reloadedMessages[1].content).toContain('【本章核心方向】')
    expect(reloadedMessages[2].content).toContain('确认方向')
    expect(reloadedMessages[3].content).toContain('【本章目标】')
  })
})
