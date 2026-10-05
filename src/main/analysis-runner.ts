import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  type BookOutline,
  type CancelTaskInput,
  type ConsistencyIssueSeverity,
  type ConsistencyIssueType,
  type GetTaskProgressInput,
  type GetTaskInput,
  type KnowledgeKind,
  type ReportSectionType,
  type ResumeTaskInput,
  type RetryStepInput,
  type SkipStepInput,
  type StartAnalysisInput,
  type StartAnalysisResult,
  type SuccessResult,
  type TaskDetail,
  type TaskProgressEvent,
  type TaskSummary
} from '../shared/project'
import { ProjectError, type ProjectStore } from './project-store'
import type { ModelGateway, TokenUsage } from './model-gateway'
import type { ConnectionStore } from './connection-store'
import type { SearchIndex } from './search-index'

type RollingAnalysisState = {
  mainline: string
  characters: string
  world: string
  relations: string
  timeline: string
  foreshadowing: string
  unresolved: string
}

const ROLLING_STATE_FIELDS: Array<keyof RollingAnalysisState> = [
  'mainline',
  'characters',
  'world',
  'relations',
  'timeline',
  'foreshadowing',
  'unresolved'
]

const EMPTY_ROLLING_STATE: RollingAnalysisState = {
  mainline: '',
  characters: '',
  world: '',
  relations: '',
  timeline: '',
  foreshadowing: '',
  unresolved: ''
}

const RollingAnalysisStateSchema = z.object({
  mainline: z.string(),
  characters: z.string(),
  world: z.string(),
  relations: z.string(),
  timeline: z.string(),
  foreshadowing: z.string(),
  unresolved: z.string()
})

const SingleChapterAnalysisOutputSchema = z.object({
  semanticChunks: z.array(z.object({
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    content: z.string()
  })).optional(),
  summary: z.string().default(''),
  suggestions: z.array(z.object({
    knowledgeKind: z.enum(['character', 'world', 'timeline', 'foreshadow']),
    normalizedSubject: z.string(),
    predicate: z.string(),
    valueJson: z.string().default('{}'),
    displayText: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.object({
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      excerpt: z.string()
    }).optional()
  })).default([]),
  consistencyIssues: z.array(z.object({
    issueType: z.enum(['plot_hole', 'character_inconsistency', 'timeline_contradiction', 'setting_mismatch', 'style_drift', 'other']),
    severity: z.enum(['low', 'medium', 'high']),
    description: z.string(),
    evidence: z.object({
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      excerpt: z.string()
    }).optional()
  })).default([]),
  rollingState: RollingAnalysisStateSchema.optional()
})

const LiteraryReportOutputSchema = z.object({
  theme: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  }),
  narrative_perspective: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  }),
  style: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  }),
  pacing_and_structure: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  }),
  character_arc: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  }),
  continuity_issues: z.object({
    content: z.string(),
    conclusion: z.string(),
    evidenceExcerpts: z.array(z.string()).default([])
  })
})

const SynopsisOutputSchema = z.object({
  synopsis: z.string()
})

const StyleSegmentOutputSchema = z.object({
  formula: z.string().default(''),
  observations: z.array(z.string()).default([])
})

const StyleFinalOutputSchema = z.object({
  prompt: z.string().default(''),
  formula: z.string().default('')
})

const BookSummaryOutputSchema = z.object({
  summary: z.string().default(''),
  state: RollingAnalysisStateSchema.optional()
})

const RollingSynopsisStepOutputSchema = z.object({
  mainline: z.string().optional(),
  synopsis: z.string().default('')
})

const RollingStateCompressionOutputSchema = RollingAnalysisStateSchema

function limitRollingText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 1) return value.slice(0, maxChars)
  const head = Math.ceil((maxChars - 1) / 2)
  const tail = Math.floor((maxChars - 1) / 2)
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ''}`
}

function normalizeRollingState(input: unknown, maxChars: number): RollingAnalysisState {
  const parsed = RollingAnalysisStateSchema.safeParse(input)
  if (!parsed.success) return { ...EMPTY_ROLLING_STATE }

  return ROLLING_STATE_FIELDS.reduce((state, field) => {
    state[field] = limitRollingText(parsed.data[field], maxChars)
    return state
  }, { ...EMPTY_ROLLING_STATE })
}

function formatRollingState(state: RollingAnalysisState): string {
  return [
    `主线：${state.mainline || '无'}`,
    `角色：${state.characters || '无'}`,
    `世界观：${state.world || '无'}`,
    `关系：${state.relations || '无'}`,
    `时间线：${state.timeline || '无'}`,
    `伏笔：${state.foreshadowing || '无'}`,
    `未解问题：${state.unresolved || '无'}`
  ].join('\n')
}

export interface AnalysisCallbacks {
  onProgress?: (event: TaskProgressEvent) => void
}

export class AnalysisRunner {
  private activeTasks = new Map<string, AbortController>()
  private lastProgressEmit = new Map<string, number>()
  private callbacks: AnalysisCallbacks = {}

  constructor(
    private readonly store: ProjectStore,
    private readonly modelGateway?: ModelGateway,
    private readonly connectionStore?: ConnectionStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  setCallbacks(callbacks: AnalysisCallbacks): void {
    this.callbacks = callbacks
  }

  async startAnalysis(input: StartAnalysisInput): Promise<StartAnalysisResult> {
    this.store.assertAnalysisPipelines(input.sessionId)
    const chapters = this.store.read(input.sessionId, (database) => {
      return database.prepare('SELECT id, title, version, position, content FROM chapter WHERE deleted_at IS NULL ORDER BY position ASC').all() as Array<{
        id: string
        title: string
        version: number
        position: number
        content: string
      }>
    })

    let targetChapterIds: string[] = []
    let targetChapterRows: typeof chapters = []
    if (input.type === 'knowledge' || input.type === 'style_distill' || input.type === 'book_summary') {
      if (input.scope.all || !input.scope.chapterIds || input.scope.chapterIds.length === 0) {
        targetChapterRows = chapters
      } else {
        targetChapterRows = chapters.filter((c) => input.scope.chapterIds!.includes(c.id))
      }
      targetChapterIds = targetChapterRows.map((c) => c.id)
      if (targetChapterIds.length === 0) throw new ProjectError('VALIDATION_ERROR', '没有选择可分析的章节')
    } else if (input.type === 'report') {
      if (input.scope.all || !input.scope.chapterIds || input.scope.chapterIds.length === 0) {
        targetChapterIds = chapters.map((c) => c.id)
      } else {
        targetChapterIds = chapters.filter((c) => input.scope.chapterIds!.includes(c.id)).map((c) => c.id)
      }
    }

    let connectionId: string | null = input.connectionId ?? null
    if (!connectionId) {
      const routeType = input.type === 'report'
        ? 'report'
        : input.type === 'style_distill'
          ? 'style_distill'
          : input.type === 'book_summary'
            ? 'book_summary'
            : 'knowledge'
      const route = this.store.read(input.sessionId, (database) => {
        return database.prepare('SELECT connection_id FROM task_route WHERE task_type = ?').get(routeType) as { connection_id: string } | undefined
      })
      if (route?.connection_id) {
        connectionId = route.connection_id
      }
    }

    if (connectionId && this.connectionStore) {
      const conn = this.connectionStore.get(connectionId)
      if (!conn) throw new ProjectError('CONNECTION_NOT_FOUND', '绑定的模型连接不存在')
    }

    const isPipeline = input.type === 'style_distill' || input.type === 'book_summary'
    const segments = isPipeline
      ? targetChapterRows.flatMap((chapter) => {
          const segmentSize = Math.max(1000, input.scope.segmentSize ?? 50000)
          const count = Math.max(1, Math.ceil(chapter.content.length / segmentSize))
          return Array.from({ length: count }, (_, index) => ({
            chapterId: chapter.id,
            startOffset: index * segmentSize,
            endOffset: Math.min(chapter.content.length, (index + 1) * segmentSize),
            title: chapter.title,
            segmentIndex: index + 1,
            segmentTotal: count
          }))
        })
      : []
    const taskScope = isPipeline
      ? { ...input.scope, presetId: input.presetId, instruction: input.instruction, segments }
      : input.scope
    const taskChapterIds = isPipeline ? segments.map((segment) => segment.chapterId) : targetChapterIds
    const task = this.store.createTask(
      input.sessionId,
      input.type,
      JSON.stringify(taskScope),
      connectionId,
      ['knowledge', 'style_distill', 'book_summary'].includes(input.type) ? taskChapterIds : []
    )

    void this.runTask(input.sessionId, task.id)
    return { taskId: task.id }
  }

  async cancelTask(input: CancelTaskInput): Promise<SuccessResult> {
    this.store.assertTaskControls(input.sessionId)
    const controller = this.activeTasks.get(input.taskId)
    if (controller) {
      controller.abort()
    }
    this.store.cancelTask(input.sessionId, input.taskId)
    return { success: true }
  }

  async pauseTask(input: CancelTaskInput): Promise<SuccessResult> {
    this.store.assertTaskControls(input.sessionId)
    const task = this.store.getTask(input.sessionId, input.taskId)
    if (task.state !== 'running' && task.state !== 'queued') {
      throw new ProjectError('INVALID_STATE_TRANSITION', '只有排队中或执行中的任务可以暂停')
    }
    this.store.updateTask(input.sessionId, input.taskId, { state: 'interrupted', cancelRequested: false })
    const runningStep = task.steps.find((step) => step.state === 'running')
    if (runningStep) this.store.updateTaskStep(input.sessionId, runningStep.id, { state: 'pending' })
    this.activeTasks.get(input.taskId)?.abort()
    this.emitProgress(this.store.getTask(input.sessionId, input.taskId), true)
    return { success: true }
  }

  async resumeTask(input: ResumeTaskInput): Promise<StartAnalysisResult> {
    this.store.assertTaskControls(input.sessionId)
    const task = this.store.getTask(input.sessionId, input.taskId)
    if (task.state !== 'interrupted' && task.state !== 'failed') {
      throw new ProjectError('INVALID_STATE_TRANSITION', '只有中断或失败的任务可以恢复')
    }

    this.store.updateTask(input.sessionId, input.taskId, {
      state: 'queued',
      errorCode: null,
      errorMessage: null
    })

    void this.runTask(input.sessionId, input.taskId)
    return { taskId: input.taskId }
  }

  async retryStep(input: RetryStepInput): Promise<TaskSummary> {
    this.store.assertTaskControls(input.sessionId)
    const summary = this.store.retryTaskStep(input.sessionId, input.taskId, input.stepId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async retryTask(input: GetTaskInput): Promise<TaskSummary> {
    this.store.assertTaskControls(input.sessionId)
    const summary = this.store.retryFailedTask(input.sessionId, input.taskId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async skipStep(input: SkipStepInput): Promise<TaskSummary> {
    this.store.assertTaskControls(input.sessionId)
    const summary = this.store.skipTaskStep(input.sessionId, input.taskId, input.stepId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async getProgress(input: GetTaskProgressInput): Promise<TaskProgressEvent> {
    const task = this.store.getTask(input.sessionId, input.taskId)
    return this.calculateProgress(task)
  }

  private calculateProgress(task: TaskDetail): TaskProgressEvent {
    const totalSteps = task.steps.length
    const completedSteps = task.steps.filter((s) => s.state === 'completed' || s.state === 'skipped').length
    const failedSteps = task.steps.filter((s) => s.state === 'failed').length
    const runningStep = task.steps.find((s) => s.state === 'running')
    const percent = totalSteps === 0 ? 100 : Math.round((completedSteps / totalSteps) * 100)

    return {
      taskId: task.id,
      state: task.state,
      totalSteps,
      completedSteps,
      failedSteps,
      currentStepPosition: runningStep?.position,
      currentChapterId: runningStep?.chapterId ?? undefined,
      currentChapterTitle: runningStep?.chapterTitle ?? undefined,
      inputTokens: task.inputTokens ?? undefined,
      outputTokens: task.outputTokens ?? undefined,
      percent,
      errorMessage: task.errorMessage ?? undefined
    }
  }

  private emitProgress(task: TaskDetail, force = false): void {
    const now = Date.now()
    const last = this.lastProgressEmit.get(task.id) ?? 0
    if (!force && now - last < 200) return

    this.lastProgressEmit.set(task.id, now)
    const event = this.calculateProgress(task)
    try {
      this.callbacks.onProgress?.(event)
    } catch {}
  }

  private getRollingStateLimit(connectionId: string): number {
    const connection = this.connectionStore?.get(connectionId)
    const contextWindow = connection?.contextWindow ?? 128000
    const maxOutputTokens = connection?.maxOutputTokens ?? 4096
    const safetyMarginRatio = connection?.safetyMarginRatio ?? 0.1
    const tokenEstimationRatio = connection?.tokenEstimationRatio ?? 1.3
    const availableInputTokens = Math.max(0, contextWindow - maxOutputTokens - Math.floor(contextWindow * safetyMarginRatio))
    return Math.max(1, Math.floor((availableInputTokens * 0.2) / ROLLING_STATE_FIELDS.length / tokenEstimationRatio))
  }

  private readRollingState(checkpointJson: string | null | undefined, maxChars: number): RollingAnalysisState {
    if (!checkpointJson) return { ...EMPTY_ROLLING_STATE }
    try {
      return normalizeRollingState(JSON.parse(checkpointJson), maxChars)
    } catch {
      return { ...EMPTY_ROLLING_STATE }
    }
  }

  private pipelineStateBeforeStep(task: TaskDetail, position: number, maxChars: number): RollingAnalysisState {
    const previous = task.steps
      .filter((candidate) => candidate.position < position && candidate.state === 'completed')
      .at(-1)
    if (!previous?.checkpointJson) return { ...EMPTY_ROLLING_STATE }
    try {
      const checkpoint = JSON.parse(previous.checkpointJson) as { state?: unknown }
      return normalizeRollingState(checkpoint.state, maxChars)
    } catch {
      return { ...EMPTY_ROLLING_STATE }
    }
  }

  private rollingStateBeforeStep(task: TaskDetail, position: number, maxChars: number): RollingAnalysisState {
    const previous = task.steps
      .filter((candidate) => candidate.position < position && candidate.state === 'completed')
      .at(-1)
    return this.readRollingState(previous?.checkpointJson, maxChars)
  }

  private latestRollingState(task: TaskDetail, maxChars: number): RollingAnalysisState {
    const latest = task.steps
      .filter((candidate) => candidate.state === 'completed')
      .at(-1)
    return this.readRollingState(latest?.checkpointJson, maxChars)
  }

  private presetInstruction(sessionId: string, scopeJson: string): string {
    try {
      const config = JSON.parse(scopeJson) as { presetId?: string; instruction?: string }
      if (config.instruction !== undefined) return config.instruction
      const presetId = config.presetId
      if (!presetId) return ''
      return this.store.read(sessionId, (database) => {
        const row = database.prepare('SELECT instruction FROM instruction_preset WHERE id = ?').get(presetId) as { instruction: string } | undefined
        return row?.instruction ?? ''
      })
    } catch {
      return ''
    }
  }

  private saveStyleSample(sessionId: string, content: string, taskId: string): void {
    const now = Date.now()
    this.store.transaction(sessionId, (database) => {
      database.prepare('INSERT INTO style_sample(id, name, content, tags_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(randomUUID(), `文风蒸馏 · ${new Date(now).toLocaleDateString('zh-CN')}`, content, JSON.stringify(['style_distill', taskId]), now, now)
    })
  }

  private nextKnowledgeRollingState(
    previous: RollingAnalysisState,
    modelState: unknown,
    summary: string,
    maxChars: number
  ): RollingAnalysisState {
    if (modelState !== undefined) {
      const parsed = RollingAnalysisStateSchema.safeParse(modelState)
      if (parsed.success) return normalizeRollingState(parsed.data, maxChars)
    }

    return normalizeRollingState({
      ...previous,
      mainline: [previous.mainline, summary].filter(Boolean).join('\n')
    }, maxChars)
  }

  private async compressRollingState(
    connectionId: string,
    input: unknown,
    fallback: RollingAnalysisState,
    maxChars: number,
    signal: AbortSignal,
    onUsage?: (usage: TokenUsage) => void
  ): Promise<RollingAnalysisState> {
    const parsed = RollingAnalysisStateSchema.safeParse(input)
    if (!parsed.success) return normalizeRollingState(fallback, maxChars)
    if (!ROLLING_STATE_FIELDS.some((field) => parsed.data[field].length > maxChars)) {
      return normalizeRollingState(parsed.data, maxChars)
    }

    try {
      const result = await this.modelGateway!.generateStructuredJson({
        connectionId,
        messages: [
          {
            role: 'system',
            content: `请压缩滚动故事状态，每个字段不超过 ${maxChars} 个字符。必须保留已确认事实、未解问题和后文需要追踪的变化；不要新增事实，不要丢弃时间线和伏笔状态。`
          },
          { role: 'user', content: JSON.stringify(parsed.data) }
        ],
        zodSchema: RollingStateCompressionOutputSchema,
        jsonSchema: { type: 'object', properties: Object.fromEntries(ROLLING_STATE_FIELDS.map((field) => [field, { type: 'string' }])) },
        signal,
        priority: 'low'
      })
      if (result.usage) onUsage?.(result.usage)
      return normalizeRollingState(result.data, maxChars)
    } catch {
      return normalizeRollingState(parsed.data, maxChars)
    }
  }

  private async generateRollingSynopsis(
    connectionId: string,
    summaries: Array<{ chapterId: string; chapterTitle?: string; summary: string; chapterVersion: number }>,
    initialState: RollingAnalysisState,
    maxChars: number,
    signal: AbortSignal,
    replaySummaries = true
  ): Promise<{ synopsis: string; usage?: TokenUsage }> {
    let state = normalizeRollingState(initialState, maxChars)
    let synopsis = ''
    let usage: TokenUsage | undefined
    const addUsage = (next?: TokenUsage) => {
      if (!next) return
      usage = usage
        ? {
            promptTokens: usage.promptTokens + next.promptTokens,
            completionTokens: usage.completionTokens + next.completionTokens,
            totalTokens: usage.totalTokens + next.totalTokens
          }
        : next
    }

    for (const chapter of replaySummaries ? summaries : []) {
      const result = await this.modelGateway!.generateStructuredJson({
        connectionId,
        messages: [
          {
            role: 'system',
            content: '请按章节顺序滚动更新故事梗概。前文状态是已知上下文，只处理当前章节摘要带来的新增或变化；保留跨章因果、人物状态、时间线、伏笔和未解问题，不把猜测写成已确认事实。返回更新后的主线和结构化梗概文本。'
          },
          {
            role: 'user',
            content: `【上一版主线】${state.mainline || '无'}\n\n【必要连续资料】\n${formatRollingState(state)}\n\n【上一版结构化梗概】\n${synopsis || '无'}\n\n【当前章节标题】${chapter.chapterTitle ?? '章节'}\n\n【当前章节摘要】${chapter.summary}\n\n当前章节没有变化时请明确写“无新增”，不要重写整份资料。`
          }
        ],
        zodSchema: RollingSynopsisStepOutputSchema,
        jsonSchema: {
          type: 'object',
          properties: {
            mainline: { type: 'string' },
            synopsis: { type: 'string' }
          }
        },
        signal,
        priority: 'low'
      })

      addUsage(result.usage)
      state = normalizeRollingState({
        ...state,
        mainline: result.data.mainline?.trim() || [state.mainline, chapter.summary].filter(Boolean).join('\n')
      }, maxChars)
      synopsis = result.data.synopsis || synopsis
    }

    const finalResult = await this.modelGateway!.generateStructuredJson({
      connectionId,
      messages: [
        {
          role: 'system',
          content: '请根据已有滚动故事梗概资料，生成最终连贯、宏观的全书故事梗概，只输出最终梗概文本。'
        },
        {
          role: 'user',
          content: `【最终滚动主线】${state.mainline || '无'}\n\n【最终连续资料】\n${formatRollingState(state)}\n\n【上一版结构化梗概】\n${synopsis || '无'}${replaySummaries ? '' : `\n\n【本次任务章节摘要补充】\n${summaries.map((item) => `- ${item.chapterTitle ?? '章节'}：${item.summary}`).join('\n')}`}${summaries.length === 0 ? '\n\n（暂无章节摘要）' : ''}`
        }
      ],
      zodSchema: SynopsisOutputSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          synopsis: { type: 'string' }
        }
      },
      signal,
      priority: 'low'
    })

    addUsage(finalResult.usage)
    return {
      synopsis: finalResult.data.synopsis || synopsis || state.mainline || '（暂无章节摘要）',
      usage
    }
  }

  private async runTask(sessionId: string, taskId: string): Promise<void> {
    if (this.activeTasks.has(taskId)) return
    const controller = new AbortController()
    this.activeTasks.set(taskId, controller)

    try {
      let task = this.store.getTask(sessionId, taskId)
      if (task.state === 'completed' || task.state === 'cancelled') return

      let connectionId = task.connectionId
      if (!connectionId) {
        const routeType = task.type === 'report'
          ? 'report'
          : task.type === 'style_distill'
            ? 'style_distill'
            : task.type === 'book_summary'
              ? 'book_summary'
              : 'knowledge'
        const route = this.store.read(sessionId, (database) => {
          return database.prepare('SELECT connection_id FROM task_route WHERE task_type = ?').get(routeType) as { connection_id: string } | undefined
        })
        connectionId = route?.connection_id ?? null
      }

      if (!connectionId || !this.modelGateway || !this.connectionStore) {
        throw new ProjectError('CONNECTION_NOT_FOUND', '未配置或未解析到可用的生成模型连接')
      }

      // Assert content target confirmation
      this.connectionStore.assertContentTargetConfirmed(connectionId)

      this.store.updateTask(sessionId, taskId, {
        state: 'running',
        startedAt: task.startedAt ?? Date.now(),
        errorCode: null,
        errorMessage: null
      })
      task = this.store.getTask(sessionId, taskId)
      this.emitProgress(task, true)

      let totalInputTokens = task.inputTokens ?? 0
      let totalOutputTokens = task.outputTokens ?? 0

      // Execute steps
      const steps = task.steps
      for (const step of steps) {
        task = this.store.getTask(sessionId, taskId)
        if (controller.signal.aborted || task.cancelRequested) {
          this.store.updateTask(sessionId, taskId, { state: 'cancelled', completedAt: Date.now() })
          this.emitProgress(this.store.getTask(sessionId, taskId), true)
          return
        }

        if (step.state !== 'pending') continue

        this.store.updateTaskStep(sessionId, step.id, {
          state: 'running',
          attemptCount: step.attemptCount + 1
        })
        this.emitProgress(this.store.getTask(sessionId, taskId))

        if (task.type === 'knowledge' && step.chapterId) {
          const chapter = this.store.read(sessionId, (database) => {
            return database.prepare('SELECT id, title, content, version FROM chapter WHERE id = ? AND deleted_at IS NULL').get(step.chapterId) as {
              id: string
              title: string
              content: string
              version: number
            } | undefined
          })

          if (!chapter) {
            this.store.updateTaskStep(sessionId, step.id, { state: 'skipped' })
            continue
          }

          const capturedSourceHash = createHash('sha256').update(chapter.content).digest('hex')
          const capturedChapterVersion = chapter.version
          const rollingStateLimit = this.getRollingStateLimit(connectionId)
          const previousRollingState = this.rollingStateBeforeStep(task, step.position, rollingStateLimit)
          const skippedChapterTitles = task.steps
            .filter((candidate) => candidate.position < step.position && candidate.state === 'skipped')
            .map((candidate) => candidate.chapterTitle ?? '未命名章节')

          const systemPrompt = `你是一位严谨专业的小说分析助手。请按原文顺序分析当前章节，只输出当前章节相对于前文滚动状态的新增或变化内容；前文状态是已知上下文，不要把猜测、谎言、伪装或未验证说法写成已确认事实。保留跨章因果、角色状态变化、时间先后、伏笔回收和未解问题。
要求：
1. semanticChunks（可选）：若划分语义块，则所有块的 startOffset 与 endOffset 必须覆盖正文全长 [0, ${chapter.content.length}]，首尾相接，内容与原章节文本严格一致。若无特殊需要可为空。
2. summary：100~300字的精准章节梗概。
3. suggestions：提取本章新增或推进的设定事实（实体名规范化），并附带对应原文 excerpt 证据。
4. consistencyIssues：检测本章内部或叙事上的一致性问题，指出 severity 和 description。
5. rollingState：返回压缩后的连续资料；各字段保留已确认事实、后文需要追踪的变化、未解决项。每个字段都不得超过 ${rollingStateLimit} 个字符。当前章节没有变化时明确写“无新增”，不要重写整份资料。`

          const userPrompt = `【前文滚动状态】\n${formatRollingState(previousRollingState)}\n\n【前置章节跳过情况】${skippedChapterTitles.length > 0 ? skippedChapterTitles.join('、') : '无'}\n\n【章节名称】${chapter.title}\n\n【章节正文】\n${chapter.content}`

          const result = await this.modelGateway.generateStructuredJson({
            connectionId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            zodSchema: SingleChapterAnalysisOutputSchema,
            jsonSchema: {
              type: 'object',
              properties: {
                semanticChunks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      startOffset: { type: 'integer' },
                      endOffset: { type: 'integer' },
                      content: { type: 'string' }
                    }
                  }
                },
                summary: { type: 'string' },
                suggestions: { type: 'array' },
                consistencyIssues: { type: 'array' },
                rollingState: {
                  type: 'object',
                  properties: {
                    mainline: { type: 'string' },
                    characters: { type: 'string' },
                    world: { type: 'string' },
                    relations: { type: 'string' },
                    timeline: { type: 'string' },
                    foreshadowing: { type: 'string' },
                    unresolved: { type: 'string' }
                  }
                }
              }
            },
            signal: controller.signal,
            priority: 'low'
          })

          totalInputTokens += result.usage?.promptTokens ?? 0
          totalOutputTokens += result.usage?.completionTokens ?? 0
          this.store.updateTask(sessionId, taskId, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })

          const commitRes = this.store.commitChapterAnalysis(sessionId, {
            taskId,
            stepId: step.id,
            chapterId: chapter.id,
            capturedChapterVersion,
            capturedSourceHash,
            summary: result.data.summary,
            semanticChunks: result.data.semanticChunks,
            suggestions: result.data.suggestions.map((s) => ({
              knowledgeKind: s.knowledgeKind,
              normalizedSubject: s.normalizedSubject,
              predicate: s.predicate,
              valueJson: s.valueJson,
              displayText: s.displayText,
              confidence: s.confidence,
              evidence: s.evidence ? {
                startOffset: s.evidence.startOffset,
                endOffset: s.evidence.endOffset,
                excerpt: s.evidence.excerpt
              } : undefined
            })),
            consistencyIssues: result.data.consistencyIssues.map((ci) => ({
              issueType: ci.issueType,
              severity: ci.severity,
              description: ci.description,
              evidence: ci.evidence ? {
                startOffset: ci.evidence.startOffset,
                endOffset: ci.evidence.endOffset,
                excerpt: ci.evidence.excerpt
              } : undefined
            }))
          })

          if (commitRes.semanticBoundariesApplied && this.searchIndex) {
            void this.searchIndex.sync(sessionId).catch(() => {})
          }

          const rollingState = commitRes.resultState === 'current'
            ? await this.compressRollingState(
                connectionId,
                this.nextKnowledgeRollingState(previousRollingState, result.data.rollingState, result.data.summary, Number.MAX_SAFE_INTEGER),
                previousRollingState,
                rollingStateLimit,
                controller.signal,
                (usage) => {
                  totalInputTokens += usage.promptTokens
                  totalOutputTokens += usage.completionTokens
                  this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
                }
              )
            : previousRollingState
          this.store.updateTaskStep(sessionId, step.id, {
            state: 'completed',
            resultState: commitRes.resultState,
            checkpointJson: JSON.stringify(rollingState)
          })
        } else if ((task.type === 'style_distill' || task.type === 'book_summary') && step.chapterId) {
          const chapter = this.store.read(sessionId, (database) => {
            return database.prepare('SELECT id, title, content, version FROM chapter WHERE id = ? AND deleted_at IS NULL').get(step.chapterId) as {
              id: string
              title: string
              content: string
              version: number
            } | undefined
          })
          if (!chapter) {
            this.store.updateTaskStep(sessionId, step.id, { state: 'skipped' })
            continue
          }

          const config = JSON.parse(task.scopeJson || '{}') as {
            segmentSize?: number
            presetId?: string
            segments?: Array<{ chapterId: string; startOffset: number; endOffset: number; segmentIndex: number; segmentTotal: number }>
          }
          const segmentSize = Math.max(1000, config.segmentSize ?? 50000)
          const segment = config.segments?.[step.position]
          const source = segment
            ? chapter.content.slice(segment.startOffset, segment.endOffset)
            : chapter.content.slice(0, segmentSize)
          const segmentTitle = segment
            ? `${chapter.title}（片段 ${segment.segmentIndex}/${segment.segmentTotal}）`
            : chapter.title
          const instruction = this.presetInstruction(sessionId, task.scopeJson)
          const pipelineStateLimit = this.getRollingStateLimit(connectionId)
          const previousPipelineState = this.pipelineStateBeforeStep(task, step.position, pipelineStateLimit)
          const prompt = task.type === 'style_distill'
            ? `你是小说文风蒸馏师。只分析写作规律，不总结剧情，不复刻原文。请从本段提炼可执行、可检查的文风公式，覆盖语言、句式、段落、叙述距离、对白、情绪、动作、场景、节奏和禁用项。${instruction ? `\n\n用户预设：\n${instruction}` : ''}\n\n章节：${segmentTitle}\n\n正文：\n${source}`
            : `你是长篇小说结构总结师。只总结当前片段相对前文的新增信息，保留时间顺序、因果、角色变化、伏笔和未解问题，不把猜测写成事实。前文连续状态如下：\n${formatRollingState(previousPipelineState)}${instruction ? `\n\n用户预设：\n${instruction}` : ''}\n\n章节：${segmentTitle}\n\n正文：\n${source}`

          if (task.type === 'style_distill') {
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: '按结构化结果返回 formula 和 observations。' }
              ],
              zodSchema: StyleSegmentOutputSchema,
              jsonSchema: { type: 'object', properties: { formula: { type: 'string' }, observations: { type: 'array', items: { type: 'string' } } } },
              signal: controller.signal,
              priority: 'low'
            })
            totalInputTokens += result.usage?.promptTokens ?? 0
            totalOutputTokens += result.usage?.completionTokens ?? 0
            this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
            this.store.updateTaskStep(sessionId, step.id, {
              state: 'completed',
              resultState: 'current',
              checkpointJson: JSON.stringify({ title: segmentTitle, charCount: source.length, formula: result.data.formula, observations: result.data.observations })
            })
          } else {
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: '按结构化结果返回 summary 和 state。' }
              ],
              zodSchema: BookSummaryOutputSchema,
              jsonSchema: { type: 'object', properties: { summary: { type: 'string' }, state: { type: 'object' } } },
              signal: controller.signal,
              priority: 'low'
            })
            totalInputTokens += result.usage?.promptTokens ?? 0
            totalOutputTokens += result.usage?.completionTokens ?? 0
            this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
            const nextState = await this.compressRollingState(
              connectionId,
              { ...previousPipelineState, ...(result.data.state ?? {}), mainline: result.data.state?.mainline || result.data.summary },
              previousPipelineState,
              pipelineStateLimit,
              controller.signal,
              (usage) => {
                totalInputTokens += usage.promptTokens
                totalOutputTokens += usage.completionTokens
                this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
              }
            )
            this.store.updateTaskStep(sessionId, step.id, {
              state: 'completed',
              resultState: 'current',
              checkpointJson: JSON.stringify({ title: segmentTitle, charCount: source.length, summary: result.data.summary, state: nextState })
            })
          }
        } else if (task.type === 'report') {
          // Literary report analysis
          const chapters = this.store.read(sessionId, (database) => {
            return database.prepare('SELECT id, title, content, version FROM chapter WHERE deleted_at IS NULL ORDER BY position ASC').all() as Array<{
              id: string
              title: string
              content: string
              version: number
            }>
          })

          const scopeParsed = JSON.parse(task.scopeJson || '{}') as { chapterIds?: string[]; all?: boolean }
          const targetChapters = scopeParsed.all || !scopeParsed.chapterIds || scopeParsed.chapterIds.length === 0
            ? chapters
            : chapters.filter((c) => scopeParsed.chapterIds!.includes(c.id))

          const chapterVersionsRecord: Record<string, number> = {}
          targetChapters.forEach((c) => { chapterVersionsRecord[c.id] = c.version })

          const combinedText = targetChapters.map((c) => `=== ${c.title} ===\n${c.content.slice(0, 3000)}`).join('\n\n')

          const systemPrompt = `你是一位高水准的小说文学批评与分析专家。请根据提供的作品内容，生成固定六个维度的深度文学分析报告：
1. theme（主题思想）
2. narrative_perspective（叙事视角）
3. style（语言文风）
4. pacing_and_structure（节奏与结构）
5. character_arc（人物成长与弧光）
6. continuity_issues（连续性与逻辑问题）

每个维度提供详细的 Markdown 分析正文 (content) 与高度概括的核心结论 (conclusion)。`

          const result = await this.modelGateway.generateStructuredJson({
            connectionId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: combinedText }
            ],
            zodSchema: LiteraryReportOutputSchema,
            jsonSchema: {
              type: 'object',
              properties: {
                theme: { type: 'object' },
                narrative_perspective: { type: 'object' },
                style: { type: 'object' },
                pacing_and_structure: { type: 'object' },
                character_arc: { type: 'object' },
                continuity_issues: { type: 'object' }
              }
            },
            signal: controller.signal,
            priority: 'low'
          })

          totalInputTokens += result.usage?.promptTokens ?? 0
          totalOutputTokens += result.usage?.completionTokens ?? 0
          this.store.updateTask(sessionId, taskId, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })

          const sectionOrder: ReportSectionType[] = [
            'theme',
            'narrative_perspective',
            'style',
            'pacing_and_structure',
            'character_arc',
            'continuity_issues'
          ]

          const sectionsData = sectionOrder.map((secType, index) => {
            const sec = result.data[secType]
            return {
              sectionType: secType,
              content: sec.content,
              conclusion: sec.conclusion,
              position: index,
              evidences: []
            }
          })

          this.store.createLiteraryReport(
            sessionId,
            task.scopeJson,
            JSON.stringify(chapterVersionsRecord),
            connectionId,
            taskId,
            sectionsData
          )

          this.store.updateTaskStep(sessionId, step.id, {
            state: 'completed',
            resultState: 'current'
          })
        } else if (task.type === 'synopsis') {
          // Explicit synopsis task
          const summaries = this.store.listChapterSummaries(sessionId)
          const result = await this.generateRollingSynopsis(
            connectionId,
            summaries,
            EMPTY_ROLLING_STATE,
            this.getRollingStateLimit(connectionId),
            controller.signal
          )

          totalInputTokens += result.usage?.promptTokens ?? 0
          totalOutputTokens += result.usage?.completionTokens ?? 0
          this.store.updateTask(sessionId, taskId, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })

          const versionsRecord: Record<string, number> = {}
          summaries.forEach((s) => { versionsRecord[s.chapterId] = s.chapterVersion })

          this.store.commitBookSynopsis(sessionId, result.synopsis, JSON.stringify(versionsRecord), taskId)
          this.store.updateTaskStep(sessionId, step.id, {
            state: 'completed',
            resultState: 'current'
          })
        }

        this.emitProgress(this.store.getTask(sessionId, taskId))
      }

      // Check task completion status
      const refreshedTask = this.store.getTask(sessionId, taskId)
      const allDone = refreshedTask.steps.every((s) => s.state === 'completed' || s.state === 'skipped')
      const anyFailed = refreshedTask.steps.some((s) => s.state === 'failed')

      if (allDone) {
        if (task.type === 'knowledge') {
          try {
            const summaries = this.store.listChapterSummaries(sessionId)
            if (summaries.length > 0) {
              const rollingStateLimit = this.getRollingStateLimit(connectionId)
              const synopsisRes = await this.generateRollingSynopsis(
                connectionId,
                summaries,
                this.latestRollingState(refreshedTask, rollingStateLimit),
                rollingStateLimit,
                controller.signal,
                false
              )
              totalInputTokens += synopsisRes.usage?.promptTokens ?? 0
              totalOutputTokens += synopsisRes.usage?.completionTokens ?? 0
              this.store.updateTask(sessionId, taskId, {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens
              })
              const versionsRecord: Record<string, number> = {}
              summaries.forEach((s) => { versionsRecord[s.chapterId] = s.chapterVersion })
              this.store.commitBookSynopsis(sessionId, synopsisRes.synopsis, JSON.stringify(versionsRecord), taskId)
            }
          } catch {}

          try {
            await this.generateBookOutlineDraft(sessionId, connectionId)
          } catch {}
        } else if (task.type === 'style_distill' || task.type === 'book_summary') {
          const checkpointText = refreshedTask.steps
            .filter((s) => s.state === 'completed' && s.checkpointJson)
            .map((s) => {
              try { return JSON.parse(s.checkpointJson as string) } catch { return null }
            })
            .filter(Boolean)
          const config = JSON.parse(refreshedTask.scopeJson || '{}') as { stageSize?: number }
          const stageSize = Math.max(10000, config.stageSize ?? 1000000)
          const stages: Array<Array<Record<string, unknown>>> = []
          let stage: Array<Record<string, unknown>> = []
          let stageChars = 0
          for (const item of checkpointText as Array<Record<string, unknown>>) {
            const itemChars = Number(item.charCount) || JSON.stringify(item).length
            if (stage.length > 0 && stageChars + itemChars > stageSize) {
              stages.push(stage)
              stage = []
              stageChars = 0
            }
            stage.push(item)
            stageChars += itemChars
          }
          if (stage.length > 0) stages.push(stage)
          if (task.type === 'style_distill') {
            const stageFormulas: string[] = []
            for (const [index, items] of stages.entries()) {
              const result = await this.modelGateway.generateStructuredJson({
                connectionId,
                messages: [
                  { role: 'system', content: `你是文风阶段归纳师。合并第 ${index + 1} 阶段的片段报告，剔除偶然场景特征，保留反复出现且可执行的作者规律。` },
                  { role: 'user', content: JSON.stringify(items) }
                ],
                zodSchema: StyleFinalOutputSchema,
                jsonSchema: { type: 'object', properties: { prompt: { type: 'string' }, formula: { type: 'string' } } },
                signal: controller.signal,
                priority: 'low'
              })
              totalInputTokens += result.usage?.promptTokens ?? 0
              totalOutputTokens += result.usage?.completionTokens ?? 0
              stageFormulas.push(result.data.formula || result.data.prompt)
            }
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: [
                { role: 'system', content: '你是文风蒸馏总师。请合并各阶段的文风公式，去除偶然特征，生成全书详细公式书和一份可直接用于写作模型的完整文风提示词。保留具体规则、适用条件和禁用项。' },
                { role: 'user', content: stageFormulas.join('\n\n--- 阶段公式 ---\n\n') }
              ],
              zodSchema: StyleFinalOutputSchema,
              jsonSchema: { type: 'object', properties: { prompt: { type: 'string' }, formula: { type: 'string' } } },
              signal: controller.signal,
              priority: 'low'
            })
            totalInputTokens += result.usage?.promptTokens ?? 0
            totalOutputTokens += result.usage?.completionTokens ?? 0
            this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
            this.saveStyleSample(sessionId, `# 文风提示词\n\n${result.data.prompt}\n\n# 文风公式书\n\n${result.data.formula}`, taskId)
          } else {
            const stageSummaries: string[] = []
            for (const [index, items] of stages.entries()) {
              const result = await this.modelGateway.generateStructuredJson({
                connectionId,
                messages: [
                  { role: 'system', content: `你是长篇小说阶段总结师。将第 ${index + 1} 阶段的小总结按原文顺序合并，保留主线、角色变化、伏笔、世界观、关系、时间线、地点势力、体系信息和未解问题，并区分事实与待验证项。` },
                  { role: 'user', content: JSON.stringify(items) }
                ],
                zodSchema: BookSummaryOutputSchema,
                jsonSchema: { type: 'object', properties: { summary: { type: 'string' }, state: { type: 'object' } } },
                signal: controller.signal,
                priority: 'low'
              })
              totalInputTokens += result.usage?.promptTokens ?? 0
              totalOutputTokens += result.usage?.completionTokens ?? 0
              stageSummaries.push(result.data.summary)
            }
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: [
                { role: 'system', content: '你是长篇小说总结构师。请把章节总结按原文顺序合并为全书总结，清晰列出主线、角色变化、世界观与体系、关系、时间线、伏笔和未解问题。' },
                { role: 'user', content: stageSummaries.join('\n\n--- 阶段总结 ---\n\n') }
              ],
              zodSchema: SynopsisOutputSchema,
              jsonSchema: { type: 'object', properties: { synopsis: { type: 'string' } } },
              signal: controller.signal,
              priority: 'low'
            })
            totalInputTokens += result.usage?.promptTokens ?? 0
            totalOutputTokens += result.usage?.completionTokens ?? 0
            this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
            const versionsRecord: Record<string, number> = {}
            this.store.listChapterSummaries(sessionId).forEach((s) => { versionsRecord[s.chapterId] = s.chapterVersion })
            this.store.commitBookSynopsis(sessionId, result.data.synopsis, JSON.stringify(versionsRecord), taskId)
          }
        }

        this.store.updateTask(sessionId, taskId, {
          state: 'completed',
          completedAt: Date.now()
        })
      } else if (anyFailed) {
        this.store.updateTask(sessionId, taskId, {
          state: 'failed'
        })
      }

      this.emitProgress(this.store.getTask(sessionId, taskId), true)
    } catch (error) {
      const err = error as Error
      const isAbort = controller.signal.aborted || err.message?.includes('aborted') || (error instanceof ProjectError && error.code === 'TASK_CANCELLED')
      const errorCode = error instanceof ProjectError ? error.code : 'MODEL_OUTPUT_INVALID'
      const errorMessage = err.message || '分析任务执行异常'

      try {
        const task = this.store.getTask(sessionId, taskId)
        const paused = task.state === 'interrupted'
        const runningStep = task.steps.find((s) => s.state === 'running')
        if (runningStep) {
          this.store.updateTaskStep(sessionId, runningStep.id, {
            state: paused ? 'pending' : isAbort ? 'skipped' : 'failed'
          })
        }
        this.store.updateTask(sessionId, taskId, {
          state: paused ? 'interrupted' : isAbort ? 'cancelled' : 'failed',
          errorCode: paused || isAbort ? null : errorCode,
          errorMessage: paused || isAbort ? null : errorMessage,
          completedAt: paused ? null : isAbort ? Date.now() : null
        })
        this.emitProgress(this.store.getTask(sessionId, taskId), true)
      } catch {}
    } finally {
      this.activeTasks.delete(taskId)
    }
  }

  async generateBookOutlineDraft(sessionId: string, connectionIdInput?: string): Promise<BookOutline> {
    const chapters = this.store.read(sessionId, (database) => {
      return database.prepare('SELECT id, title, content, version FROM chapter WHERE deleted_at IS NULL ORDER BY position ASC').all() as Array<{
        id: string
        title: string
        content: string
        version: number
      }>
    })
    const summaries = this.store.listChapterSummaries(sessionId)
    const suggestions = this.store.read(sessionId, (database) => {
      return database.prepare("SELECT knowledge_kind, normalized_subject, display_text FROM ai_fact_suggestion WHERE state IN ('pending', 'accepted')").all() as Array<{
        knowledge_kind: string
        normalized_subject: string
        display_text: string
      }>
    })
    const versionsRecord: Record<string, number> = {}
    chapters.forEach((c) => { versionsRecord[c.id] = c.version })

    let connectionId = connectionIdInput
    if (!connectionId) {
      const route = this.store.read(sessionId, (database) => {
        return database.prepare("SELECT connection_id FROM task_route WHERE task_type IN ('report', 'knowledge')").get() as { connection_id: string } | undefined
      })
      if (route?.connection_id) {
        connectionId = route.connection_id
      } else if (this.connectionStore) {
        const conns = this.connectionStore.list('generation')
        if (conns.length > 0) connectionId = conns[0].id
      }
    }

    let outlineMarkdown = ''
    if (this.modelGateway && connectionId) {
      try {
        const summaryTexts = summaries.map((s) => `【${s.chapterTitle ?? '章节'}】${s.summary}`).join('\n')
        const charSuggestions = suggestions.filter((s) => s.knowledge_kind === 'character').map((s) => `- ${s.normalized_subject}: ${s.display_text}`).slice(0, 10).join('\n')
        const worldSuggestions = suggestions.filter((s) => s.knowledge_kind === 'world').map((s) => `- ${s.normalized_subject}: ${s.display_text}`).slice(0, 10).join('\n')

        const promptText = `已分析章节摘要：\n${summaryTexts || '（暂无详细摘要）'}\n\n已提取人物与世界观设定：\n${charSuggestions || '无'}\n${worldSuggestions || '无'}\n\n章节列表：\n${chapters.map((c) => `- ${c.title}`).join('\n')}`

        const res = await this.modelGateway.generateStructuredJson({
          connectionId,
          messages: [
            { role: 'system', content: '你是一位资深小说架构师。请根据已有的章节摘要与设定，提炼并生成一份结构化的全书大纲草稿（Markdown格式，包含：# 全书大纲、## 核心主线、## 主线阶段推进、## 关键人物与势力、## 后续发展预测）。' },
            { role: 'user', content: promptText }
          ],
          zodSchema: z.object({ outlineMarkdown: z.string() }),
          jsonSchema: {
            type: 'object',
            properties: {
              outlineMarkdown: { type: 'string' }
            },
            required: ['outlineMarkdown']
          },
          priority: 'low'
        })
        outlineMarkdown = res.data.outlineMarkdown
      } catch {}
    }

    if (!outlineMarkdown) {
      const summaryLines = summaries.map((s) => `### ${s.chapterTitle ?? '章节'}\n${s.summary}`).join('\n\n')
      const charLines = suggestions.filter((s) => s.knowledge_kind === 'character').map((s) => `- **${s.normalized_subject}**: ${s.display_text}`).join('\n')
      const worldLines = suggestions.filter((s) => s.knowledge_kind === 'world').map((s) => `- **${s.normalized_subject}**: ${s.display_text}`).join('\n')

      outlineMarkdown = `# 全书大纲草稿\n\n## 核心故事脉络\n${summaryLines || '暂无章节摘要，请先分析章节。'}\n\n## 主要人物设定\n${charLines || '暂无人物设定。'}\n\n## 世界观与背景\n${worldLines || '暂无世界观设定。'}`
    }

    const existing = this.store.getBookOutline(sessionId)
    return this.store.saveBookOutline(sessionId, {
      content: outlineMarkdown,
      state: 'draft',
      sourceVersions: versionsRecord,
      expectedVersion: existing ? existing.version : undefined
    })
  }
}
