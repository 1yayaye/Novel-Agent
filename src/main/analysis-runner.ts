import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import {
  type BookOutline,
  type CancelTaskInput,
  type ConsistencyIssueSeverity,
  type ConsistencyIssueType,
  type GetTaskProgressInput,
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
import type { ModelGateway } from './model-gateway'
import type { ConnectionStore } from './connection-store'
import type { SearchIndex } from './search-index'

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
  })).default([])
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

export class AnalysisRunner {
  private activeTasks = new Map<string, AbortController>()
  private lastProgressEmit = new Map<string, number>()
  private window?: BrowserWindow

  constructor(
    private readonly store: ProjectStore,
    private readonly modelGateway?: ModelGateway,
    private readonly connectionStore?: ConnectionStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  async startAnalysis(input: StartAnalysisInput): Promise<StartAnalysisResult> {
    const chapters = this.store.read(input.sessionId, (database) => {
      return database.prepare('SELECT id, title, version, position FROM chapter WHERE deleted_at IS NULL ORDER BY position ASC').all() as Array<{
        id: string
        title: string
        version: number
        position: number
      }>
    })

    let targetChapterIds: string[] = []
    if (input.type === 'knowledge') {
      if (input.scope.all || !input.scope.chapterIds || input.scope.chapterIds.length === 0) {
        targetChapterIds = chapters.map((c) => c.id)
      } else {
        targetChapterIds = chapters.filter((c) => input.scope.chapterIds!.includes(c.id)).map((c) => c.id)
      }
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
      const routeType = input.type === 'report' ? 'report' : 'knowledge'
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

    const task = this.store.createTask(
      input.sessionId,
      input.type,
      JSON.stringify(input.scope),
      connectionId,
      input.type === 'knowledge' ? targetChapterIds : []
    )

    void this.runTask(input.sessionId, task.id)
    return { taskId: task.id }
  }

  async cancelTask(input: CancelTaskInput): Promise<SuccessResult> {
    const controller = this.activeTasks.get(input.taskId)
    if (controller) {
      controller.abort()
    }
    this.store.cancelTask(input.sessionId, input.taskId)
    return { success: true }
  }

  async resumeTask(input: ResumeTaskInput): Promise<StartAnalysisResult> {
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
    const summary = this.store.retryTaskStep(input.sessionId, input.taskId, input.stepId)
    void this.runTask(input.sessionId, input.taskId)
    return summary
  }

  async skipStep(input: SkipStepInput): Promise<TaskSummary> {
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
    if (!this.window || this.window.isDestroyed()) return
    const now = Date.now()
    const last = this.lastProgressEmit.get(task.id) ?? 0
    if (!force && now - last < 200) return

    this.lastProgressEmit.set(task.id, now)
    const event = this.calculateProgress(task)
    try {
      this.window.webContents.send('task:progress', event)
    } catch {}
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
        const routeType = task.type === 'report' ? 'report' : 'knowledge'
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
      for (const step of task.steps) {
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

          const systemPrompt = `你是一位严谨专业的小说分析助手。请分析提供的章节正文，提取章节摘要、语义分块、事实设定建议（人物/世界观/时间线/伏笔）以及一致性问题（逻辑漏洞、人设崩塌、时间线冲突等）。
要求：
1. semanticChunks（可选）：若划分语义块，则所有块的 startOffset 与 endOffset 必须覆盖正文全长 [0, ${chapter.content.length}]，首尾相接，内容与原章节文本严格一致。若无特殊需要可为空。
2. summary：100~300字的精准章节梗概。
3. suggestions：提取本章新增或推进的设定事实（实体名规范化），并附带对应原文 excerpt 证据。
4. consistencyIssues：检测本章内部或叙事上的一致性问题，指出 severity 和 description。`

          const userPrompt = `【章节名称】${chapter.title}\n\n【章节正文】\n${chapter.content}`

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
                summary: { type: 'string' },
                suggestions: { type: 'array' },
                consistencyIssues: { type: 'array' }
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
          const summaryTexts = summaries.map((s) => `第 ${s.chapterTitle ?? '章'}: ${s.summary}`).join('\n')

          const result = await this.modelGateway.generateStructuredJson({
            connectionId,
            messages: [
              { role: 'system', content: '请根据所提供的各章节摘要，生成一份连贯、宏观的全书滚动故事梗概。' },
              { role: 'user', content: summaryTexts || '（暂无章节摘要）' }
            ],
            zodSchema: SynopsisOutputSchema,
            jsonSchema: {
              type: 'object',
              properties: {
                synopsis: { type: 'string' }
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

          const versionsRecord: Record<string, number> = {}
          summaries.forEach((s) => { versionsRecord[s.chapterId] = s.chapterVersion })

          this.store.commitBookSynopsis(sessionId, result.data.synopsis, JSON.stringify(versionsRecord), taskId)
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
              const summaryTexts = summaries.map((s) => `【${s.chapterTitle ?? '章节'}】${s.summary}`).join('\n')
              const synopsisRes = await this.modelGateway.generateStructuredJson({
                connectionId,
                messages: [
                  { role: 'system', content: '请根据所提供的各章节摘要，生成一份连贯、宏观的全书滚动故事梗概。' },
                  { role: 'user', content: summaryTexts }
                ],
                zodSchema: SynopsisOutputSchema,
                jsonSchema: {
                  type: 'object',
                  properties: {
                    synopsis: { type: 'string' }
                  }
                },
                signal: controller.signal,
                priority: 'low'
              })
              const versionsRecord: Record<string, number> = {}
              summaries.forEach((s) => { versionsRecord[s.chapterId] = s.chapterVersion })
              this.store.commitBookSynopsis(sessionId, synopsisRes.data.synopsis, JSON.stringify(versionsRecord), taskId)
            }
          } catch {}

          try {
            await this.generateBookOutlineDraft(sessionId, connectionId)
          } catch {}
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
        const runningStep = task.steps.find((s) => s.state === 'running')
        if (runningStep) {
          this.store.updateTaskStep(sessionId, runningStep.id, {
            state: isAbort ? 'skipped' : 'failed'
          })
        }
        this.store.updateTask(sessionId, taskId, {
          state: isAbort ? 'cancelled' : 'failed',
          errorCode: isAbort ? null : errorCode,
          errorMessage: isAbort ? null : errorMessage,
          completedAt: isAbort ? Date.now() : null
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
