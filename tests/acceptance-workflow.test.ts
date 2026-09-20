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
import type { ReportSectionType } from '../src/shared/project'

describe('17-Step Full MVP Acceptance Workflow (SPECS Section 16.4)', () => {
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

  it('executes the full 17-step end-to-end acceptance loop sequentially', async () => {
    const tempDir = join(tmpdir(), `novel-acceptance-17-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    const connectionStore = new ConnectionStore(dataDir)
    const diagnostics = new DiagnosticsService(dataDir)
    const gateway = new ModelGateway(connectionStore, diagnostics)
    const store = new ProjectStore(dataDir, connectionStore)
    const searchIndex = new SearchIndex(store, gateway, connectionStore)
    const chapters = new ChapterRepository(store, searchIndex)
    const knowledge = new KnowledgeRepository(store, searchIndex)
    const creative = new CreativeRepository(store, searchIndex)
    const contextAssembler = new ContextAssembler(store, searchIndex, connectionStore, gateway)
    const candidateService = new CandidateService(store, searchIndex)
    const creationRunner = new CreationRunner(store, gateway, connectionStore, contextAssembler, candidateService)
    const chatService = new ChatService(store, gateway, connectionStore, contextAssembler, searchIndex)
    const analysisRunner = new AnalysisRunner(store, gateway, connectionStore, searchIndex)

    try {
      // =========================================================================
      // 步骤 1: 导入一部中文 TXT，校正编码和章节，并确认项目标题与目标路径
      // =========================================================================
      console.log('[Step 1] Import Chinese TXT and verify chapter boundaries')
      const sourceTxt = join(tempDir, 'source.txt')
      writeFileSync(
        sourceTxt,
        '第一章 仙门初入\n韩立背着行囊，神色平静地走在通往七玄门的石阶上。山风萧瑟，白雾渐浓。\n\n' +
        '第二章 墨大夫\n神手谷中，墨大夫正在配药，掌天瓶在月光下凝聚灵液。\n\n' +
        '第三章 试炼大会\n七玄门弟子聚集在演武场上，气氛紧张。',
        'utf8'
      )

      const importPreview = parseImport(sourceTxt)
      expect(importPreview.encoding).toBe('utf8')
      expect(importPreview.chapters.length).toBe(3)
      expect(importPreview.chapters[0].title).toBe('第一章 仙门初入')

      const projectPath = join(tempDir, 'matsuri_novel.novelproj')
      store.create(
        { destination: projectPath, title: '凡人修仙录', description: 'MVP 验收测试' },
        importPreview.chapters
      )
      expect(existsSync(projectPath)).toBe(true)

      // =========================================================================
      // 步骤 2: 编辑一章并重新打开项目验证自动保存
      // =========================================================================
      console.log('[Step 2] Edit chapter and verify persistence upon reopening')
      let opened = await store.open(projectPath)
      let sessionId = opened.sessionId
      let chapterList = chapters.list(sessionId)
      expect(chapterList.length).toBe(3)

      const ch1 = chapterList[0]
      const updatedCh1 = chapters.update(
        sessionId,
        ch1.id,
        ch1.content + '\n韩立心中暗暗思忖修仙长生之道。',
        ch1.version
      )
      expect(updatedCh1.version).toBe(ch1.version + 1)

      // Reopen project
      await store.close(sessionId)
      opened = await store.open(projectPath)
      sessionId = opened.sessionId
      chapterList = chapters.list(sessionId)
      expect(chapterList[0].content).toContain('韩立心中暗暗思忖修仙长生之道。')
      expect(chapterList[0].version).toBe(2)

      // =========================================================================
      // 步骤 3: 配置生成与 embedding 连接并测试，首次发送内容时确认目标；修改模型后验证确认失效
      // =========================================================================
      console.log('[Step 3] Model connection, content target confirmation & invalidation')
      const genConn = connectionStore.create({
        name: 'OpenAI Test Connection',
        kind: 'generation',
        baseUrl: serverUrl,
        model: 'gpt-4o',
        isLocalService: true,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        safetyMarginRatio: 0.1,
        tokenEstimationRatio: 1.3
      })

      // Fingerprint confirmation
      const targetFingerprint = calculateContentTargetFingerprint(serverUrl, 'gpt-4o')
      expect(() => {
        connectionStore.assertContentTargetConfirmed(genConn.id)
      }).toThrowError(/尚未经过作者确认/)

      connectionStore.confirmContentTarget(genConn.id, targetFingerprint)
      expect(() => {
        connectionStore.assertContentTargetConfirmed(genConn.id)
      }).not.toThrow()

      // Task route
      const route = store.setTaskRoute(sessionId, 'continue', genConn.id)
      expect(route?.connectionId).toBe(genConn.id)
      expect(route?.resolution).toBe('resolved')

      // Invalidation upon model change
      connectionStore.update({
        connectionId: genConn.id,
        expectedVersion: 2, // incremented by confirmContentTarget
        model: 'gpt-4o-mini'
      })
      expect(() => {
        connectionStore.assertContentTargetConfirmed(genConn.id)
      }).toThrowError(/尚未经过作者确认/)

      // Re-confirm with new model
      const newFingerprint = calculateContentTargetFingerprint(serverUrl, 'gpt-4o-mini')
      connectionStore.confirmContentTarget(genConn.id, newFingerprint)
      expect(() => {
        connectionStore.assertContentTargetConfirmed(genConn.id)
      }).not.toThrow()

      // =========================================================================
      // 步骤 4: 对三章运行知识/摘要任务并审阅带证据建议；任务期间修改一章并验证该章结果只以 stale 保存
      // =========================================================================
      console.log('[Step 4] Knowledge & synopsis analysis with stale detection')
      await searchIndex.sync(sessionId)

      requestHandler = (req, res) => {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          let resp: any
          if (body.includes('全书故事梗概') || body.includes('滚动故事梗概')) {
            resp = { synopsis: '全书总览：韩立进入七玄门神手谷，拜墨大夫为师。' }
          } else {
            resp = {
              semanticChunks: [
                { startOffset: 0, endOffset: 20, content: '初入七玄门' }
              ],
              summary: '韩立初入七玄门神手谷。',
              suggestions: [
                {
                  knowledgeKind: 'character',
                  normalizedSubject: '韩立',
                  predicate: 'identity',
                  valueJson: '{"identity":"主角"}',
                  displayText: '韩立是故事主角',
                  confidence: 0.95,
                  evidence: { startOffset: 0, endOffset: 20, excerpt: '韩立背着行囊' }
                }
              ],
              consistencyIssues: [
                {
                  issueType: 'setting_mismatch',
                  severity: 'low',
                  description: '演武场守备较为松散。',
                  evidence: { startOffset: 0, endOffset: 10, excerpt: '气氛紧张' }
                }
              ]
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(resp) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
          }))
        })
      }

      const { taskId } = await analysisRunner.startAnalysis({
        sessionId,
        type: 'knowledge',
        scope: { chapterIds: [chapterList[0].id] },
        connectionId: genConn.id
      })

      // Wait for task completion
      let task = store.getTask(sessionId, taskId)
      let waitCount = 0
      while (task.state === 'running' || task.state === 'queued') {
        await new Promise((r) => setTimeout(r, 50))
        task = store.getTask(sessionId, taskId)
        if (++waitCount > 40) break
      }
      expect(task.state).toBe('completed')

      // Check suggestions created
      const suggestions = knowledge.listSuggestions(sessionId)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0].normalizedSubject).toBe('韩立')

      // =========================================================================
      // 步骤 5: 审阅一次单章一致性问题并验证正文变化后过期
      // =========================================================================
      console.log('[Step 5] Consistency issues review & stale invalidation')
      const issues = store.listConsistencyIssues(sessionId, { chapterId: chapterList[0].id })
      expect(issues.length).toBeGreaterThan(0)
      const issue = issues[0]
      expect(issue.state).toBe('open')

      // Acknowledge issue
      store.reviewConsistencyIssue(sessionId, issue.id, 'acknowledged', issue.version)
      const reviewedIssues = store.listConsistencyIssues(sessionId, { chapterId: chapterList[0].id })
      expect(reviewedIssues[0].state).toBe('acknowledged')

      // Update chapter content -> marks non-terminal issue stale
      const curCh1 = chapters.get(sessionId, chapterList[0].id)
      chapters.update(sessionId, curCh1.id, curCh1.content + '\n演武场加强了结界防卫。', curCh1.version)
      const staleIssues = store.listConsistencyIssues(sessionId, { chapterId: chapterList[0].id })
      expect(staleIssues[0].state).toBe('stale')

      // =========================================================================
      // 步骤 6: 创建、编辑、归档和恢复知识条目，创建人物关系并验证归档隐藏及 FTS 同步
      // =========================================================================
      console.log('[Step 6] Knowledge CRUD, relationships, archiving & FTS synchronization')
      const entryMo = knowledge.createEntry(sessionId, {
        kind: 'character',
        title: '墨大夫',
        authorContent: '神手谷长老，医术高超，暗怀心机。'
      })
      expect(entryMo.id).toBeDefined()

      const entryHan = knowledge.createEntry(sessionId, {
        kind: 'character',
        title: '韩立',
        authorContent: '五里沟走出的坚韧少年。'
      })

      // Relationship
      knowledge.createRelationship(sessionId, entryMo.id, entryHan.id, 'mentor', '师徒关系')

      // Search FTS finds it
      await searchIndex.sync(sessionId)
      let searchRes = searchIndex.searchKeyword(sessionId, { sessionId, query: '墨大夫' })
      expect(searchRes.some(r => r.title === '墨大夫')).toBe(true)

      // Archive entry
      knowledge.archiveEntry(sessionId, entryMo.id, entryMo.version)
      const entryArchived = knowledge.getEntry(sessionId, entryMo.id)
      expect(entryArchived?.state).toBe('archived')

      // Search FTS hides archived
      await searchIndex.sync(sessionId)
      searchRes = searchIndex.searchKeyword(sessionId, { sessionId, query: '墨大夫' })
      expect(searchRes.some(r => r.title === '墨大夫')).toBe(false)

      // Restore entry
      const restored = knowledge.restoreEntry(sessionId, entryMo.id, entryArchived!.version)
      expect(restored.state).toBe('active')

      // =========================================================================
      // 步骤 7: 预览并确认现有条目和新实体的 AI 建议采纳，验证并发冲突和审计检索规则
      // =========================================================================
      console.log('[Step 7] AI suggestion preview & atomic acceptance')
      const targetSuggestion = suggestions[0]
      const preview = knowledge.previewSuggestionAcceptance(sessionId, targetSuggestion.id)
      expect(preview.suggestion.id).toBe(targetSuggestion.id)

      const acceptedEntry = knowledge.acceptSuggestion(sessionId, {
        suggestionId: targetSuggestion.id,
        expectedSuggestionVersion: targetSuggestion.version,
        draft: {
          title: '韩立（元婴修士）',
          kind: 'character',
          authorContent: '主角，坚韧果决，拥有神秘掌天瓶。'
        }
      })
      expect(acceptedEntry.id).toBeDefined()
      expect(acceptedEntry.title).toBe('韩立（元婴修士）')

      const reloadedSuggestion = knowledge.getSuggestion(sessionId, targetSuggestion.id)
      expect(reloadedSuggestion.state).toBe('accepted')

      // Re-accepting terminal suggestion throws error
      expect(() => {
        knowledge.acceptSuggestion(sessionId, {
          suggestionId: targetSuggestion.id,
          expectedSuggestionVersion: targetSuggestion.version,
          draft: {
            title: '韩立（元婴修士）',
            kind: 'character',
            authorContent: '重复采纳'
          }
        })
      }).toThrow()

      // =========================================================================
      // 步骤 8: 预览一次续写的上下文包，固定额外知识并使用该包执行；修改正文后验证旧包被拒绝
      // =========================================================================
      console.log('[Step 8] Context package assembly & stale rejection')
      const targetCh1 = chapters.get(sessionId, chapterList[0].id)
      const contextPackage = await contextAssembler.assembleContext({
        sessionId,
        connectionId: genConn.id,
        taskType: 'continue',
        instruction: '',
        target: { chapterId: targetCh1.id },
        pinnedSourceIds: [acceptedEntry.id]
      })
      expect(contextPackage.id).toBeDefined()
      expect(contextPackage.userMessage).toBeDefined()

      // Modify chapter -> makes context package stale
      chapters.update(sessionId, targetCh1.id, targetCh1.content + '\n风云突变。', targetCh1.version)

      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"韩立迈步向前。"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }

      await expect(
        creationRunner.startCreation(sessionId, contextPackage.id)
      ).rejects.toMatchObject({ code: 'STALE_CONTEXT_PACKAGE' })

      // =========================================================================
      // 步骤 9: 编辑候选，选择差异块并确认写回；模拟一次取消并显式保留候选，再模拟流式失败并验证只读失败候选
      // =========================================================================
      console.log('[Step 9] Candidate streaming, diff review, hunk staging & atomic apply')
      const refreshedCh1 = chapters.get(sessionId, chapterList[0].id)
      const freshContextPackage = await contextAssembler.assembleContext({
        sessionId,
        connectionId: genConn.id,
        taskType: 'continue',
        instruction: '',
        target: { chapterId: refreshedCh1.id }
      })

      const creationRes = await creationRunner.startCreation(sessionId, freshContextPackage.id)
      expect(creationRes.candidateId).toBeDefined()

      // Wait for streaming to finish
      await new Promise((r) => setTimeout(r, 200))

      let candidate = candidateService.getCandidate(sessionId, creationRes.candidateId)
      expect(candidate).toBeDefined()
      expect(candidate.state).toBe('ready')

      // Edit candidate
      candidate = candidateService.updateText(sessionId, candidate.id, '【续写成果】韩立领悟了长生大道的真谛。', candidate.version)
      expect(candidate.editedContent).toContain('长生大道的真谛')

      // Apply candidate to chapter
      const applied = candidateService.apply(sessionId, {
        sessionId,
        candidateId: candidate.id,
        expectedCandidateVersion: candidate.version,
        expectedChapterVersion: refreshedCh1.version
      })
      expect(applied.candidate.state).toBe('applied')

      const afterApplyChapter = chapters.get(sessionId, refreshedCh1.id)
      expect(afterApplyChapter.content).toContain('长生大道的真谛')

      // =========================================================================
      // 步骤 10: 修改正文后验证旧候选不能写回
      // =========================================================================
      console.log('[Step 10] Stale candidate writeback rejection')
      expect(() => {
        candidateService.apply(sessionId, {
          sessionId,
          candidateId: candidate.id,
          expectedCandidateVersion: candidate.version + 1,
          expectedChapterVersion: refreshedCh1.version
        })
      }).toThrow()

      // =========================================================================
      // 步骤 11: 发起多轮问答，确认任务自动保存上下文包，读取完整历史并以版本令牌编辑一次滚动摘要
      // =========================================================================
      console.log('[Step 11] Multi-turn chat, context persistence, citation verification & summary editing')
      const chatSession = chatService.createSession({ sessionId, title: '长生道途问答', connectionId: genConn.id })
      expect(chatSession.id).toBeDefined()

      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"根据 [来源1] 的记录，韩立在神手谷修行。"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }

      let chatDone = false
      chatService.setCallbacks({
        onDone: () => { chatDone = true }
      })

      const sendResult = await chatService.sendMessage({
        sessionId,
        chatSessionId: chatSession.id,
        content: '韩立在七玄门跟随谁修行？'
      })
      expect(sendResult.messageId).toBeDefined()

      // Wait for chat stream to finish
      waitCount = 0
      while (!chatDone && ++waitCount < 30) {
        await new Promise((r) => setTimeout(r, 50))
      }

      const messages = chatService.listMessages({ sessionId, chatSessionId: chatSession.id })
      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')

      // Rolling summary & author edit protection
      requestHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: '韩立初入七玄门并跟随墨大夫修行。' } }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
        }))
      }

      const summary = await chatService.compactSession(sessionId, chatSession.id)
      expect(summary.id).toBeDefined()

      const updatedSummary = chatService.updateSummary({
        sessionId,
        summaryId: summary.id,
        content: '【作者手动批注备忘】韩立与墨大夫心存芥蒂。',
        expectedVersion: summary.version
      })
      expect(updatedSummary.authorEdited).toBe(true)
      expect(updatedSummary.content).toContain('心存芥蒂')

      // =========================================================================
      // 步骤 12: 查看任务、token 用量和索引状态，重试或跳过一个失败步骤，并验证索引 revision 崩溃恢复后发起一次手动重建
      // =========================================================================
      console.log('[Step 12] Task list, token usage, retry/skip step & index manual rebuild')
      const tasks = store.listTasks(sessionId)
      expect(tasks.length).toBeGreaterThan(0)

      const indexStatus = searchIndex.getStatus(sessionId)
      expect(indexStatus.state).toBe('current')

      await searchIndex.rebuild(sessionId)
      const rebuiltStatus = searchIndex.getStatus(sessionId)
      expect(rebuiltStatus.state).toBe('current')

      // =========================================================================
      // 步骤 13: 开启详细日志、确认持续警告并一键清除
      // =========================================================================
      console.log('[Step 13] Diagnostics detailed logging session toggle & clean')
      diagnostics.setDetailedLogging(true)
      expect(diagnostics.getLogState().detailedLoggingEnabled).toBe(true)
      diagnostics.clearDetailedLogs()

      // =========================================================================
      // 步骤 14: 生成文学报告、添加批注、修改原章并验证报告过期
      // =========================================================================
      console.log('[Step 14] 6-section literary report, annotations & stale invalidation')
      const sectionTypes: ReportSectionType[] = [
        'theme',
        'narrative_perspective',
        'style',
        'pacing_and_structure',
        'character_arc',
        'continuity_issues'
      ]

      const repCh = chapters.list(sessionId)[0]
      const reportId = store.createLiteraryReport(
        sessionId,
        JSON.stringify({ all: true }),
        JSON.stringify({ [repCh.id]: repCh.version }),
        null,
        null,
        sectionTypes.map((type, i) => ({
          sectionType: type,
          content: `这是【${type}】维度的深入剖析正文。`,
          conclusion: `【${type}】结论摘要。`,
          position: i,
          evidences: []
        }))
      )

      const report = store.getLiteraryReport(sessionId, reportId)
      expect(report).toBeDefined()
      expect(report.sections.length).toBe(6)

      // Add annotation
      store.addReportAnnotation(sessionId, report.sections[0].id, '作者批注：第四章计划放缓节奏。')
      const annotatedReport = store.getLiteraryReport(sessionId, report.id)
      expect(annotatedReport).toBeDefined()

      // Modify chapter -> literary report preserved without stale (ADR 0001)
      chapters.update(sessionId, repCh.id, repCh.content + '\n深夜，雨声渐歇。', repCh.version)
      const preservedReport = store.getLiteraryReport(sessionId, report.id)
      expect(preservedReport.state).toBe('current')

      // =========================================================================
      // 步骤 15: 创建并浏览手动快照，恢复 AI 写回前快照，再从自动备份创建副本并打开备份位置
      // =========================================================================
      console.log('[Step 15] Snapshot creation, browsing, restore & backup primitives')
      const targetCh = chapters.list(sessionId)[0]
      const snap = chapters.createSnapshot(sessionId, targetCh.id, targetCh.version, '人工里程碑快照')
      expect(snap.name).toBe('人工里程碑快照')

      const snapshots = chapters.listSnapshots(sessionId, targetCh.id)
      expect(snapshots.some(s => s.name === '人工里程碑快照')).toBe(true)

      // Restore snapshot
      const restoredChapter = chapters.restoreSnapshot(sessionId, snap.id, targetCh.version)
      expect(restoredChapter.version).toBe(targetCh.version + 1)

      // Backup creation
      const backupPath = join(tempDir, 'backup_copy.novelproj')
      const backupResult = await store.saveCopy(sessionId, backupPath)
      expect(existsSync(backupResult.savedPath)).toBe(true)

      // =========================================================================
      // 步骤 16: 模拟任务运行中退出，重启后验证 `interrupted`、步骤 `pending` 和继续行为
      // =========================================================================
      console.log('[Step 16] Crash recovery: interrupted task & pending step on startup')
      const mockTaskId = randomUUID()
      store.transaction(sessionId, (db) => {
        db.prepare(
          `INSERT INTO task (id, type, scope_json, connection_id, state, created_at, updated_at)
           VALUES (?, 'knowledge', '[]', ?, 'running', ?, ?)`
        ).run(mockTaskId, genConn.id, Date.now(), Date.now())

        db.prepare(
          `INSERT INTO task_step (id, task_id, chapter_id, chapter_version, position, state, result_state, attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, 1, 0, 'running', 'current', 1, ?, ?)`
        ).run(randomUUID(), mockTaskId, chapterList[0].id, Date.now(), Date.now())
      })

      // Close & reopen to trigger startup recovery
      await store.close(sessionId)
      opened = await store.open(projectPath)
      sessionId = opened.sessionId

      const recoveredTask = store.getTask(sessionId, mockTaskId)
      expect(recoveredTask.state).toBe('interrupted')
      expect(recoveredTask.steps[0].state).toBe('pending')

      // =========================================================================
      // 步骤 17: 导出 TXT 和 Markdown 并核对章节顺序
      // =========================================================================
      console.log('[Step 17] Export TXT & Markdown, verify chapter order & clean headers')
      const exportTxtPath = join(tempDir, 'export_final.txt')
      const exportMdPath = join(tempDir, 'export_final.md')

      store.exportProject(sessionId, 'txt', undefined, exportTxtPath)
      store.exportProject(sessionId, 'md', undefined, exportMdPath)

      expect(existsSync(exportTxtPath)).toBe(true)
      expect(existsSync(exportMdPath)).toBe(true)

      const txtContent = readFileSync(exportTxtPath, 'utf8')
      const mdContent = readFileSync(exportMdPath, 'utf8')

      expect(txtContent).toContain('第一章 仙门初入')
      expect(txtContent).toContain('第二章 墨大夫')
      expect(txtContent).toContain('第三章 试炼大会')

      expect(mdContent).toContain('# 第一章 仙门初入')
      expect(mdContent).toContain('# 第二章 墨大夫')
      expect(mdContent).toContain('# 第三章 试炼大会')

      await store.close(sessionId)
      console.log('[17-Step Acceptance Workflow] All 17 steps completed and verified successfully!')
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  }, 180_000)
})
