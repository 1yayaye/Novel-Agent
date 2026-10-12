import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { AnalysisRunner } from '../src/main/analysis-runner'
import { PromptSettingsStore } from '../src/main/prompt-store'
import { PROMPT_DEFINITIONS } from '../src/main/prompt-preset'

function schemaOf(body: string) {
  const request = JSON.parse(body)
  const fallback = request.messages?.find((message: { role: string; content: string }) => message.role === 'system' && message.content.startsWith('输出必须符合以下 JSON Schema'))
  const schema = request.response_format?.json_schema.schema ?? (fallback ? JSON.parse(fallback.content.slice(fallback.content.indexOf('\n') + 1)) : undefined)
  return schema?.properties ?? {}
}

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
  let promptStore: PromptSettingsStore
  let searchIndex: SearchIndex
  let chapters: ChapterRepository
  let runner: AnalysisRunner
  const schemaProtocols = new Set<string>()

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
    expect([...schemaProtocols]).toEqual(expect.arrayContaining([
      'knowledge', 'report', 'synopsis_compress', 'synopsis_step', 'synopsis_final',
      'distill_segment', 'distill_stage', 'distill_master', 'summary_segment', 'summary_stage', 'summary_master', 'book_outline'
    ]))
    server.closeAllConnections()
    server.close(() => resolve())
  }))

  beforeEach(() => {
    tempDir = join(tmpdir(), `novel-agent-analysis-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })
    promptStore = new PromptSettingsStore(dataDir)

    connectionStore = new ConnectionStore(dataDir)
    diagnostics = new DiagnosticsService(dataDir)
    gateway = new ModelGateway(connectionStore, diagnostics)
    const generate = gateway.generateStructuredJson.bind(gateway)
    vi.spyOn(gateway, 'generateStructuredJson').mockImplementation((options) => {
      expect(options.jsonSchema).toEqual(z.toJSONSchema(options.zodSchema))
      const definition = PROMPT_DEFINITIONS.find((entry) => entry.id.startsWith('task.') && options.messages.some((message) => message.role === 'system' && message.content === entry.content))
      expect(definition).toBeDefined()
      schemaProtocols.add(definition!.id.slice(5))
      const schema = options.jsonSchema as { properties: Record<string, any> }
      expect(Object.keys(schema.properties).length).toBeGreaterThan(0)
      if (definition!.id === 'task.report') {
        expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['theme', 'narrative_perspective', 'style', 'pacing_and_structure', 'character_arc', 'continuity_issues']))
        for (const section of Object.values(schema.properties)) expect(section.properties).toHaveProperty('evidenceExcerpts')
      }
      return generate(options)
    })
    store = new ProjectStore(dataDir, connectionStore)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    runner = new AnalysisRunner(store, promptStore, gateway, connectionStore, searchIndex)
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
    const interceptedRequests: Array<{ body: string; messages: Array<{ role: string; content: string }> }> = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          interceptedRequests.push({ body, messages: parsed.messages ?? [] })
        } catch {}
        let responseContent: string
        if ('synopsis' in schemaOf(body)) {
          responseContent = JSON.stringify({ synopsis: '全书故事宏观总览：林萧手持断云剑，在青云宗踏上修仙之路。' })
        } else if ('outlineMarkdown' in schemaOf(body)) {
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
                evidence: { startOffset: chapter1Content.indexOf('手中断云剑泛起青芒'), endOffset: chapter1Content.indexOf('手中断云剑泛起青芒') + '手中断云剑泛起青芒'.length, excerpt: '手中断云剑泛起青芒' }
              }
            ],
            consistencyIssues: [
              {
                issueType: 'setting_mismatch',
                severity: 'low',
                description: '青芒出现时周围无灵气波动描写',
                evidence: { startOffset: chapter1Content.indexOf('泛起青芒'), endOffset: chapter1Content.indexOf('泛起青芒') + '泛起青芒'.length, excerpt: '泛起青芒' }
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

    // 断言知识抽取时 System 消息纯静态，正文组装在 User 消息中
    const knowledgeReq = interceptedRequests.find((r) =>
      'suggestions' in schemaOf(r.body)
    )
    expect(knowledgeReq).toBeDefined()
    const knowledgeSys = knowledgeReq!.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const knowledgeUser = knowledgeReq!.messages.find((m) => m.role === 'user')?.content ?? ''
    expect(knowledgeSys).toContain('evidence')
    expect(schemaOf(knowledgeReq!.body).suggestions.items.properties.evidence.properties).toHaveProperty('startOffset')
    expect(knowledgeSys).not.toContain(chapter1Content)
    expect(knowledgeSys).not.toContain('chapter_length')
    expect(knowledgeUser).toContain(`【章节正文】\n${chapter1Content}`)
    expect(knowledgeUser).toContain('【章节名称】第一章 剑起青云')
    expect(knowledgeUser).toContain('【前文滚动状态】')

    // 断言知识抽取后触发的尾随宏观梗概也是纯静态 System，User 消息组装连续资料
    const trailingSynopsisReq = interceptedRequests.find((r) =>
      'synopsis' in schemaOf(r.body)
    )
    expect(trailingSynopsisReq).toBeDefined()
    const synSys = trailingSynopsisReq!.messages.find((m) => m.role === 'system')?.content ?? ''
    const synUsr = trailingSynopsisReq!.messages.find((m) => m.role === 'user')?.content ?? ''
    expect(synSys).not.toContain(chapter1Content)
    expect(synUsr).toContain('【最终滚动主线】')
    expect(synUsr).toContain('【最终连续资料】')

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
        if ('synopsis' in schemaOf(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ synopsis: '最终滚动梗概' }) } }] }))
          return
        }
        if ('outlineMarkdown' in schemaOf(body)) {
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
    expect(schemaOf(knowledgeBodies[1]).rollingState.properties).toHaveProperty('unresolved')
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

    const task = store.createTask(opened.sessionId, 'knowledge', JSON.stringify({ instruction: '', promptSnapshot: promptStore.snapshot(connectionStore.get(conn.id)) }), conn.id, chapterList.map((chapter) => chapter.id))
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
        if ('synopsis' in schemaOf(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ synopsis: '恢复后的全书梗概' }) } }] }))
          return
        }
        if ('outlineMarkdown' in schemaOf(body)) {
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
        if ('synopsis' in schemaOf(body)) {
          responseData = { synopsis: '故事总览' }
        } else if ('outlineMarkdown' in schemaOf(body)) {
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
        theme: { content: '关于命运与抗争的主题探索。', conclusion: '核心思想深刻。', evidenceExcerpts: ['古道荒凉'] },
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
    expect(themeSection.evidences[0]).toMatchObject({ chapterId: chap.id, chapterVersion: chap.version, startOffset: 5, endOffset: 9, excerpt: '古道荒凉' })
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

    const parsedPipelineRequests = pipelineBodies.map((body) => JSON.parse(body))
    for (const task of ['distill_segment', 'distill_stage', 'distill_master', 'summary_segment', 'summary_stage', 'summary_master']) {
      const protocol = PROMPT_DEFINITIONS.find((definition) => definition.id === `task.${task}`)!
      const requests = parsedPipelineRequests.filter((request) => request.messages.some((message: { role: string; content: string }) => message.role === 'system' && message.content === protocol.content))
      expect(requests.length, task).toBeGreaterThan(0)
      for (const request of requests) {
        const properties = request.response_format.json_schema.schema.properties
        const expected = task.startsWith('distill') ? ['formula', task === 'distill_segment' ? 'observations' : 'prompt'] : task === 'summary_master' ? ['synopsis'] : ['summary', 'state']
        for (const field of expected) expect(properties, task).toHaveProperty(field)
        expect(request).not.toHaveProperty('temperature')
        expect(request.max_tokens).toBe(conn.maxOutputTokens)
        const system = request.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: string }) => message.content).join('\n')
        expect(system).not.toContain('春风吹过长街')
        if (task.endsWith('segment')) {
          const user = request.messages.find((message: { role: string }) => message.role === 'user').content
          expect(user).toContain('【正文】')
          expect(user).toContain('春风吹过长街')
          expect(user).toContain('用户编辑指令-')
        }
      }
    }

    const sample = store.read(opened.sessionId, (database) => database.prepare(
      "SELECT content FROM style_sample WHERE tags_json LIKE '%style_distill%' ORDER BY created_at DESC LIMIT 1"
    ).get() as { content: string } | undefined)
    expect(sample?.content).toContain('以短句、感官细节推进场景')
    expect(store.getSynopsis(opened.sessionId)?.summary).toBe('主角在春日长街继续前行。')
  }, 15000)

  it('runs explicit synopsis task with pipe-rolling-synopsis and pipe-macro-synopsis, and compresses rolling states with pipe-story-compression', async () => {
    const projectPath = join(tempDir, 'test-synopsis-compression.novelproj')
    store.create({ destination: projectPath, title: '梗概与压缩测试', description: '' }, [
      { title: '第一章 剑起', content: '林萧在青云宗拔剑。' },
      { title: '第二章 剑鸣', content: '剑鸣惊动四方。' }
    ])

    const opened = await store.open(projectPath)
    const chapterList = chapters.list(opened.sessionId)
    const conn = connectionStore.create({
      name: 'Synopsis Conn',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      contextWindow: 12000,
      maxOutputTokens: 1000,
      isLocalService: true
    })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const seedTask = store.createTask(opened.sessionId, 'knowledge', '{}', conn.id, [])
    store.transaction(opened.sessionId, (db) => {
      db.prepare(
        'INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), chapterList[0].id, chapterList[0].version, '第一章梗概：林萧拔剑起步。', 'current', seedTask.id, Date.now())
      db.prepare(
        'INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), chapterList[1].id, chapterList[1].version, '第二章梗概：剑鸣动四方。', 'current', seedTask.id, Date.now())
    })

    const intercepted: Array<{ body: string; messages: Array<{ role: string; content: string }> }> = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          intercepted.push({ body, messages: parsed.messages ?? [] })
        } catch {}

        if ('characters' in schemaOf(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  mainline: '精炼主线：剑起风云',
                  characters: '林萧',
                  world: '青云宗',
                  relations: '',
                  timeline: '初春',
                  foreshadowing: '',
                  unresolved: ''
                })
              }
            }]
          }))
          return
        }

        if ('mainline' in schemaOf(body) && 'synopsis' in schemaOf(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  mainline: '林萧剑道初显',
                  synopsis: '前两章主线推进'
                })
              }
            }]
          }))
          return
        }

        if ('synopsis' in schemaOf(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  synopsis: '全书宏观故事总纲：剑起青云，震动天下。'
                })
              }
            }]
          }))
          return
        }

        // Default knowledge step with an overly long mainline to trigger pipe-story-compression
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: '单章超长分析',
                suggestions: [],
                consistencyIssues: [],
                rollingState: {
                  mainline: '超长主线'.repeat(700),
                  characters: '林萧',
                  world: '青云宗',
                  relations: '',
                  timeline: '',
                  foreshadowing: '',
                  unresolved: ''
                }
              })
            }
          }]
        }))
      })
    }

    const { taskId: synopsisTaskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'synopsis',
      scope: {},
      connectionId: conn.id
    })
    let synopsisTask = store.getTask(opened.sessionId, synopsisTaskId)
    let attempts = 0
    while (synopsisTask.state === 'running' || synopsisTask.state === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      synopsisTask = store.getTask(opened.sessionId, synopsisTaskId)
      if (++attempts > 100) break
    }
    expect(synopsisTask.state).toBe('completed')

    const rollingReqs = intercepted.filter((r) =>
      'mainline' in schemaOf(r.body) && 'synopsis' in schemaOf(r.body)
    )
    expect(rollingReqs.length).toBe(2)
    for (const req of rollingReqs) {
      const sys = req.messages.find((m) => m.role === 'system')?.content
      const usr = req.messages.find((m) => m.role === 'user')?.content
      expect(sys).toBeTruthy()
      expect(usr).toContain('【上一版主线】')
      expect(usr).toContain('【必要连续资料】')
      expect(usr).toContain('【当前章节标题】')
      expect(usr).toContain('【当前章节摘要】')
    }

    const macroReq = intercepted.find((r) =>
      'synopsis' in schemaOf(r.body) && !('mainline' in schemaOf(r.body))
    )
    expect(macroReq).toBeDefined()
    const macroSys = macroReq!.messages.find((m) => m.role === 'system')?.content
    const macroUsr = macroReq!.messages.find((m) => m.role === 'user')?.content
    expect(macroSys).toBeTruthy()
    expect(macroUsr).toContain('【最终滚动主线】')
    expect(macroUsr).toContain('【最终连续资料】')
    expect(store.getSynopsis(opened.sessionId)?.summary).toBe('全书宏观故事总纲：剑起青云，震动天下。')

    const { taskId: knowledgeTaskId } = await runner.startAnalysis({
      sessionId: opened.sessionId,
      type: 'knowledge',
      scope: { chapterIds: [chapterList[0].id] },
      connectionId: conn.id
    })
    let knowledgeTask = store.getTask(opened.sessionId, knowledgeTaskId)
    attempts = 0
    while (knowledgeTask.state === 'running' || knowledgeTask.state === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      knowledgeTask = store.getTask(opened.sessionId, knowledgeTaskId)
      if (++attempts > 100) break
    }
    expect(knowledgeTask.state).toBe('completed')

    const compressionReq = intercepted.find((r) =>
      'characters' in schemaOf(r.body)
    )
    expect(compressionReq).toBeDefined()
    const compSys = compressionReq!.messages.find((m) => m.role === 'system')?.content
    const compUsr = compressionReq!.messages.find((m) => m.role === 'user')?.content
    expect(compSys).toBeTruthy()
    expect(compUsr).toContain('超长主线')
  })
  it('keeps a running analysis frozen when global preferences change and preserves unchanged continuous state', async () => {
    const path = join(tempDir, 'frozen.novelproj')
    store.create({ destination: path, title: '冻结测试', description: '' }, [
      { title: '第一章', content: '旧事已经确认。' }, { title: '第二章', content: '此夜没有新事发生。' }
    ])
    const { sessionId } = await store.open(path)
    const conn = connectionStore.create({ name: 'Frozen', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', maxOutputTokens: 1800, isLocalService: true, capabilities: { streaming: true, jsonSchema: false, temperature: true, usage: true } })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    const original = promptStore.snapshot(connectionStore.get(conn.id))
    const state = { mainline: '旧主线', characters: '林萧', world: '青云宗', relations: '师徒', timeline: '初春', foreshadowing: '断云剑', unresolved: '剑的来历' }
    const requests: Array<Record<string, any>> = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const request = JSON.parse(body)
        requests.push(request)
        const fields = schemaOf(body)
        if (requests.length === 1) {
          promptStore.save({ activePresetId: 'changed-preset', presets: [{ id: 'changed-preset', name: '新预设', blocks: [], createdAt: 1, updatedAt: 1 }] })
          connectionStore.update({ connectionId: conn.id, expectedVersion: connectionStore.get(conn.id).version, maxOutputTokens: 512 })
        }
        const data = 'suggestions' in fields ? { summary: '本章无新增事实。', suggestions: [], consistencyIssues: [], rollingState: state }
          : 'outlineMarkdown' in fields ? { outlineMarkdown: '# 全书大纲' } : { synopsis: '旧主线没有变化。' }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }))
      })
    }
    const { taskId } = await runner.startAnalysis({ sessionId, type: 'knowledge', scope: { all: true }, connectionId: conn.id })
    await expect.poll(() => store.getTask(sessionId, taskId).state).toBe('completed')
    const task = store.getTask(sessionId, taskId)
    expect(JSON.parse(task.scopeJson).promptSnapshot).toEqual(original)
    expect(task.steps.map((step) => JSON.parse(step.checkpointJson!))).toEqual([state, state])
    const knowledgeRequests = requests.filter((request) => 'suggestions' in schemaOf(JSON.stringify(request)))
    expect(knowledgeRequests).toHaveLength(2)
    expect(knowledgeRequests[1].messages.find((message: { role: string }) => message.role === 'user').content).toContain('剑的来历')
    for (const request of requests) {
      expect(request.max_tokens).toBe(1800)
      expect(request).not.toHaveProperty('temperature')
      expect(request).not.toHaveProperty('response_format')
      expect(request.messages.at(-1).content).toContain('JSON Schema')
      expect(request.messages[0]).toEqual(requests[0].messages[0])
      expect(JSON.stringify(request.messages)).not.toContain('新预设')
    }
    for (const request of knowledgeRequests) {
      expect(request.messages.slice(0, 2)).toEqual(knowledgeRequests[0].messages.slice(0, 2))
    }
  })

  it.each(['settings', 'budget', 'definition', 'missing'] as const)('rejects stale %s recovery before changing task state or checkpoints', async (change) => {
    const path = join(tempDir, 'stale.novelproj')
    store.create({ destination: path, title: '恢复测试', description: '' }, [{ title: '第一章', content: '旧事。' }])
    const { sessionId } = await store.open(path)
    const conn = connectionStore.create({ name: 'Recovery', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', isLocalService: true })
    const snapshot = promptStore.snapshot(connectionStore.get(conn.id))
    if (change === 'definition') { snapshot.definitionFingerprint = 'obsolete-definition'; snapshot.fingerprint = 'obsolete-snapshot' }
    const task = store.createTask(sessionId, 'knowledge', JSON.stringify(change === 'missing' ? {} : { promptSnapshot: snapshot }), conn.id, chapters.list(sessionId).map((chapter) => chapter.id))
    store.updateTaskStep(sessionId, task.steps[0].id, { state: 'failed', checkpointJson: '{"mainline":"不得被清空"}' })
    store.updateTask(sessionId, task.id, { state: 'failed', errorCode: 'MODEL_OUTPUT_INVALID', errorMessage: '原错误' })
    if (change === 'settings') promptStore.save({ activePresetId: 'changed-preset', presets: [{ id: 'changed-preset', name: '新预设', blocks: [], createdAt: 1, updatedAt: 1 }] })
    if (change === 'budget') connectionStore.update({ connectionId: conn.id, expectedVersion: conn.version, maxOutputTokens: 512 })
    const before = store.getTask(sessionId, task.id)
    let calls = 0
    requestHandler = (_req, res) => { calls++; res.end() }
    for (const action of [
      () => runner.resumeTask({ sessionId, taskId: task.id }),
      () => runner.retryStep({ sessionId, taskId: task.id, stepId: task.steps[0].id }),
      () => runner.retryTask({ sessionId, taskId: task.id }),
      () => runner.skipStep({ sessionId, taskId: task.id, stepId: task.steps[0].id })
    ]) {
      await expect(action()).rejects.toMatchObject({ code: 'STALE_CONTEXT_PACKAGE' })
      expect(store.getTask(sessionId, task.id)).toEqual(before)
    }
    expect(calls).toBe(0)
  })

  it.each(['missing', 'wrong', 'outside'] as const)('rejects %s source evidence without persisting analysis suggestions', async (kind) => {
    const content = '人物持有断云剑。'
    const path = join(tempDir, 'invalid-evidence.novelproj')
    store.create({ destination: path, title: '证据测试', description: '' }, [{ title: '第一章', content }])
    const { sessionId } = await store.open(path)
    const conn = connectionStore.create({ name: 'Evidence', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', isLocalService: true })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    requestHandler = (_req, res) => {
      const evidence = kind === 'missing' ? {} : { evidence: { startOffset: 4, endOffset: kind === 'outside' ? 100 : 7, excerpt: '并非原文' } }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '人物持剑。', suggestions: [{ knowledgeKind: 'character', normalizedSubject: '人物', predicate: 'weapon', valueJson: '{}', displayText: '持剑', ...evidence }], consistencyIssues: [] }) } }] }))
    }
    const { taskId } = await runner.startAnalysis({ sessionId, type: 'knowledge', scope: { all: true }, connectionId: conn.id })
    await expect.poll(() => store.getTask(sessionId, taskId).state).toBe('failed')
    expect(store.getTask(sessionId, taskId).errorCode).toBe('MODEL_OUTPUT_INVALID')
    expect(store.getChapterSummary(sessionId, chapters.list(sessionId)[0].id)).toBeNull()
  })

  it('rejects mandatory compiled analysis messages that exceed the frozen input budget before HTTP', async () => {
    const path = join(tempDir, 'mandatory-budget.novelproj')
    store.create({ destination: path, title: '预算测试', description: '' }, [{ title: '第一章', content: '短正文。' }])
    const { sessionId } = await store.open(path)
    const conn = connectionStore.create({ name: 'Small Budget', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', contextWindow: 1000, maxOutputTokens: 400, safetyMarginRatio: 0.2, tokenEstimationRatio: 1.3, isLocalService: true })
    connectionStore.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    let calls = 0
    requestHandler = (_req, res) => { calls++; res.end() }
    const { taskId } = await runner.startAnalysis({ sessionId, type: 'knowledge', scope: { all: true }, connectionId: conn.id })
    await expect.poll(() => store.getTask(sessionId, taskId).state).toBe('failed')
    expect(store.getTask(sessionId, taskId)).toMatchObject({ errorCode: 'MODEL_CONTEXT_EXCEEDED' })
    expect(calls).toBe(0)
    expect(store.getChapterSummary(sessionId, chapters.list(sessionId)[0].id)).toBeNull()
  })

})
