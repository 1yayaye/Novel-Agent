import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { AnalysisRunner } from '../src/main/analysis-runner'

describe('AnalysisRunner - Phase 7 Tasks, Knowledge Analysis & Reports', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  let tempDir: string
  let connectionStore: ConnectionStore
  let diagnostics: DiagnosticsService
  let gateway: ModelGateway
  let store: ProjectStore
  let searchIndex: SearchIndex
  let chapters: ChapterRepository
  let runner: AnalysisRunner

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

  beforeEach(() => {
    tempDir = join(tmpdir(), `novel-agent-analysis-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    connectionStore = new ConnectionStore(dataDir)
    diagnostics = new DiagnosticsService(dataDir)
    gateway = new ModelGateway(connectionStore, diagnostics)
    store = new ProjectStore(dataDir, connectionStore)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    runner = new AnalysisRunner(store, gateway, connectionStore, searchIndex)
  })

  afterEach(async () => {
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('runs single-chapter knowledge analysis with valid semantic boundaries, summary, suggestions and issues', async () => {
    const projectPath = join(tempDir, 'test-project.novelproj')
    const chapter1Content = '林萧站在青云山巅，手中断云剑泛起青芒。他望向远处的云海，心中默念着师傅的嘱托。'
    store.create({ destination: projectPath, title: '仙侠传', description: '' }, [
      { title: '第一章 剑起青云', content: chapter1Content }
    ])

    const opened = await store.open(projectPath)
    const chapterList = chapters.list(opened.sessionId)
    const chap1 = chapterList[0]

    // Create & confirm model connection
    const conn = connectionStore.create({
      name: 'Test Generation Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    const fp = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    connectionStore.confirmContentTarget(conn.id, fp)

    // Mock response for chapter analysis and trailing synopsis
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        let responseContent: string
        if (body.includes('滚动故事梗概')) {
          responseContent = JSON.stringify({ synopsis: '全书故事宏观总览：林萧手持断云剑，在青云宗踏上修仙之路。' })
        } else if (body.includes('全书大纲')) {
          responseContent = JSON.stringify({ outlineMarkdown: '# 全书大纲\n\n## 故事主线\n林萧踏上修仙之路。' })
        } else {
          responseContent = JSON.stringify({
            semanticChunks: [
              { startOffset: 0, endOffset: 20, content: chapter1Content.slice(0, 20) },
              { startOffset: 20, endOffset: chapter1Content.length, content: chapter1Content.slice(20) }
            ],
            summary: '林萧在青云山巅回想师傅嘱托，手中握紧断云剑。',
            suggestions: [
              {
                knowledgeKind: 'character',
                normalizedSubject: '林萧',
                predicate: 'weapon',
                valueJson: '{"weapon":"断云剑"}',
                displayText: '林萧使用断云剑',
                confidence: 0.95,
                evidence: { startOffset: 10, endOffset: 16, excerpt: '手中断云剑泛起青芒' }
              }
            ],
            consistencyIssues: [
              {
                issueType: 'setting_mismatch',
                severity: 'low',
                description: '青芒出现时周围无灵气波动描写',
                evidence: { startOffset: 13, endOffset: 17, excerpt: '泛起青芒' }
              }
            ]
          })
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: responseContent } }],
          usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 }
        }))
      })
    }

    const { taskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'knowledge',
      scope: { chapterIds: [chap1.id] },
      connectionId: conn.id
    })

    // Poll until task finishes
    let task = store.getTask(opened.sessionId, taskId)
    let attempts = 0
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((r) => setTimeout(r, 50))
      task = store.getTask(opened.sessionId, taskId)
      if (++attempts > 40) break
    }

    expect(task.state).toBe('completed')
    expect(task.steps[0].state).toBe('completed')
    expect(task.steps[0].resultState).toBe('current')
    expect(task.inputTokens).toBeGreaterThan(0)
    expect(task.outputTokens).toBeGreaterThan(0)

    // Verify Chapter Summary
    const summary = store.getChapterSummary(opened.sessionId, chap1.id)
    expect(summary).not.toBeNull()
    expect(summary?.summary).toContain('断云剑')
    expect(summary?.state).toBe('current')

    // Verify Consistency Issues
    const issues = store.listConsistencyIssues(opened.sessionId, { chapterId: chap1.id })
    expect(issues.length).toBe(1)
    expect(issues[0].issueType).toBe('setting_mismatch')
    expect(issues[0].state).toBe('open')
    expect(issues[0].evidences.length).toBe(1)

    // Verify Book Synopsis generated automatically
    const synopsis = store.getSynopsis(opened.sessionId)
    expect(synopsis).not.toBeNull()
    expect(synopsis?.summary).toContain('全书故事宏观总览')
  })

  it('carries rolling knowledge state across chapters and stores checkpoints', async () => {
    const projectPath = join(tempDir, 'test-rolling-knowledge.novelproj')
    store.create({ destination: projectPath, title: '连续上下文测试', description: '' }, [
      { title: '第一章', content: '第一章正文' },
      { title: '第二章', content: '第二章正文' }
    ])

    const opened = await store.open(projectPath)
    const chapterList = chapters.list(opened.sessionId)
    const conn = connectionStore.create({
      name: 'Rolling Test',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const knowledgeBodies: string[] = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (body.includes('滚动故事梗概')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ synopsis: '最终滚动梗概' }) } }] }))
          return
        }
        if (body.includes('全书大纲')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outlineMarkdown: '# 全书大纲' }) } }] }))
          return
        }

        if (body.includes('【章节名称】')) knowledgeBodies.push(body)
        const secondChapter = body.includes('【章节名称】第二章')
        const rollingState = {
          mainline: secondChapter ? '第一章已确认：林萧持有断云剑；第二章推进冲突' : '第一章已确认：林萧持有断云剑',
          characters: '林萧：外门弟子',
          world: '青云宗存在灵剑传承',
          relations: '',
          timeline: secondChapter ? '第二章紧接第一章' : '第一章起始',
          foreshadowing: '断云剑的来历待揭示',
          unresolved: secondChapter ? '断云剑来历' : '师傅嘱托'
        }
        const responseData = {
          summary: secondChapter ? '第二章推进了林萧与断云剑的主线。' : '第一章确立林萧与断云剑。',
          suggestions: [],
          consistencyIssues: [],
          rollingState
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseData) } }] }))
      })
    }

    const { taskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'knowledge',
      scope: { chapterIds: chapterList.map((chapter) => chapter.id) },
      connectionId: conn.id
    })

    let task = store.getTask(opened.sessionId, taskId)
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      task = store.getTask(opened.sessionId, taskId)
    }

    expect(task.state).toBe('completed')
    expect(knowledgeBodies).toHaveLength(2)
    expect(knowledgeBodies[1]).toContain('第一章已确认：林萧持有断云剑')
    expect(knowledgeBodies[1]).toContain('只输出当前章节相对于前文滚动状态的新增或变化内容')
    expect(JSON.parse(task.steps[0].checkpointJson ?? '{}').mainline).toContain('第一章已确认')
    expect(JSON.parse(task.steps[1].checkpointJson ?? '{}').mainline).toContain('第二章推进冲突')
    expect(store.getChapterSummary(opened.sessionId, chapterList[0].id)?.summary).toContain('第一章')
    expect(store.getChapterSummary(opened.sessionId, chapterList[1].id)?.summary).toContain('第二章')
    expect(store.getSynopsis(opened.sessionId)?.summary).toBe('最终滚动梗概')
  })

  it('resumes from a checkpoint and retries a failed step without using its checkpoint', async () => {
    const projectPath = join(tempDir, 'test-rolling-recovery.novelproj')
    store.create({ destination: projectPath, title: '滚动恢复测试', description: '' }, [
      { title: '第一章', content: '第一章正文' },
      { title: '第二章', content: '第二章正文' },
      { title: '第三章', content: '第三章正文' }
    ])

    const opened = await store.open(projectPath)
    const chapterList = chapters.list(opened.sessionId)
    const conn = connectionStore.create({
      name: 'Recovery Test',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const task = store.createTask(opened.sessionId, 'knowledge', '{}', conn.id, chapterList.map((chapter) => chapter.id))
    const firstState = {
      mainline: '第一章已确认：林萧持有断云剑',
      characters: '林萧：外门弟子',
      world: '青云宗存在灵剑传承',
      relations: '',
      timeline: '第一章起始',
      foreshadowing: '断云剑的来历待揭示',
      unresolved: '师傅嘱托'
    }
    store.updateTaskStep(opened.sessionId, task.steps[0].id, {
      state: 'completed',
      resultState: 'current',
      checkpointJson: JSON.stringify(firstState)
    })
    store.updateTask(opened.sessionId, task.id, { state: 'interrupted' })

    let failSecond = true
    const knowledgeBodies: string[] = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (body.includes('【章节名称】')) knowledgeBodies.push(body)
        if (body.includes('【章节名称】第二章') && failSecond) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: '第二章请求失败' } }))
          return
        }
        if (body.includes('滚动故事梗概')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ synopsis: '恢复后的全书梗概' }) } }] }))
          return
        }
        if (body.includes('全书大纲')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outlineMarkdown: '# 全书大纲' }) } }] }))
          return
        }

        const secondChapter = body.includes('【章节名称】第二章')
        const responseData = {
          summary: secondChapter ? '第二章重试摘要' : '第三章摘要',
          suggestions: [],
          consistencyIssues: [],
          rollingState: {
            ...firstState,
            mainline: secondChapter ? '第二章重试已确认' : '第三章已确认',
            timeline: secondChapter ? '第二章紧接第一章' : '第三章紧接第二章'
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseData) } }] }))
      })
    }

    await runner.resumeTask({ sessionId: opened.sessionId, taskId: task.id })
    let current = store.getTask(opened.sessionId, task.id)
    while (current.state === 'running' || current.state === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      current = store.getTask(opened.sessionId, task.id)
    }

    expect(current.state).toBe('failed')
    expect(current.steps[1].state).toBe('failed')
    expect(current.steps[2].state).toBe('pending')
    expect(knowledgeBodies[0]).toContain('第一章已确认：林萧持有断云剑')

    store.updateTaskStep(opened.sessionId, current.steps[1].id, {
      checkpointJson: JSON.stringify({ ...firstState, mainline: '失败步骤旧状态' })
    })
    failSecond = false
    await runner.retryStep({ sessionId: opened.sessionId, taskId: task.id, stepId: current.steps[1].id })
    current = store.getTask(opened.sessionId, task.id)
    while (current.state === 'running' || current.state === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      current = store.getTask(opened.sessionId, task.id)
    }

    const secondBodies = knowledgeBodies.filter((body) => body.includes('【章节名称】第二章'))
    const thirdBody = knowledgeBodies.find((body) => body.includes('【章节名称】第三章'))
    expect(current.state).toBe('completed')
    expect(secondBodies.length).toBeGreaterThan(1)
    expect(secondBodies.at(-1)).toContain('第一章已确认：林萧持有断云剑')
    expect(secondBodies.at(-1)).not.toContain('失败步骤旧状态')
    expect(thirdBody).toContain('第二章重试已确认')
  }, 15000)

  it('rejects invalid semantic boundaries and safely retains temporary chunks without error', async () => {
    const projectPath = join(tempDir, 'test-invalid-boundary.novelproj')
    const chapter1Content = '第一段文字。第二段文字。第三段文字。'
    store.create({ destination: projectPath, title: '测试作品', description: '' }, [
      { title: '第一章', content: chapter1Content }
    ])

    const opened = await store.open(projectPath)
    const chap1 = chapters.list(opened.sessionId)[0]

    const conn = connectionStore.create({
      name: 'Test Gen',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        let responseData: any
        if (body.includes('滚动故事梗概')) {
          responseData = { synopsis: '故事总览' }
        } else if (body.includes('全书大纲')) {
          responseData = { outlineMarkdown: '# 全书大纲\n\n## 故事主线' }
        } else {
          responseData = {
            semanticChunks: [
              { startOffset: 0, endOffset: 5, content: chapter1Content.slice(0, 5) },
              { startOffset: 10, endOffset: chapter1Content.length, content: chapter1Content.slice(10) }
            ],
            summary: '摘要正常。',
            suggestions: [],
            consistencyIssues: []
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(responseData) } }]
        }))
      })
    }

    const { taskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'knowledge',
      scope: { chapterIds: [chap1.id] },
      connectionId: conn.id
    })

    let task = store.getTask(opened.sessionId, taskId)
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((r) => setTimeout(r, 50))
      task = store.getTask(opened.sessionId, taskId)
    }

    expect(task.state).toBe('completed')
    expect(task.steps[0].resultState).toBe('current')

    // Verify summary is saved even though semantic chunks were rejected
    const summary = store.getChapterSummary(opened.sessionId, chap1.id)
    expect(summary?.summary).toBe('摘要正常。')
  })

  it('commit gate: marks results and step as stale if chapter was updated during analysis', async () => {
    const projectPath = join(tempDir, 'test-stale-gate.novelproj')
    const chapter1Content = '原始正文内容'
    store.create({ destination: projectPath, title: '测试作品', description: '' }, [
      { title: '第一章', content: chapter1Content }
    ])

    const opened = await store.open(projectPath)
    const chap1 = chapters.list(opened.sessionId)[0]

    // Create a task first
    const task = store.createTask(opened.sessionId, 'knowledge', '{}', null, [chap1.id])

    const commitRes = store.commitChapterAnalysis(opened.sessionId, {
      taskId: task.id,
      stepId: task.steps[0].id,
      chapterId: chap1.id,
      capturedChapterVersion: chap1.version + 1, // Mismatched captured version!
      capturedSourceHash: 'mismatched-hash',
      summary: '晚到的分析摘要',
      suggestions: [
        {
          knowledgeKind: 'character',
          normalizedSubject: '林萧',
          predicate: 'identity',
          valueJson: '{}',
          displayText: '林萧是外门弟子',
          evidence: { startOffset: 0, endOffset: 2, excerpt: '原始' }
        }
      ],
      consistencyIssues: [
        {
          issueType: 'plot_hole',
          severity: 'medium',
          description: '逻辑漏洞'
        }
      ]
    })

    expect(commitRes.resultState).toBe('stale')

    // The summary in DB should have state = 'stale'
    const summary = store.getChapterSummary(opened.sessionId, chap1.id)
    expect(summary?.state).toBe('stale')

    // The issue in DB should have state = 'stale'
    const issues = store.listConsistencyIssues(opened.sessionId, { chapterId: chap1.id })
    expect(issues[0].state).toBe('stale')
  })

  it('handles task cancellation and failure retry/skip workflow', async () => {
    const projectPath = join(tempDir, 'test-retry-skip.novelproj')
    store.create({ destination: projectPath, title: '多章任务测试', description: '' }, [
      { title: '第1章', content: '内容1' },
      { title: '第2章', content: '内容2' },
      { title: '第3章', content: '内容3' }
    ])

    const opened = await store.open(projectPath)
    const chapterList = chapters.list(opened.sessionId)

    const conn = connectionStore.create({
      name: 'Test Gen',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let failStep2 = true
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        if (body.includes('【章节名称】第2章') && failStep2) {
          // Fail on step 2 with 400 (not retried)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Invalid prompt for step 2' } }))
          return
        }
        const resp = body.includes('滚动故事梗概')
          ? { synopsis: '全书总览' }
          : body.includes('全书大纲')
          ? { outlineMarkdown: '# 全书大纲\n\n## 故事主线' }
          : { summary: '章节摘要' }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(resp) } }]
        }))
      })
    }

    const { taskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'knowledge',
      scope: { chapterIds: chapterList.map((c) => c.id) },
      connectionId: conn.id
    })

    let task = store.getTask(opened.sessionId, taskId)
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((r) => setTimeout(r, 50))
      task = store.getTask(opened.sessionId, taskId)
    }

    expect(task.state).toBe('failed')
    expect(task.steps[0].state).toBe('completed')
    expect(task.steps[1].state).toBe('failed')
    expect(task.steps[2].state).toBe('pending')

    // Test skipStep on failed step
    const step2 = task.steps[1]
    const updatedSummary = await runner.skipStep({
      sessionId: opened.sessionId,
      taskId,
      stepId: step2.id
    })

    expect(updatedSummary.state).toBe('queued')

    // Wait for task to resume and finish step 3
    task = store.getTask(opened.sessionId, taskId)
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((r) => setTimeout(r, 50))
      task = store.getTask(opened.sessionId, taskId)
    }

    expect(task.state).toBe('completed')
    expect(task.steps[1].state).toBe('skipped')
    expect(task.steps[2].state).toBe('completed')
  }, 15000)

  it('generates 6-section literary reports and supports author annotations', async () => {
    const projectPath = join(tempDir, 'test-report.novelproj')
    store.create({ destination: projectPath, title: '长篇文学作品', description: '' }, [
      { title: '序幕', content: '风雪漫天，古道荒凉。' }
    ])

    const opened = await store.open(projectPath)
    const chap = chapters.list(opened.sessionId)[0]

    const conn = connectionStore.create({
      name: 'Report Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = (_req, res) => {
      const reportData = {
        theme: { content: '关于命运与抗争的主题探索。', conclusion: '核心思想深刻。', evidenceExcerpts: [] },
        narrative_perspective: { content: '采用第三人称全知视角。', conclusion: '叙事沉稳宏大。', evidenceExcerpts: [] },
        style: { content: '语言凝练质朴，富有古典韵味。', conclusion: '文笔优美流畅。', evidenceExcerpts: [] },
        pacing_and_structure: { content: '节奏由缓至急，层层递进。', conclusion: '结构严谨工整。', evidenceExcerpts: [] },
        character_arc: { content: '人物心境随着困境发生蜕变。', conclusion: '塑造立体鲜活。', evidenceExcerpts: [] },
        continuity_issues: { content: '未发现明显时间线错乱。', conclusion: '逻辑保持连贯。', evidenceExcerpts: [] }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reportData) } }]
      }))
    }

    const { taskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'report',
      scope: { all: true },
      connectionId: conn.id
    })

    let task = store.getTask(opened.sessionId, taskId)
    while (task.state === 'running' || task.state === 'queued') {
      await new Promise((r) => setTimeout(r, 50))
      task = store.getTask(opened.sessionId, taskId)
    }

    expect(task.state).toBe('completed')

    // List reports
    const reportList = store.listLiteraryReports(opened.sessionId)
    expect(reportList.length).toBe(1)
    expect(reportList[0].state).toBe('current')

    // Get report detail
    const reportDetail = store.getLiteraryReport(opened.sessionId, reportList[0].id)
    expect(reportDetail.sections.length).toBe(6)
    expect(reportDetail.sections.find((s) => s.sectionType === 'theme')?.conclusion).toBe('核心思想深刻。')

    // Add author annotation to theme section
    const themeSection = reportDetail.sections.find((s) => s.sectionType === 'theme')!
    const annotation = store.addReportAnnotation(opened.sessionId, themeSection.id, '作者注：此处伏笔将在第三卷呼应。')
    expect(annotation.id).toBeDefined()
    expect(annotation.content).toContain('第三卷呼应')

    // Update annotation
    const updatedAnnotation = store.updateReportAnnotation(opened.sessionId, annotation.id, '作者注：已在第十章提前铺垫。')
    expect(updatedAnnotation.content).toBe('作者注：已在第十章提前铺垫。')

    // Editing chapter preserves existing literary reports (ADR 0001)
    chapters.update(opened.sessionId, chap.id, '修改后的正文内容', chap.version)
    const reportListAfterEdit = store.listLiteraryReports(opened.sessionId)
    expect(reportListAfterEdit[0].state).toBe('current')

    // Delete annotation
    const delRes = store.deleteReportAnnotation(opened.sessionId, annotation.id)
    expect(delRes.success).toBe(true)
  })

  it('runs segmented style distillation and book summary pipelines and persists their outputs', async () => {
    const projectPath = join(tempDir, 'test-distill-summary.novelproj')
    const content = '春风吹过长街。'.repeat(220)
    store.create({ destination: projectPath, title: '分阶段流水线', description: '' }, [
      { title: '第一章', content }
    ])

    const opened = await store.open(projectPath)
    const conn = connectionStore.create({
      name: 'Pipeline Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const pipelineBodies: string[] = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        pipelineBodies.push(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            formula: '短句与感官描写交替',
            observations: ['段落以环境变化转场'],
            prompt: '以短句、感官细节推进场景',
            summary: '主角离开长街，决定继续前行。',
            state: {
              mainline: '主角继续前行',
              characters: '主角独自行走',
              world: '春日长街',
              relations: '',
              timeline: '春日',
              foreshadowing: '',
              unresolved: ''
            },
            synopsis: '主角在春日长街继续前行。'
          }) } }]
        }))
      })
    }

    for (const type of ['style_distill', 'book_summary'] as const) {
      const { taskId } = await runner.startAnalysis({
        sessionId: opened.sessionId,
        type,
        scope: { all: true, segmentSize: 1000 },
        connectionId: conn.id,
        instruction: `用户编辑指令-${type}`
      })
      let task = store.getTask(opened.sessionId, taskId)
      let attempts = 0
      while (task.state === 'running' || task.state === 'queued') {
        await new Promise((resolve) => setTimeout(resolve, 50))
        task = store.getTask(opened.sessionId, taskId)
        if (++attempts > 100) break
      }

      expect(task.state).toBe('completed')
      expect(task.steps.length).toBeGreaterThan(1)
      expect(task.steps.every((step) => step.state === 'completed')).toBe(true)
      expect(pipelineBodies.some((body) => body.includes(`用户编辑指令-${type}`))).toBe(true)
    }

    const sample = store.read(opened.sessionId, (database) => database.prepare(
      "SELECT content FROM style_sample WHERE tags_json LIKE '%style_distill%' ORDER BY created_at DESC LIMIT 1"
    ).get() as { content: string } | undefined)
    expect(sample?.content).toContain('以短句、感官细节推进场景')
    expect(store.getSynopsis(opened.sessionId)?.summary).toBe('主角在春日长街继续前行。')
  }, 15000)
})
