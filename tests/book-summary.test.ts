import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { AnalysisRunner } from '../src/main/analysis-runner'
import { ProjectStore, ProjectError } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway, type StructuredJsonOptions } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { PromptSettingsStore } from '../src/main/prompt-store'
import { planBookSummary, bookSummaryResult, applySummaryOutline, exportBookSummary } from '../src/main/book-summary'
import { createServiceRouter } from '../src/main/service-router'
import { NovelAgentError } from '../src/shared/platform-bridge/transport'
import { createNovelAgentApi } from '../src/shared/platform-bridge/api-factory'
import type { BookSummaryStepKind } from '../src/shared/contracts/book-summary'

describe('明月全书总结后端', () => {
  let directory: string
  let store: ProjectStore
  let chapters: ChapterRepository
  let connections: ConnectionStore
  let prompts: PromptSettingsStore
  let gateway: ModelGateway
  let runner: AnalysisRunner
  let sessionId: string
  let connectionId: string
  let applicable: boolean
  let calls: Array<{ kind: BookSummaryStepKind; stageIndex?: number; segmentIndex?: number; prompt: string }>
  let generate: MockInstance<ModelGateway['generateStructuredJson']>

  function response(options: StructuredJsonOptions<unknown>) {
    const task = store.getTask(sessionId, options.taskId!)
    const position = task.steps.find(s => s.state === 'running')!.position
    const planned = JSON.parse(task.scopeJson).summaryPlan.steps[position]
    const output = {
      content: `${planned.kind}-${planned.stageIndex ?? ''}-${planned.segmentIndex ?? ''}完整资料`,
      graph: { nodes: [{ id: 'a', name: '甲', role: '主角', weight: 5 }], edges: [] },
      assessment: { applicable, label: applicable ? '修为体系' : '', reason: '依据第一阶段事实', fields: ['境界'] }
    }
    calls.push({ ...planned, prompt: options.messages.map(m => m.content).join('\n') })
    return { data: options.zodSchema.parse(output), rawOutput: JSON.stringify(output), usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
  }
  async function start(segmentSize = 50000, stageSize = 300000) {
    return (await runner.startAnalysis({ sessionId, connectionId, type: 'book_summary', scope: { all: true, segmentSize, stageSize }, instruction: '完整保留配角动机' })).taskId
  }
  async function finished(taskId: string, state = 'completed') {
    await vi.waitFor(() => expect(store.getTask(sessionId, taskId).state).toBe(state))
    return store.getTask(sessionId, taskId)
  }
  function result(taskId: string) { return bookSummaryResult(store, sessionId, store.getTask(sessionId, taskId))! }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'novel-book-summary-'))
    connections = new ConnectionStore(directory)
    const connection = connections.create({ name: '总结模型', kind: 'generation', baseUrl: 'http://127.0.0.1:12345/v1', model: 'test', isLocalService: true, contextWindow: 1000000, maxOutputTokens: 16384 })
    connectionId = connection.id
    connections.confirmContentTarget(connectionId, calculateContentTargetFingerprint(connection.baseUrl, connection.model))
    prompts = new PromptSettingsStore(directory)
    store = new ProjectStore(directory, connections)
    store.create({ destination: join(directory, 'book.novelproj'), title: '测试全书', description: '' }, [{ title: '第一章', content: '甲救了乙。' }, { title: '第二章', content: '乙赠甲宝剑。' }])
    sessionId = (await store.open(join(directory, 'book.novelproj'))).sessionId
    chapters = new ChapterRepository(store)
    gateway = new ModelGateway(connections, new DiagnosticsService(directory))
    runner = new AnalysisRunner(store, prompts, gateway, connections)
    calls = []
    applicable = true
    generate = vi.spyOn(gateway, 'generateStructuredJson').mockImplementation(async options => response(options) as any)
  })
  afterEach(async () => {
    await store.closeAll()
    rmSync(directory, { recursive: true, force: true })
  })

  it('合并短章并完整切分长章，坐标不遗漏、不重叠、不切开 Unicode 字符', () => {
    chapters.create(sessionId, '长章', '开始😀。\n' + '甲乙丙丁😀。'.repeat(20) + '\n结束')
    chapters.create(sessionId, '空章', '')
    const plan = planBookSummary(store, sessionId, prompts.snapshot(connections.get(connectionId)), '', 24, 45)
    expect(plan.segments[0].ranges).toHaveLength(2)
    for (const chapter of chapters.list(sessionId)) {
      const source = chapters.get(sessionId, chapter.id).content
      const ranges = plan.segments.flatMap(s => s.ranges).filter(r => r.chapterId === chapter.id)
      expect(ranges.map(r => source.slice(r.startOffset, r.endOffset)).join('')).toBe(source)
      ranges.forEach((r, i) => {
        expect(r.startOffset).toBe(i ? ranges[i - 1].endOffset : 0)
        expect(source.slice(r.startOffset, r.endOffset)).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      })
    }
    expect(plan.segments.every(s => s.charCount <= 24)).toBe(true)
    const stage = plan.steps.findIndex(s => s.kind === 'stage')
    expect(plan.steps[stage - 1].kind).toBe('mainline')
    expect(plan.steps.slice(stage + 1, stage + 11).map(s => s.kind)).toEqual(['foreshadow', 'characters', 'worldview', 'relations', 'systemAssess', 'system', 'timeline', 'locations', 'unresolved', 'small'])
    expect(plan.steps.filter(s => s.kind === 'systemAssess')).toHaveLength(1)
  })

  it('按阶段更新全部账本，保留完整滚动资料并发布梗概与大纲草稿', async () => {
    const taskId = await start(7, 5)
    const task = await finished(taskId)
    const data = result(taskId)
    expect(data.artifacts.map(a => a.kind)).toEqual(data.stepPlan.map(s => s.kind))
    expect(data.artifacts.filter(a => a.kind === 'stage')).toHaveLength(2)
    expect(calls.find(c => c.kind === 'foreshadow' && c.stageIndex === 2)!.prompt).toContain('foreshadow-1-完整资料')
    expect(calls.find(c => c.kind === 'small' && c.segmentIndex === 2)!.prompt).toContain('mainline-1-1完整资料')
    expect(calls.find(c => c.kind === 'super')!.prompt).toContain('stage-2-完整资料')
    expect(calls.find(c => c.kind === 'outline')!.prompt).toContain('unresolved-2-完整资料')
    expect(calls.every(c => c.prompt.includes('完整保留配角动机') && !/\{\{\w+\}\}/.test(c.prompt))).toBe(true)
    expect(task.inputTokens).toBe(calls.length * 10)
    expect(store.getSynopsis(sessionId)?.summary).toBe('super--完整资料')
    expect(store.getBookOutline(sessionId)).toMatchObject({ content: data.outlineCandidate, state: 'draft' })
    expect(store.listChapterSummaries(sessionId)).toHaveLength(0)
    expect(store.read(sessionId, db => db.prepare('SELECT count(*) AS n FROM ai_fact_suggestion').get())).toEqual({ n: 0 })
  })

  it('体系不适用时留下明确产物而不调用体系表模型', async () => {
    applicable = false
    const taskId = await start(7, 5)
    await finished(taskId)
    expect(calls.filter(c => c.kind === 'system')).toHaveLength(0)
    expect(result(taskId).artifacts.filter(a => a.kind === 'system')).toEqual([
      expect.objectContaining({ notApplicable: true, content: expect.stringContaining('依据第一阶段事实') }),
      expect.objectContaining({ notApplicable: true })
    ])
  })

  it('账本失败后停止，禁止跳过，重试仅执行未完成步骤', async () => {
    generate.mockImplementation(async options => {
      const value = response(options)
      if (calls.at(-1)!.kind === 'timeline' && calls.filter(c => c.kind === 'timeline').length === 1) throw new ProjectError('MODEL_OUTPUT_INVALID', '时间线失败')
      return value as any
    })
    const taskId = await start()
    const failed = await finished(taskId, 'failed')
    expect(store.getSynopsis(sessionId)).toBeNull()
    expect(store.getBookOutline(sessionId)).toBeNull()
    expect(result(taskId).artifacts.at(-1)!.kind).toBe('system')
    const step = failed.steps.find(s => s.state === 'failed')!
    await expect(runner.skipStep({ sessionId, taskId, stepId: step.id })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    await runner.retryTask({ sessionId, taskId })
    await finished(taskId)
    expect(calls.filter(c => c.kind === 'small')).toHaveLength(1)
    expect(calls.filter(c => c.kind === 'timeline')).toHaveLength(2)
    expect(store.getTask(sessionId, taskId).steps.find(s => s.id === step.id)!.attemptCount).toBe(2)
  })

  it('全部模型步骤提交后发布失败，重试发布不重复调用模型', async () => {
    vi.spyOn(store, 'commitBookSynopsis').mockImplementationOnce(() => { throw new ProjectError('DATABASE_ERROR', '发布失败') })
    const taskId = await start()
    const failed = await finished(taskId, 'failed')
    expect(failed.steps.every(s => s.state === 'completed')).toBe(true)
    expect(store.getSynopsis(sessionId)).toBeNull()
    const count = calls.length
    await runner.retryTask({ sessionId, taskId })
    await finished(taskId)
    expect(calls).toHaveLength(count)
    expect(store.getSynopsis(sessionId)).not.toBeNull()
  })

  it('暂停后立即恢复也能继续，迟到响应不提交', async () => {
    let release!: () => void
    generate.mockImplementationOnce(async options => {
      const value = response(options)
      await new Promise<void>(resolve => { release = resolve })
      return value as any
    })
    const taskId = await start()
    expect((await runner.getProgress({ sessionId, taskId })).currentStepKind).toBe('small')
    await runner.pauseTask({ sessionId, taskId })
    await runner.resumeTask({ sessionId, taskId })
    release()
    await finished(taskId)
    expect(result(taskId).artifacts.filter(a => a.kind === 'small')).toHaveLength(1)
    expect(store.getTask(sessionId, taskId).steps[0].attemptCount).toBe(2)
  })

  it('暂停后重新打开项目，从持久化步骤恢复', async () => {
    let release!: () => void
    generate.mockImplementation(async options => {
      const value = response(options)
      if (calls.length === 4) await new Promise<void>(resolve => { release = resolve })
      return value as any
    })
    const taskId = await start()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await runner.pauseTask({ sessionId, taskId })
    release()
    await vi.waitFor(() => expect(calls).toHaveLength(4))
    await store.closeAll()
    sessionId = (await store.open(join(directory, 'book.novelproj'))).sessionId
    generate.mockImplementation(async options => response(options) as any)
    runner = new AnalysisRunner(store, prompts, gateway, connections)
    await runner.resumeTask({ sessionId, taskId })
    await finished(taskId)
    expect(calls.filter(c => c.kind === 'small')).toHaveLength(1)
    expect(result(taskId).artifacts).toHaveLength(result(taskId).stepPlan.length)
  })

  it('请求过程中正文变更，迟到响应不能提交或发布', async () => {
    generate.mockImplementationOnce(async options => {
      const value = response(options)
      const chapter = chapters.list(sessionId)[0]
      chapters.update(sessionId, chapter.id, '已修改正文', chapter.version)
      return value as any
    })
    const taskId = await start()
    expect((await finished(taskId, 'failed')).errorCode).toBe('STALE_CONTEXT_PACKAGE')
    expect(result(taskId)).toMatchObject({ resultState: 'stale', artifacts: [] })
    await expect(runner.resumeTask({ sessionId, taskId })).rejects.toMatchObject({ code: 'STALE_CONTEXT_PACKAGE' })
    expect(store.getBookOutline(sessionId)).toBeNull()
  })

  it.each(['edit', 'add', 'delete', 'rename', 'reorder'] as const)('完成后 %s 使产物过时，禁止应用旧大纲', async change => {
    const taskId = await start()
    await finished(taskId)
    const list = chapters.list(sessionId)
    if (change === 'edit') chapters.update(sessionId, list[0].id, '新正文', list[0].version)
    if (change === 'add') chapters.create(sessionId, '新章', '新内容')
    if (change === 'delete') chapters.delete(sessionId, list[0].id, list[0].version)
    if (change === 'rename') chapters.rename(sessionId, list[0].id, '新标题', list[0].version)
    if (change === 'reorder') chapters.reorder(sessionId, [...list].reverse().map(c => ({ id: c.id, expectedVersion: c.version })))
    expect(result(taskId).resultState).toBe('stale')
    expect(store.getBookOutline(sessionId)?.state).toBe('stale')
    expect(store.getSynopsis(sessionId)?.state).toBe('stale')
    expect(store.getTask(sessionId, taskId).steps.every(s => s.resultState === 'stale')).toBe(true)
    expect(() => applySummaryOutline(store, sessionId, taskId, 1)).toThrowError(expect.objectContaining({ code: 'STALE_CONTEXT_PACKAGE' }))
  })

  it('保留作者大纲，仅按明确版本应用候选，之后不覆盖作者改写', async () => {
    const author = store.saveBookOutline(sessionId, { content: '作者原有大纲', state: 'confirmed', expectedVersion: 0 })
    const taskId = await start()
    await finished(taskId)
    expect(store.getBookOutline(sessionId)?.content).toBe('作者原有大纲')
    expect(() => applySummaryOutline(store, sessionId, taskId, 0)).toThrowError(expect.objectContaining({ code: 'VERSION_CONFLICT' }))
    const applied = applySummaryOutline(store, sessionId, taskId, author.version)
    expect(applied).toMatchObject({ content: result(taskId).outlineCandidate, state: 'draft', version: author.version + 1 })
    store.saveBookOutline(sessionId, { content: '作者新改大纲', state: 'confirmed', expectedVersion: applied.version })
    const chapter = chapters.list(sessionId)[0]
    chapters.update(sessionId, chapter.id, '正文变化', chapter.version)
    expect(store.getBookOutline(sessionId)).toMatchObject({ content: '作者新改大纲', state: 'confirmed' })
  })

  it('非法关系节点引用使任务失败，不发布残缺成果', async () => {
    generate.mockImplementation(async options => {
      const value = response(options) as any
      if (calls.at(-1)!.kind === 'relations') value.data.graph.edges = [{ source: 'a', target: 'missing', label: '同盟', type: 'ally', strength: 3 }]
      return value
    })
    const taskId = await start()
    expect((await finished(taskId, 'failed')).errorCode).toBe('MODEL_OUTPUT_INVALID')
    expect(store.getSynopsis(sessionId)).toBeNull()
  })

  it('拒绝选章模式，预算缩片而不截断，并明确拒绝装不下模板的预算', async () => {
    await expect(runner.startAnalysis({ sessionId, type: 'book_summary', connectionId, scope: { all: false, chapterIds: [chapters.list(sessionId)[0].id] } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const snapshot = prompts.snapshot(connections.get(connectionId))
    snapshot.budget!.contextWindow = 12000
    snapshot.budget!.maxOutputTokens = 1000
    const plan = planBookSummary(store, sessionId, snapshot, '')
    expect(plan.segmentSize).toBeLessThan(50000)
    snapshot.budget!.contextWindow = 50
    expect(() => planBookSummary(store, sessionId, snapshot, '')).toThrowError(expect.objectContaining({ code: 'MODEL_CONTEXT_EXCEEDED' }))
    expect(calls).toHaveLength(0)
  })

  it('前端桥接返回类型化完整产物、应用冲突与完整 Markdown 导出', async () => {
    const router = createServiceRouter({ store, promptStore: prompts, connectionStore: connections, modelGateway: gateway, analysisRunner: runner, windowDelegate: { showSaveDialog: async () => ({ canceled: true }) } })
    const api = createNovelAgentApi({
      async invoke(channel, payload) {
        const response = await router.handle(channel, payload)
        if (!response.ok) { const error = response.error as { code: string; message: string }; throw new NovelAgentError(error.code, error.message) }
        return response.value
      },
      on: () => () => {}
    })
    try {
      const { taskId } = await api.analysis.start({ sessionId, connectionId, type: 'book_summary', scope: { all: true } })
      await finished(taskId)
      const task = await api.task.get({ sessionId, taskId })
      expect(task.bookSummary!.artifacts.at(-1)!.kind).toBe('outline')
      await expect(api.analysis.applyOutline({ sessionId, taskId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
      const destination = join(directory, '总结.md')
      expect(await api.analysis.exportSummary({ sessionId, taskId, destination })).toEqual({ savedPath: destination })
      const markdown = readFileSync(destination, 'utf8')
      for (const artifact of task.bookSummary!.artifacts) expect(markdown).toContain(artifact.content)
      expect(markdown).toContain('endOffset')
      expect(markdown).toContain('"nodes"')
      expect(await api.analysis.exportSummary({ sessionId, taskId })).toBeNull()
      expect(() => exportBookSummary(store, sessionId, taskId, join(directory, 'missing', 'out.md'))).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    } finally { await router.dispose() }
  })
})
