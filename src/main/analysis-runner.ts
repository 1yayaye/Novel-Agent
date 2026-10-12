import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  StartAnalysisInputSchema,
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
import { PromptSnapshotSchema, type PromptSnapshot } from '../shared/prompt-settings'
import { ProjectError, type ProjectStore } from './project-store'
import type { ModelGateway, TokenUsage } from './model-gateway'
import type { ConnectionStore } from './connection-store'
import type { SearchIndex } from './search-index'
import { assertPromptSnapshotFresh, compilePromptMessages } from './prompt-runtime.js'
import type { PromptSettingsStore } from './prompt-store.js'

const AnalysisScopeSchema = StartAnalysisInputSchema.shape.scope.extend({
  instruction: z.string(),
  promptSnapshot: PromptSnapshotSchema.refine((snapshot) => Boolean(snapshot.budget)),
  segments: z.array(z.object({
    chapterId: z.string().uuid(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    title: z.string(),
    segmentIndex: z.number().int().positive(),
    segmentTotal: z.number().int().positive()
  })).optional()
})

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
    private readonly promptStore: PromptSettingsStore,
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

    if (!connectionId || !this.connectionStore || !this.modelGateway) {
      throw new ProjectError('CONNECTION_NOT_FOUND', '未配置或未解析到可用的生成模型连接')
    }
    const promptSnapshot = this.promptStore.snapshot(this.connectionStore.get(connectionId))
    const instruction = this.resolveInstruction(input.sessionId, input)

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
    const taskScope: z.infer<typeof AnalysisScopeSchema> = { ...input.scope, instruction, promptSnapshot, ...(isPipeline ? { segments } : {}) }
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

    this.assertTaskSnapshotFresh(task)

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
    this.assertTaskSnapshotFresh(this.store.getTask(input.sessionId, input.taskId))
    const summary = this.store.retryTaskStep(input.sessionId, input.taskId, input.stepId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async retryTask(input: GetTaskInput): Promise<TaskSummary> {
    this.store.assertTaskControls(input.sessionId)
    this.assertTaskSnapshotFresh(this.store.getTask(input.sessionId, input.taskId))
    const summary = this.store.retryFailedTask(input.sessionId, input.taskId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async skipStep(input: SkipStepInput): Promise<TaskSummary> {
    this.store.assertTaskControls(input.sessionId)
    this.assertTaskSnapshotFresh(this.store.getTask(input.sessionId, input.taskId))
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

  private taskScope(task: TaskDetail): z.infer<typeof AnalysisScopeSchema> {
    try {
      return AnalysisScopeSchema.parse(JSON.parse(task.scopeJson))
    } catch {
      throw new ProjectError('STALE_CONTEXT_PACKAGE', '分析任务缺少有效的指令或创作配置快照，请重新发起分析')
    }
  }

  private assertTaskSnapshotFresh(task: TaskDetail): void {
    if (!task.connectionId || !this.connectionStore) {
      throw new ProjectError('CONNECTION_NOT_FOUND', '分析任务未绑定模型连接，请重新发起分析')
    }
    assertPromptSnapshotFresh(this.promptStore, this.taskScope(task).promptSnapshot, this.connectionStore.get(task.connectionId))
  }

  private getRollingStateLimit(snapshot: PromptSnapshot): number {
    if (!snapshot.budget) throw new ProjectError('STALE_CONTEXT_PACKAGE', '分析任务缺少请求预算，请重新发起分析')
    const { contextWindow, maxOutputTokens, safetyMarginRatio, tokenEstimationRatio } = snapshot.budget
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

  private resolveInstruction(sessionId: string, input: { presetId?: string; instruction?: string }): string {
    if (input.instruction !== undefined) return input.instruction
    if (!input.presetId) return ''
    return this.store.read(sessionId, (database) => {
      const row = database.prepare('SELECT instruction FROM instruction_preset WHERE id = ?').get(input.presetId) as { instruction: string } | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '分析指令预设不存在，请重新选择')
      return row.instruction
    })
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
    snapshot: PromptSnapshot,
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
        messages: compilePromptMessages('synopsis_compress', { instruction: JSON.stringify(parsed.data) }, snapshot),
        maxTokens: snapshot.budget?.maxOutputTokens,
        requestBudget: snapshot.budget,
        zodSchema: RollingStateCompressionOutputSchema,
        jsonSchema: z.toJSONSchema(RollingStateCompressionOutputSchema),
        signal,
        priority: 'low'
      })
      if (result.usage) onUsage?.(result.usage)
      return normalizeRollingState(result.data, maxChars)
    } catch (error) {
      if (error instanceof ProjectError && ['MODEL_CONTEXT_EXCEEDED', 'STALE_CONTEXT_PACKAGE', 'VERSION_CONFLICT', 'CONNECTION_NOT_FOUND', 'TASK_CANCELLED'].includes(error.code)) throw error
      return normalizeRollingState(parsed.data, maxChars)
    }
  }

  private async generateRollingSynopsis(
    connectionId: string,
    summaries: Array<{ chapterId: string; chapterTitle?: string; summary: string; chapterVersion: number }>,
    initialState: RollingAnalysisState,
    maxChars: number,
    signal: AbortSignal,
    snapshot: PromptSnapshot,
    instruction: string,
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
        messages: compilePromptMessages('synopsis_step', {
          instruction: [
            instruction,
            `【上一版主线】${state.mainline || '无'}`,
            `【必要连续资料】\n${formatRollingState(state)}`,
            `【上一版结构化梗概】\n${synopsis || '无'}`,
            `【当前章节标题】${chapter.chapterTitle ?? '章节'}`,
            `【当前章节摘要】\n${chapter.summary}`,
            '返回更新后的完整主线与梗概。当前章节无变化时保留既有资料，不用“无新增”替换已有事实。'
          ].join('\n\n')
        }, snapshot),
        maxTokens: snapshot.budget?.maxOutputTokens,
        requestBudget: snapshot.budget,
        zodSchema: RollingSynopsisStepOutputSchema,
        jsonSchema: z.toJSONSchema(RollingSynopsisStepOutputSchema),
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

    const extraBlock = `${
      replaySummaries
        ? ''
        : `\n\n【本次任务章节摘要补充】\n${summaries.map((item) => `- ${item.chapterTitle ?? '章节'}：${item.summary}`).join('\n')}`
    }${summaries.length === 0 ? '\n\n（暂无章节摘要）' : ''}`

    const finalResult = await this.modelGateway!.generateStructuredJson({
      connectionId,
      messages: compilePromptMessages('synopsis_final', {
        instruction: [
          instruction,
          `【最终滚动主线】${state.mainline || '无'}`,
          `【最终连续资料】\n${formatRollingState(state)}`,
          `【上一版结构化梗概】\n${synopsis || '无'}${extraBlock}`
        ].join('\n\n')
      }, snapshot),
      maxTokens: snapshot.budget?.maxOutputTokens,
      requestBudget: snapshot.budget,
      zodSchema: SynopsisOutputSchema,
      jsonSchema: z.toJSONSchema(SynopsisOutputSchema),
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
      const scope = this.taskScope(task)
      const snapshot = scope.promptSnapshot

      const connectionId = task.connectionId

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
          const rollingStateLimit = this.getRollingStateLimit(snapshot)
          const previousRollingState = this.rollingStateBeforeStep(task, step.position, rollingStateLimit)
          const skippedChapterTitles = task.steps
            .filter((candidate) => candidate.position < step.position && candidate.state === 'skipped')
            .map((candidate) => candidate.chapterTitle ?? '未命名章节')

          const userPrompt = [
            scope.instruction,
            `【前文滚动状态】\n${formatRollingState(previousRollingState)}`,
            `【前置章节跳过情况】${skippedChapterTitles.length > 0 ? skippedChapterTitles.join('、') : '无'}`,
            `【章节名称】${chapter.title}`,
            `【连续资料长度上限】每个 rollingState 字段最多 ${rollingStateLimit} 字。返回更新后的完整字段；无变化则保留已有值。`,
            `【章节正文】\n${chapter.content}`
          ].join('\n\n')

          const result = await this.modelGateway.generateStructuredJson({
            connectionId,
            messages: compilePromptMessages('knowledge', { instruction: userPrompt }, snapshot),
            maxTokens: snapshot.budget?.maxOutputTokens,
            requestBudget: snapshot.budget,
            zodSchema: SingleChapterAnalysisOutputSchema,
            jsonSchema: z.toJSONSchema(SingleChapterAnalysisOutputSchema),
            signal: controller.signal,
            priority: 'low'
          })

          totalInputTokens += result.usage?.promptTokens ?? 0
          totalOutputTokens += result.usage?.completionTokens ?? 0
          this.store.updateTask(sessionId, taskId, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens
          })

          for (const item of [...result.data.suggestions, ...result.data.consistencyIssues]) {
            const evidence = item.evidence
            if (!evidence || evidence.startOffset >= evidence.endOffset || evidence.endOffset > chapter.content.length || chapter.content.slice(evidence.startOffset, evidence.endOffset) !== evidence.excerpt) {
              throw new ProjectError('MODEL_OUTPUT_INVALID', '知识分析缺少准确的原文证据，未保存该章分析结果')
            }
          }

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
                snapshot,
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

          const segmentSize = Math.max(1000, scope.segmentSize ?? 50000)
          const segment = scope.segments?.[step.position]
          const source = segment
            ? chapter.content.slice(segment.startOffset, segment.endOffset)
            : chapter.content.slice(0, segmentSize)
          const segmentTitle = segment
            ? `${chapter.title}（片段 ${segment.segmentIndex}/${segment.segmentTotal}）`
            : chapter.title
          const instruction = scope.instruction
          const pipelineStateLimit = this.getRollingStateLimit(snapshot)
          const previousPipelineState = this.pipelineStateBeforeStep(task, step.position, pipelineStateLimit)
          if (task.type === 'style_distill') {
            const userPrompt = [
              instruction.trim() ? `【用户预设要求】\n${instruction.trim()}` : '',
              `【章节片段】${segmentTitle}`,
              `【正文】\n${source}`,
              '按结构化结果返回 formula 和 observations。'
            ].filter(Boolean).join('\n\n')

            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: compilePromptMessages('distill_segment', { instruction: userPrompt }, snapshot),
              maxTokens: snapshot.budget?.maxOutputTokens,
              requestBudget: snapshot.budget,
              zodSchema: StyleSegmentOutputSchema,
              jsonSchema: z.toJSONSchema(StyleSegmentOutputSchema),
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
            const userPrompt = [
              `【前文连续状态】\n${formatRollingState(previousPipelineState)}`,
              instruction.trim() ? `【用户预设要求】\n${instruction.trim()}` : '',
              `【章节片段】${segmentTitle}`,
              `【正文】\n${source}`,
              '按结构化结果返回 summary 和 state。'
            ].filter(Boolean).join('\n\n')

            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: compilePromptMessages('summary_segment', { instruction: userPrompt }, snapshot),
              maxTokens: snapshot.budget?.maxOutputTokens,
              requestBudget: snapshot.budget,
              zodSchema: BookSummaryOutputSchema,
              jsonSchema: z.toJSONSchema(BookSummaryOutputSchema),
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
              snapshot,
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

          const targetChapters = scope.all || !scope.chapterIds || scope.chapterIds.length === 0
            ? chapters
            : chapters.filter((c) => scope.chapterIds!.includes(c.id))

          const chapterVersionsRecord: Record<string, number> = {}
          targetChapters.forEach((c) => { chapterVersionsRecord[c.id] = c.version })

          const combinedText = [scope.instruction, ...targetChapters.map((c) => `=== ${c.title} ===\n${c.content.slice(0, 3000)}`)].filter(Boolean).join('\n\n')

          const result = await this.modelGateway.generateStructuredJson({
            connectionId,
            messages: compilePromptMessages('report', { instruction: combinedText }, snapshot),
            maxTokens: snapshot.budget?.maxOutputTokens,
            requestBudget: snapshot.budget,
            zodSchema: LiteraryReportOutputSchema,
            jsonSchema: z.toJSONSchema(LiteraryReportOutputSchema),
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
              evidences: sec.evidenceExcerpts.map((excerpt) => {
                const chapter = targetChapters.find((item) => excerpt.trim() && item.content.slice(0, 3000).includes(excerpt))
                if (!chapter) throw new ProjectError('MODEL_OUTPUT_INVALID', '文学报告引文未匹配所提供的原文，未保存报告')
                const startOffset = chapter.content.indexOf(excerpt)
                return { chapterId: chapter.id, chapterVersion: chapter.version, startOffset, endOffset: startOffset + excerpt.length, excerpt }
              })
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
            this.getRollingStateLimit(snapshot),
            controller.signal,
            snapshot,
            scope.instruction
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
              const rollingStateLimit = this.getRollingStateLimit(snapshot)
              const synopsisRes = await this.generateRollingSynopsis(
                connectionId,
                summaries,
                this.latestRollingState(refreshedTask, rollingStateLimit),
                rollingStateLimit,
                controller.signal,
                snapshot,
                scope.instruction,
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
          } catch (error) {
            if (error instanceof ProjectError && ['MODEL_CONTEXT_EXCEEDED', 'STALE_CONTEXT_PACKAGE', 'VERSION_CONFLICT', 'CONNECTION_NOT_FOUND', 'TASK_CANCELLED'].includes(error.code)) throw error
          }

          try {
            await this.generateBookOutlineDraft(sessionId, connectionId, snapshot, controller.signal)
          } catch (error) {
            if (error instanceof ProjectError && ['MODEL_CONTEXT_EXCEEDED', 'STALE_CONTEXT_PACKAGE', 'VERSION_CONFLICT', 'CONNECTION_NOT_FOUND', 'TASK_CANCELLED'].includes(error.code)) throw error
          }
        } else if (task.type === 'style_distill' || task.type === 'book_summary') {
          const checkpointText = refreshedTask.steps
            .filter((s) => s.state === 'completed' && s.checkpointJson)
            .map((s) => {
              try { return JSON.parse(s.checkpointJson as string) } catch { return null }
            })
            .filter(Boolean)
          const config = this.taskScope(refreshedTask)
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
            for (const items of stages) {
              const result = await this.modelGateway.generateStructuredJson({
                connectionId,
                messages: compilePromptMessages('distill_stage', { instruction: [scope.instruction, JSON.stringify(items)].filter(Boolean).join('\n\n') }, snapshot),
                maxTokens: snapshot.budget?.maxOutputTokens,
                requestBudget: snapshot.budget,
                zodSchema: StyleFinalOutputSchema,
                jsonSchema: z.toJSONSchema(StyleFinalOutputSchema),
                signal: controller.signal,
                priority: 'low'
              })
              totalInputTokens += result.usage?.promptTokens ?? 0
              totalOutputTokens += result.usage?.completionTokens ?? 0
              stageFormulas.push(result.data.formula || result.data.prompt)
            }
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: compilePromptMessages('distill_master', { instruction: [scope.instruction, stageFormulas.join('\n\n--- 阶段公式 ---\n\n')].filter(Boolean).join('\n\n') }, snapshot),
              maxTokens: snapshot.budget?.maxOutputTokens,
              requestBudget: snapshot.budget,
              zodSchema: StyleFinalOutputSchema,
              jsonSchema: z.toJSONSchema(StyleFinalOutputSchema),
              signal: controller.signal,
              priority: 'low'
            })
            totalInputTokens += result.usage?.promptTokens ?? 0
            totalOutputTokens += result.usage?.completionTokens ?? 0
            this.store.updateTask(sessionId, taskId, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens })
            this.saveStyleSample(sessionId, `# 文风提示词\n\n${result.data.prompt}\n\n# 文风公式书\n\n${result.data.formula}`, taskId)
          } else {
            const stageSummaries: string[] = []
            for (const items of stages) {
              const result = await this.modelGateway.generateStructuredJson({
                connectionId,
                messages: compilePromptMessages('summary_stage', { instruction: [scope.instruction, JSON.stringify(items)].filter(Boolean).join('\n\n') }, snapshot),
                maxTokens: snapshot.budget?.maxOutputTokens,
                requestBudget: snapshot.budget,
                zodSchema: BookSummaryOutputSchema,
                jsonSchema: z.toJSONSchema(BookSummaryOutputSchema),
                signal: controller.signal,
                priority: 'low'
              })
              totalInputTokens += result.usage?.promptTokens ?? 0
              totalOutputTokens += result.usage?.completionTokens ?? 0
              stageSummaries.push(result.data.summary)
            }
            const result = await this.modelGateway.generateStructuredJson({
              connectionId,
              messages: compilePromptMessages('summary_master', { instruction: [scope.instruction, stageSummaries.join('\n\n--- 阶段总结 ---\n\n')].filter(Boolean).join('\n\n') }, snapshot),
              maxTokens: snapshot.budget?.maxOutputTokens,
              requestBudget: snapshot.budget,
              zodSchema: SynopsisOutputSchema,
              jsonSchema: z.toJSONSchema(SynopsisOutputSchema),
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

  async generateBookOutlineDraft(sessionId: string, connectionIdInput?: string, frozenSnapshot?: PromptSnapshot, signal?: AbortSignal): Promise<BookOutline> {
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
      const snapshot = frozenSnapshot ?? this.promptStore.snapshot(this.connectionStore!.get(connectionId))
      if (!snapshot.budget) throw new ProjectError('STALE_CONTEXT_PACKAGE', '分析任务缺少请求预算，请重新发起分析')
      try {
        const summaryTexts = summaries.map((s) => `【${s.chapterTitle ?? '章节'}】${s.summary}`).join('\n')
        const charSuggestions = suggestions.filter((s) => s.knowledge_kind === 'character').map((s) => `- ${s.normalized_subject}: ${s.display_text}`).slice(0, 10).join('\n')
        const worldSuggestions = suggestions.filter((s) => s.knowledge_kind === 'world').map((s) => `- ${s.normalized_subject}: ${s.display_text}`).slice(0, 10).join('\n')

        const outlineInputText = `已分析章节摘要：\n${summaryTexts || '（暂无详细摘要）'}\n\n已提取人物与世界观设定：\n${charSuggestions || '无'}\n${worldSuggestions || '无'}\n\n章节列表：\n${chapters.map((c) => `- ${c.title}`).join('\n')}`
        const outlineSchema = z.object({ outlineMarkdown: z.string() })

        const res = await this.modelGateway.generateStructuredJson({
          connectionId,
          messages: compilePromptMessages('book_outline', { instruction: outlineInputText }, snapshot),
          maxTokens: snapshot.budget?.maxOutputTokens,
          requestBudget: snapshot.budget,
          zodSchema: outlineSchema,
          jsonSchema: z.toJSONSchema(outlineSchema),
          priority: 'low',
          signal
        })
        outlineMarkdown = res.data.outlineMarkdown
      } catch (error) {
        if (error instanceof ProjectError && ['MODEL_CONTEXT_EXCEEDED', 'STALE_CONTEXT_PACKAGE', 'VERSION_CONFLICT', 'CONNECTION_NOT_FOUND', 'TASK_CANCELLED'].includes(error.code)) throw error
      }
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
