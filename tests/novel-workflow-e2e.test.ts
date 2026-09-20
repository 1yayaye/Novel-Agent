import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { KnowledgeRepository } from '../src/main/knowledge-repository'
import { CreativeRepository } from '../src/main/creative-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { CandidateService } from '../src/main/candidate-service'
import { CreationRunner } from '../src/main/creation-runner'
import { ChatService } from '../src/main/chat-service'
import { AnalysisRunner } from '../src/main/analysis-runner'
import { parseImport } from '../src/main/import-parser'
import { parseCreationOutput, parseStageOutput } from '../src/main/output-parser'

describe('T11: End-to-End Novel Workflow Integration Test (15-Step Full Loop)', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void

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

  it('executes full 15-step novel creation workflow from sample import to candidate writeback and restart recovery', async () => {
    const tempDir = join(tmpdir(), `novel-workflow-e2e-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    const connectionStore = new ConnectionStore(dataDir)
    const diagnostics = new DiagnosticsService(dataDir)
    const gateway = new ModelGateway(connectionStore, diagnostics)
    const store = new ProjectStore(dataDir, connectionStore)
    const searchIndex = new SearchIndex(store, gateway, connectionStore)
    const chapterRepo = new ChapterRepository(store, searchIndex)
    const knowledgeRepo = new KnowledgeRepository(store, searchIndex)
    const creativeRepo = new CreativeRepository(store, searchIndex)
    const contextAssembler = new ContextAssembler(store, searchIndex, connectionStore, gateway)
    const candidateService = new CandidateService(store, searchIndex)
    const creationRunner = new CreationRunner(store, gateway, connectionStore, contextAssembler, candidateService)
    const chatService = new ChatService(store, gateway, connectionStore, contextAssembler, searchIndex)
    const analysisRunner = new AnalysisRunner(store, gateway, connectionStore, searchIndex)

    try {
      // 0. Set up model connection and confirmed content target
      const conn = connectionStore.create({
        name: 'Workflow LLM',
        kind: 'generation',
        isLocalService: true,
        baseUrl: serverUrl,
        model: 'deepseek-chat',
        contextWindow: 32000,
        maxOutputTokens: 4000,
        safetyMarginRatio: 0.1,
        tokenEstimationRatio: 1.3
      })
      const connId = conn.id
      connectionStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

      // =========================================================================
      // Step 1: Import 2-chapter Chinese Novel Sample & Verify Boundaries
      // =========================================================================
      console.log('[Step 1] Import Chinese novel sample with 2 chapters')
      const sourceTxt = join(tempDir, 'novel-sample.txt')
      writeFileSync(
        sourceTxt,
        '第一章 初入神手谷\n' +
        '山风呼啸，少年韩立背着简单的行囊，站在神手谷的青石小径前。\n' +
        '谷内雾气缭绕，药香扑鼻。墨大夫坐在竹椅上，神色淡漠地打量着他。\n\n' +
        '第二章 药园异变\n' +
        '韩立在后山药园清理杂草，怀中的神秘小铜瓶忽然微微发热。\n' +
        '他小心翼翼地取出铜瓶，只见瓶身隐隐有绿芒流转，吸收着四周稀薄的月华。',
        'utf8'
      )

      const parsedImport = parseImport(sourceTxt)
      expect(parsedImport.encoding).toBe('utf8')
      expect(parsedImport.chapters.length).toBe(2)
      expect(parsedImport.chapters[0].title).toBe('第一章 初入神手谷')
      expect(parsedImport.chapters[1].title).toBe('第二章 药园异变')

      const projectPath = join(tempDir, 'xianxia.novelproj')
      store.create(
        { destination: projectPath, title: '凡人修仙传·凡人篇', description: '两章样本端到端创作验证' },
        parsedImport.chapters
      )
      expect(existsSync(projectPath)).toBe(true)

      let opened = await store.open(projectPath)
      let sessionId = opened.sessionId
      let chaps = chapterRepo.list(sessionId)
      expect(chaps.length).toBe(2)
      const chapter1 = chaps[0]
      const chapter2 = chaps[1]
      expect(chapter1.version).toBe(1)
      expect(chapter2.version).toBe(1)

      // =========================================================================
      // Step 2: Analysis Runner Pipeline & Knowledge / Synopsis Extraction
      // =========================================================================
      console.log('[Step 2] Run analysis to extract knowledge and chapter summaries')
      const analysisTaskId = randomUUID()
      store.transaction(sessionId, (db) => {
        const now = Date.now()
        db.prepare(`
          INSERT INTO task(id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, created_at, updated_at, started_at, completed_at)
          VALUES (?, 'analysis', '{}', NULL, 'completed', 0, 100, 100, ?, ?, ?, ?)
        `).run(analysisTaskId, now, now, now, now)

        db.prepare(`
          INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at)
          VALUES
            ('sum-1', ?, 1, '韩立进入七玄门神手谷，成为墨大夫弟子。', 'current', ?, ?),
            ('sum-2', ?, 1, '韩立打理药园，初次察觉神秘小瓶异象。', 'current', ?, ?)
        `).run(chapter1.id, analysisTaskId, now, chapter2.id, analysisTaskId, now)
      })

      knowledgeRepo.createEntry(sessionId, {
        kind: 'character',
        title: '韩立',
        authorContent: '主角，心性沉稳谨慎，五里沟出身。'
      })
      knowledgeRepo.createEntry(sessionId, {
        kind: 'character',
        title: '墨大夫',
        authorContent: '神手谷名医，面色阴沉，深不可测。'
      })
      knowledgeRepo.createEntry(sessionId, {
        kind: 'world',
        title: '掌天瓶',
        authorContent: '神秘铜瓶，可吸收月华凝聚绿液催熟灵药。'
      })

      // =========================================================================
      // Step 3: Book Outline Synthesis & Confirmation
      // =========================================================================
      console.log('[Step 3] Generate full book outline draft and confirm')
      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                outlineMarkdown: '# 全书大纲\n\n## 核心主线\n韩立修仙长生之路。\n\n## 阶段规划\n第一阶段：七玄门立足与神手谷机缘。'
              })
            }
          }]
        }))
      }

      const bookDraft = await analysisRunner.generateBookOutlineDraft(sessionId)
      expect(bookDraft).toBeDefined()
      expect(bookDraft.state).toBe('draft')
      expect(bookDraft.version).toBe(1)
      expect(bookDraft.sourceVersions).toBeDefined()

      // Author edits and confirms book outline
      const confirmedBookOutline = store.confirmBookOutline(sessionId, bookDraft.version)
      expect(confirmedBookOutline.state).toBe('confirmed')
      expect(confirmedBookOutline.version).toBe(2)

      // =========================================================================
      // Step 4: Creation Workflow Session Initialization (Target Chapter 2, Stage 'direction')
      // =========================================================================
      console.log('[Step 4] Initialize creation workflow session for Chapter 2')
      const creationSession = chatService.createSession({
        sessionId,
        title: '第二章 药园异变 续写',
        workflowType: 'creation_workflow',
        targetChapterId: chapter2.id,
        connectionId: connId
      })
      expect(creationSession.workflowType).toBe('creation_workflow')
      expect(creationSession.stage).toBe('direction')
      expect(creationSession.targetChapterId).toBe(chapter2.id)
      expect(creationSession.version).toBe(1)

      // Verify invalid stage jump (direction -> content without chapter_outline) is rejected
      expect(() => {
        chatService.updateStage({
          sessionId,
          chatSessionId: creationSession.id,
          stage: 'content',
          expectedVersion: creationSession.version
        })
      }).toThrow('不允许从 [direction] 直接跳转至 [content]')

      // =========================================================================
      // Step 5: Direction Stage Socratic Dialogue & Question Extraction
      // =========================================================================
      console.log('[Step 5] Socratic dialogue in direction stage')
      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const text = `
<direction>
【本章核心方向】
聚焦韩立在药园试验铜瓶绿液的催熟效果，同时防备墨大夫的暗中观察，突出如履薄冰的谨慎。
</direction>
<questions>
1. 试验催熟的对象是普通草药还是珍稀灵草？
2. 墨大夫何时察觉药园异常并前来巡视？
3. 韩立是否在此时开始修炼长春功第一层？
</questions>
`
        res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }

      const dirMsgRes = await chatService.sendMessage({
        sessionId,
        chatSessionId: creationSession.id,
        content: '请帮我梳理第2章后续剧情方向与关键转折点。'
      })
      expect(dirMsgRes.messageId).toBeDefined()
      await new Promise((r) => setTimeout(r, 100))

      let msgs = chatService.listMessages({ sessionId, chatSessionId: creationSession.id })
      expect(msgs.length).toBe(2)
      const assistantDir = msgs[1]
      expect(assistantDir.content).toContain('【本章核心方向】')
      const parsedDir = parseStageOutput('direction', assistantDir.content) as any
      expect(parsedDir.direction).toContain('聚焦韩立在药园试验铜瓶绿液')
      expect(parsedDir.questions.length).toBe(3)

      // =========================================================================
      // Step 6: Advance Session to 'chapter_outline' Stage
      // =========================================================================
      console.log('[Step 6] Advance session stage to chapter_outline')
      const stage2Session = chatService.updateStage({
        sessionId,
        chatSessionId: creationSession.id,
        stage: 'chapter_outline',
        expectedVersion: creationSession.version
      })
      expect(stage2Session.stage).toBe('chapter_outline')
      expect(stage2Session.version).toBe(2)

      // =========================================================================
      // Step 7: Chapter Outline Stage Execution & 6-Module Parsing & Draft Saving
      // =========================================================================
      console.log('[Step 7] Generate and parse structured 6-module chapter outline')
      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const outlineText = `
<chapter_outline>
【本章目标】
证实小瓶绿液能百倍加速灵药生长，韩立暗中建立隐秘试验点。

【场景节拍】
1. 夜晚收集：小瓶在月下凝结出一滴碧绿水滴。
2. 稀释试验：韩立将绿液滴入普通黄精植株，瞬间抽枝展叶。
3. 伪装痕迹：迅速移栽并掩埋催熟残余，恢复药园原貌。

【人物与动机】
- 韩立：求证宝物价值，极度防备被墨大夫夺宝。
- 墨大夫：因旧伤加重急需灵药，加大对韩立的监视。

【冲突与信息增量】
绿液不仅能催熟，还会散发微弱清香，极易被高明修士嗅出。

【连续性风险】
前文第二章开头提到小瓶吸收月华，需承接月圆之夜的时间线。

【结尾钩子】
正当韩立掩埋泥土时，谷口传来墨大夫低沉的咳嗽声与木杖点地声。
</chapter_outline>
`
        res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(outlineText)}}}]}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }

      await chatService.sendMessage({
        sessionId,
        chatSessionId: creationSession.id,
        content: '方向已确认：先用普通黄精试验，墨大夫深夜来访。请生成标准六模块章大纲。'
      })
      await new Promise((r) => setTimeout(r, 100))

      msgs = chatService.listMessages({ sessionId, chatSessionId: creationSession.id })
      expect(msgs.length).toBe(4)
      const assistantOutline = msgs[3]
      const parsedOutline = parseStageOutput('chapter_outline', assistantOutline.content) as any
      expect(parsedOutline.modules.goal).toContain('证实小瓶绿液能百倍加速灵药生长')
      expect(parsedOutline.modules.endingHook).toContain('墨大夫低沉的咳嗽声')

      // Save draft chapter outline
      const draftChapterOutline = store.saveChapterOutline(sessionId, {
        chapterId: chapter2.id,
        content: parsedOutline.outline,
        state: 'draft'
      })
      expect(draftChapterOutline.state).toBe('draft')
      expect(draftChapterOutline.version).toBe(1)

      // =========================================================================
      // Step 8: Chapter Outline Confirmation Gate (Draft blocked -> Confirmed pass)
      // =========================================================================
      console.log('[Step 8] Verify chapter outline gate: draft blocked, confirmed allowed')
      // Advance to content stage with draft outline
      const preContentSession = chatService.updateStage({
        sessionId,
        chatSessionId: creationSession.id,
        stage: 'content',
        outlineId: draftChapterOutline.id,
        outlineVersion: draftChapterOutline.version,
        expectedVersion: stage2Session.version
      })

      const draftPkg = await contextAssembler.assembleContext({
        sessionId,
        connectionId: connId,
        taskType: 'continue',
        stage: 'content',
        workflowType: 'creation_workflow',
        outlineId: draftChapterOutline.id,
        outlineVersion: draftChapterOutline.version,
        chatSessionId: preContentSession.id,
        instruction: '正文生成准备',
        target: { chapterId: chapter2.id }
      })

      // Must be rejected by confirmation gate
      await expect(creationRunner.startCreation(sessionId, draftPkg.id)).rejects.toThrow(
        '目标章节的大纲尚未确认（处于草稿状态）'
      )

      // Author confirms chapter outline
      const confirmedChapterOutline = store.confirmChapterOutline(
        sessionId,
        draftChapterOutline.id,
        draftChapterOutline.version
      )
      expect(confirmedChapterOutline.state).toBe('confirmed')
      expect(confirmedChapterOutline.version).toBe(2)

      // Update session with confirmed outline version
      const contentSession = chatService.updateStage({
        sessionId,
        chatSessionId: creationSession.id,
        stage: 'content',
        outlineId: confirmedChapterOutline.id,
        outlineVersion: confirmedChapterOutline.version,
        expectedVersion: preContentSession.version
      })
      expect(contentSession.stage).toBe('content')
      expect(contentSession.outlineVersion).toBe(2)

      // =========================================================================
      // Step 9: Context Package Assembly with Tier 9 Confirmed Outline
      // =========================================================================
      console.log('[Step 9] Assemble context package with Tier 9 confirmed outline')
      const confirmedPkg = await contextAssembler.assembleContext({
        sessionId,
        connectionId: connId,
        taskType: 'continue',
        stage: 'content',
        workflowType: 'creation_workflow',
        outlineId: confirmedChapterOutline.id,
        outlineVersion: confirmedChapterOutline.version,
        chatSessionId: contentSession.id,
        instruction: '承接药园小瓶异变，描写深夜试验绿液的过程',
        target: { chapterId: chapter2.id }
      })

      expect(confirmedPkg.taskType).toBe('continue')
      expect(confirmedPkg.stage).toBe('content')
      expect(confirmedPkg.workflowType).toBe('creation_workflow')
      expect(confirmedPkg.items.some((i) => i.sourceType === 'chapter_outline')).toBe(true)
      expect(confirmedPkg.items.some((i) => i.sourceType === 'book_outline')).toBe(true)
      expect(confirmedPkg.userMessage).toContain('【项目大纲规划】')
      expect(confirmedPkg.userMessage).toContain('章大纲（第二章 药园异变）')
      expect(confirmedPkg.userMessage).toContain('证实小瓶绿液能百倍加速灵药生长')

      // =========================================================================
      // Step 10: Content Generation & Pure Novel Candidate Extraction
      // =========================================================================
      console.log('[Step 10] Generate streaming candidate and extract isolated pure novel text')
      requestHandler = (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        })
        const streamingContent = `
<thinking>
需要详细刻画月光下的绿液凝聚，以及韩立小心翼翼的动作心理。
</thinking>
<content>
月华如水，静静洒在后山药园的灵田之中。

韩立屏息凝神，小心翼翼地将小铜瓶倾斜。一滴碧绿欲滴的水珠自瓶口缓缓滑落，落在一株枯瘦的黄精根部。

不可思议的一幕发生了。那原本枯黄的叶片以肉眼可见的速度变得翠绿欲滴，根茎更是疯狂拔高。
韩立心中狂喜，却又瞬间化作惊悸。他迅速抓起泥土掩盖异香，就在此时，谷口处传来了轻微的脚步声与咳嗽声。
</content>
`
        res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(streamingContent)}}}]}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }

      const creationRes = await creationRunner.startCreation(sessionId, confirmedPkg.id)
      expect(creationRes.candidateId).toBeDefined()
      expect(creationRes.taskId).toBeDefined()

      // Wait for stream completion
      await new Promise((r) => setTimeout(r, 150))

      const cand = candidateService.getCandidate(sessionId, creationRes.candidateId)
      expect(cand.state).toBe('ready')
      expect(cand.hunks.length).toBeGreaterThan(0)
      expect(cand.finalSynthesizedText).toContain('月华如水，静静洒在后山药园的灵田之中。')
      expect(cand.finalSynthesizedText).toContain('韩立心中狂喜，却又瞬间化作惊悸。')
      // Thinking and content tags must be completely stripped
      expect(cand.finalSynthesizedText).not.toContain('<thinking>')
      expect(cand.finalSynthesizedText).not.toContain('</thinking>')
      expect(cand.finalSynthesizedText).not.toContain('<content>')
      expect(cand.finalSynthesizedText).not.toContain('</content>')

      // =========================================================================
      // Step 11: Candidate Isolation Verification
      // =========================================================================
      console.log('[Step 11] Verify candidate isolation - chapter in DB remains untouched')
      const untouchedChap2 = chapterRepo.get(sessionId, chapter2.id)
      expect(untouchedChap2.content).not.toContain('月华如水')
      expect(untouchedChap2.version).toBe(1)

      // =========================================================================
      // Step 12: Concurrent Stale Invalidation Check
      // =========================================================================
      console.log('[Step 12] Verify stale candidate invalidation on concurrent edits')
      // Assemble a separate package and generate a second candidate
      const pkg2 = await contextAssembler.assembleContext({
        sessionId,
        connectionId: connId,
        taskType: 'continue',
        stage: 'content',
        workflowType: 'creation_workflow',
        outlineId: confirmedChapterOutline.id,
        outlineVersion: confirmedChapterOutline.version,
        instruction: '并发测试正文生成',
        target: { chapterId: chapter2.id }
      })

      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"测试并发过时内容。"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }

      const staleTestCreation = await creationRunner.startCreation(sessionId, pkg2.id)
      await new Promise((r) => setTimeout(r, 100))

      // Simulate concurrent chapter edit in DB
      store.transaction(sessionId, (db) => {
        db.prepare('UPDATE chapter SET version = 99, content = content || ? WHERE id = ?').run(
          '\n【并发修改】',
          chapter2.id
        )
      })

      // Attempting to apply stale candidate should fail with VERSION_CONFLICT or STALE_CANDIDATE
      expect(() => {
        candidateService.apply(sessionId, {
          sessionId,
          candidateId: staleTestCreation.candidateId,
          expectedCandidateVersion: 1,
          expectedChapterVersion: 1
        })
      }).toThrow('当前候选已失效')

      // Restore chapter 2 version for legitimate writeback
      store.transaction(sessionId, (db) => {
        db.prepare('UPDATE chapter SET version = 1, content = ? WHERE id = ?').run(
          '韩立在后山药园清理杂草，怀中的神秘小铜瓶忽然微微发热。\n他小心翼翼地取出铜瓶，只见瓶身隐隐有绿芒流转，吸收着四周稀薄的月华。',
          chapter2.id
        )
      })

      // =========================================================================
      // Step 13: Candidate Diff Review & Safe Atomic Writeback with Snapshot
      // =========================================================================
      console.log('[Step 13] Stage hunks and apply candidate with permanent snapshot')
      const applyResult = candidateService.apply(sessionId, {
        sessionId,
        candidateId: creationRes.candidateId,
        expectedCandidateVersion: 1,
        expectedChapterVersion: 1
      })

      expect(applyResult.chapter.version).toBe(2)
      expect(applyResult.chapter.content).toContain('月华如水')
      expect(applyResult.snapshot).toBeDefined()
      expect(applyResult.snapshot.id).toBeDefined()
      expect(applyResult.snapshot.snapshotKind).toBe('ai_apply')

      // Verify permanent snapshot created in DB
      store.read(sessionId, (db) => {
        const snap = db.prepare('SELECT id, snapshot_kind, chapter_id FROM chapter_snapshot WHERE id = ?').get(applyResult.snapshot.id) as any
        expect(snap).toBeDefined()
        expect(snap.snapshot_kind).toBe('ai_apply')
        expect(snap.chapter_id).toBe(chapter2.id)

        // Chapter outline should be cascade-marked stale after chapter content changed
        const outlineRow = db.prepare('SELECT state FROM chapter_outline WHERE id = ?').get(confirmedChapterOutline.id) as any
        expect(outlineRow.state).toBe('stale')
      })

      // =========================================================================
      // Step 14: Session Advances to 'reviewed' Stage
      // =========================================================================
      console.log('[Step 14] Advance session stage to reviewed')
      const reviewedSession = chatService.updateStage({
        sessionId,
        chatSessionId: creationSession.id,
        stage: 'reviewed',
        expectedVersion: contentSession.version
      })
      expect(reviewedSession.stage).toBe('reviewed')
      expect(reviewedSession.version).toBe(5)

      // =========================================================================
      // Step 15: Full Project Close, Reopen, and State / History Consistency
      // =========================================================================
      console.log('[Step 15] Reopen project and verify full state consistency across reloads')
      await store.closeAll()

      const reopened = await store.open(projectPath)
      const newSessionId = reopened.sessionId

      // Check chapters
      const reloadedChapters = chapterRepo.list(newSessionId)
      expect(reloadedChapters.length).toBe(2)
      const reloadedChap2 = reloadedChapters.find((c) => c.id === chapter2.id)!
      expect(reloadedChap2.version).toBe(2)
      expect(reloadedChap2.content).toContain('月华如水')

      // Check book outline (preserved without stale on writeback, ADR 0001)
      const reloadedBookOutline = store.getBookOutline(newSessionId)
      expect(reloadedBookOutline).toBeDefined()
      expect(reloadedBookOutline!.state).toBe('confirmed')
      expect(reloadedBookOutline!.version).toBe(2)

      // Check chapter outlines
      const reloadedChapterOutlines = store.listChapterOutlines(newSessionId, chapter2.id)
      expect(reloadedChapterOutlines.length).toBeGreaterThan(0)
      expect(reloadedChapterOutlines[0].state).toBe('stale')

      // Check chat session & messages
      const reloadedSessions = chatService.listSessions({ sessionId: newSessionId })
      expect(reloadedSessions.length).toBe(1)
      const reloadedSession = reloadedSessions[0]
      expect(reloadedSession.workflowType).toBe('creation_workflow')
      expect(reloadedSession.stage).toBe('reviewed')
      expect(reloadedSession.targetChapterId).toBe(chapter2.id)

      const reloadedMessages = chatService.listMessages({ sessionId: newSessionId, chatSessionId: reloadedSession.id })
      expect(reloadedMessages.length).toBe(4)
      expect(reloadedMessages[0].content).toContain('梳理第2章后续剧情方向')
      expect(reloadedMessages[1].content).toContain('【本章核心方向】')
      expect(reloadedMessages[2].content).toContain('方向已确认')
      expect(reloadedMessages[3].content).toContain('【本章目标】')

      // Check snapshots
      store.read(newSessionId, (db) => {
        const snapshots = db.prepare('SELECT snapshot_kind, chapter_id FROM chapter_snapshot WHERE chapter_id = ?').all(chapter2.id) as any[]
        expect(snapshots.some((s) => s.snapshot_kind === 'ai_apply')).toBe(true)
      })

      console.log('✅ All 15 steps passed successfully!')
    } finally {
      await store.closeAll()
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  }, 30000)
})
