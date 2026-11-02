import { createHash, randomUUID } from 'node:crypto'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import {
  BookSummaryArtifactSchema, BookSummaryRangeSchema, BookSummarySourceSchema, BookSummaryStepKindSchema,
  SummaryRelationGraphSchema, SummarySystemAssessmentSchema,
  type BookSummaryArtifact, type BookSummaryResult, type BookSummaryStepKind
} from '../shared/contracts/book-summary'
import type { BookOutline, TaskDetail } from '../shared/project'
import type { PromptSnapshot } from '../shared/prompt-settings'
import type { ModelGateway } from './model-gateway'
import { ProjectError, type ProjectStore } from './project-store'
import { compilePromptMessages } from './prompt-runtime'
import { BOOK_SUMMARY_PROMPTS } from './book-summary-prompts'

const SegmentSchema = z.object({ title: z.string(), charCount: z.number().int().nonnegative(), ranges: z.array(BookSummaryRangeSchema) })
const PlannedStepSchema = z.object({
  kind: BookSummaryStepKindSchema, title: z.string(), segmentIndex: z.number().int().positive().optional(),
  stageIndex: z.number().int().positive().optional()
})
const SummaryPlanSchema = z.object({
  protocolVersion: z.literal(1), projectName: z.string(), sources: z.array(BookSummarySourceSchema),
  segmentSize: z.number().int().positive(), stageSize: z.number().int().positive(),
  segments: z.array(SegmentSchema), steps: z.array(PlannedStepSchema)
})
type SummaryPlan = z.infer<typeof SummaryPlanSchema>
type SourceChapter = { id: string; title: string; version: number; position: number; content: string }
const TextOutputSchema = z.object({ content: z.string().trim().min(1) })
const RelationsOutputSchema = TextOutputSchema.extend({ graph: SummaryRelationGraphSchema })
const AssessmentOutputSchema = TextOutputSchema.extend({ assessment: SummarySystemAssessmentSchema })
const LABELS: Record<BookSummaryStepKind, string> = {
  small: '小总结', mainline: '主线更新', stage: '阶段大总结', foreshadow: '伏笔账本', characters: '角色档案',
  worldview: '世界观', relations: '角色关系', systemAssess: '体系判断', system: '体系表', timeline: '时间线',
  locations: '地点势力', unresolved: '未解问题', super: '超级总结', outline: '全书大纲'
}
const LEDGERS: BookSummaryStepKind[] = ['foreshadow', 'characters', 'worldview', 'relations', 'system', 'timeline', 'locations', 'unresolved']

export function invalidateBookSummary(database: Database.Database, now: number): void {
  database.prepare("UPDATE task_step SET result_state = 'stale' WHERE task_id IN (SELECT id FROM task WHERE type = 'book_summary') AND state = 'completed'").run()
  database.prepare("UPDATE book_synopsis SET state = 'stale' WHERE state = 'current' AND analysis_task_id IN (SELECT id FROM task WHERE type = 'book_summary')").run()
  // 只使本流程发布、且内容仍与候选相同的大纲过时；作者改写过的大纲由作者维护。
  database.prepare(`UPDATE book_outline SET state = 'stale', updated_at = ? WHERE state != 'stale' AND EXISTS (
    SELECT 1 FROM task_step s JOIN task t ON t.id = s.task_id
    WHERE t.type = 'book_summary' AND s.state = 'completed' AND json_valid(s.checkpoint_json)
    AND json_extract(s.checkpoint_json, '$.kind') = 'outline'
    AND json_extract(s.checkpoint_json, '$.content') = book_outline.content
  )`).run(now)
}

function readChapters(store: ProjectStore, sessionId: string): SourceChapter[] {
  return store.read(sessionId, db => db.prepare('SELECT id, title, version, position, content FROM chapter WHERE deleted_at IS NULL ORDER BY position').all() as SourceChapter[])
}
function sources(chapters: SourceChapter[]): SummaryPlan['sources'] {
  return chapters.map(c => ({ chapterId: c.id, title: c.title, version: c.version, position: c.position,
    charCount: c.content.length, hash: createHash('sha256').update(c.content).digest('hex') }))
}
// 只读解析任务 scopeJson 里的 summaryPlan：旧任务或非法数据返回 undefined，不抛错（供进度展示等只读场景）。
// 需要严格校验流程检查点时用 planOf（额外校验 steps 数并抛 STALE_CONTEXT_PACKAGE）。
export function summaryPlanOf(task: TaskDetail): SummaryPlan | undefined {
  try {
    const parsed = SummaryPlanSchema.safeParse(JSON.parse(task.scopeJson).summaryPlan)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function planOf(task: TaskDetail): SummaryPlan {
  const plan = summaryPlanOf(task)
  if (!plan || plan.steps.length !== task.steps.length) {
    throw new ProjectError('STALE_CONTEXT_PACKAGE', '该全书总结任务不含当前流程检查点，请重新发起分析')
  }
  return plan
}
function isCurrent(store: ProjectStore, sessionId: string, plan: SummaryPlan): boolean {
  return JSON.stringify(sources(readChapters(store, sessionId))) === JSON.stringify(plan.sources)
}
export function assertBookSummaryCurrent(store: ProjectStore, sessionId: string, task: TaskDetail): void {
  if (!isCurrent(store, sessionId, planOf(task))) throw new ProjectError('STALE_CONTEXT_PACKAGE', '全书正文或章节顺序已变化，请重新发起分析')
}

// UTF-16 左闭右开坐标与章节接口一致；不切开代理对，不丢弃边界处空白。
function boundary(text: string, start: number, limit: number): number {
  let end = Math.min(text.length, start + limit)
  if (end === text.length) return end
  const minimum = start + Math.floor(limit / 2)
  const paragraph = text.lastIndexOf('\n', end - 1)
  if (paragraph >= minimum) end = paragraph + 1
  else {
    const matches = [...text.slice(minimum, end).matchAll(/[。！？!?；;]/g)]
    if (matches.length) end = minimum + matches.at(-1)!.index! + 1
  }
  if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return end
}

export function planBookSummary(store: ProjectStore, sessionId: string, snapshot: PromptSnapshot, instruction: string, segmentSize = 50000, stageSize = 300000): SummaryPlan {
  const chapters = readChapters(store, sessionId)
  if (!chapters.some(c => c.content.length)) throw new ProjectError('VALIDATION_ERROR', '没有可总结的正文')
  const budget = snapshot.budget!
  const inputRoom = budget.contextWindow - budget.maxOutputTokens - Math.floor(budget.contextWindow * budget.safetyMarginRatio)
  const overhead = JSON.stringify(compilePromptMessages('book_summary', { instruction: BOOK_SUMMARY_PROMPTS.small + instruction }, snapshot)).length
    + JSON.stringify(z.toJSONSchema(TextOutputSchema)).length
  // 为完整滚动主线预留输入空间；累计资料超限仍由网关明确拒绝，不压缩或截断。
  const budgetChars = Math.floor((inputRoom / budget.tokenEstimationRatio - overhead - 1024) / 2)
  segmentSize = Math.min(segmentSize, budgetChars)
  if (segmentSize < 2) throw new ProjectError('MODEL_CONTEXT_EXCEEDED', '模型输入预算不足以容纳总结模板与正文')
  const segments: SummaryPlan['segments'] = []
  let pending: z.infer<typeof SegmentSchema> = { title: '', charCount: 0, ranges: [] }
  const flush = () => {
    if (pending.ranges.length) segments.push(pending)
    pending = { title: '', charCount: 0, ranges: [] }
  }
  for (const chapter of chapters) {
    if (!chapter.content.length) continue
    if (pending.charCount && pending.charCount + chapter.content.length > segmentSize) flush()
    let offset = 0
    while (offset < chapter.content.length) {
      const end = boundary(chapter.content, offset, segmentSize - pending.charCount)
      pending.ranges.push({ chapterId: chapter.id, startOffset: offset, endOffset: end })
      pending.title = pending.title ? `${pending.title} / ${chapter.title}` : chapter.title
      pending.charCount += end - offset
      offset = end
      if (offset < chapter.content.length || pending.charCount >= segmentSize) flush()
    }
  }
  flush()
  const steps: SummaryPlan['steps'] = []
  let stageChars = 0
  let stageIndex = 1
  segments.forEach((segment, i) => {
    const segmentIndex = i + 1
    steps.push({ kind: 'small', title: `小总结 ${segmentIndex}：${segment.title}`, segmentIndex, stageIndex },
      { kind: 'mainline', title: `主线更新 ${segmentIndex}`, segmentIndex, stageIndex })
    stageChars += segment.charCount
    if (stageChars >= stageSize || i === segments.length - 1) {
      steps.push({ kind: 'stage', title: `阶段 ${stageIndex} 大总结`, stageIndex })
      for (const kind of LEDGERS) {
        if (kind === 'system' && stageIndex === 1) steps.push({ kind: 'systemAssess', title: '首阶段体系判断', stageIndex })
        steps.push({ kind, title: `阶段 ${stageIndex} ${LABELS[kind]}`, stageIndex })
      }
      stageIndex++
      stageChars = 0
    }
  })
  steps.push({ kind: 'super', title: '全书超级总结' }, { kind: 'outline', title: '全书大纲候选' })
  const projectName = store.read(sessionId, db => (db.prepare('SELECT title FROM project_meta LIMIT 1').get() as { title: string }).title)
  return { protocolVersion: 1, projectName, sources: sources(chapters), segmentSize, stageSize, segments, steps }
}

export function bookSummaryResult(store: ProjectStore, sessionId: string, task: TaskDetail): BookSummaryResult | undefined {
  if (task.type !== 'book_summary') return undefined
  // 旧任务只供任务列表查看，不转换旧检查点。
  if (!summaryPlanOf(task)) return undefined
  const plan = planOf(task)
  const artifacts = task.steps.filter(s => s.state === 'completed' && s.checkpointJson)
    .map(s => BookSummaryArtifactSchema.parse(JSON.parse(s.checkpointJson!)))
  return {
    protocolVersion: 1, resultState: isCurrent(store, sessionId, plan) ? 'current' : 'stale', sources: plan.sources,
    totalChars: plan.sources.reduce((n, s) => n + s.charCount, 0), segmentSize: plan.segmentSize, stageSize: plan.stageSize,
    artifacts, stepPlan: plan.steps.map((s, i) => ({ ...s, stepId: task.steps[i].id })),
    outlineCandidate: artifacts.find(a => a.kind === 'outline')?.content ?? null
  }
}

export async function runBookSummary(store: ProjectStore, gateway: ModelGateway, sessionId: string, taskId: string, snapshot: PromptSnapshot, instruction: string, signal: AbortSignal, onProgress: (task: TaskDetail) => void): Promise<void> {
  let task = store.getTask(sessionId, taskId)
  const plan = planOf(task)
  assertBookSummaryCurrent(store, sessionId, task)
  const artifacts = bookSummaryResult(store, sessionId, task)!.artifacts
  const latest = (kind: BookSummaryStepKind) => artifacts.filter(a => a.kind === kind).at(-1)
  for (let i = 0; i < plan.steps.length; i++) {
    task = store.getTask(sessionId, taskId)
    if (signal.aborted || task.cancelRequested) throw new ProjectError('TASK_CANCELLED', '分析已停止')
    const step = task.steps[i]
    if (step.state === 'completed') continue
    if (step.state === 'skipped') throw new ProjectError('INVALID_STATE_TRANSITION', '全书总结必需步骤不能跳过')
    assertBookSummaryCurrent(store, sessionId, task)
    const planned = plan.steps[i]
    const { kind, segmentIndex, stageIndex } = planned
    store.updateTaskStep(sessionId, step.id, { state: 'running', attemptCount: step.attemptCount + 1 })
    onProgress(store.getTask(sessionId, taskId))
    const segment = segmentIndex ? plan.segments[segmentIndex - 1] : undefined
    const stageSmalls = artifacts.filter(a => a.kind === 'small' && a.stageIndex === stageIndex)
    const ranges = segment?.ranges ?? (stageIndex ? stageSmalls.flatMap(a => a.ranges) : plan.segments.flatMap(s => s.ranges))
    const assessment = latest('systemAssess')?.assessment
    let output: { content: string; graph?: z.infer<typeof SummaryRelationGraphSchema>; assessment?: z.infer<typeof SummarySystemAssessmentSchema> }
    const notApplicable = kind === 'system' && assessment?.applicable === false
    let inputTokens = 0
    let outputTokens = 0
    if (notApplicable) output = { content: `本书暂不建立体系表。\n\n${assessment.reason}` }
    else {
      const chapters = readChapters(store, sessionId)
      const variables: Record<string, string | number> = {
        index: segmentIndex ?? stageIndex ?? 1, total: plan.segments.length, title: segment?.title ?? '',
        charCount: segment?.charCount ?? stageSmalls.reduce((n, a) => n + plan.segments[a.segmentIndex! - 1].charCount, 0),
        mainlineLength: latest('mainline')?.content.length ?? 0, mainlineDraft: latest('mainline')?.content ?? '暂无',
        currentMainline: latest('mainline')?.content ?? '暂无', smallSummary: latest('small')?.content ?? '无',
        smallSummaries: stageSmalls.map(a => a.content).join('\n\n---\n\n'),
        bigSummaries: artifacts.filter(a => a.kind === 'stage').map(a => a.content).join('\n\n---\n\n'),
        count: kind === 'super' ? artifacts.filter(a => a.kind === 'stage').length : stageSmalls.length,
        projectName: plan.projectName, current: latest(kind)?.content ?? '暂无',
        bigSummary: latest('stage')?.content ?? '无', label: assessment?.label ?? '体系表',
        materials: JSON.stringify(artifacts.filter(a => ['super', 'mainline', ...LEDGERS].includes(a.kind) && latest(a.kind) === a))
      }
      let prompt = BOOK_SUMMARY_PROMPTS[kind].replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(variables[key] ?? ''))
      if (kind === 'small') {
        prompt += '\n\n## 正文来源坐标\n' + JSON.stringify(ranges) + '\n\n## 本片段完整原文\n' + ranges.map(r => {
          const c = chapters.find(c => c.id === r.chapterId)!
          return `【${c.title}；${r.startOffset}–${r.endOffset}】\n${c.content.slice(r.startOffset, r.endOffset)}`
        }).join('\n\n')
      }
      if (instruction.trim()) prompt += `\n\n## 作者补充要求（服从事实边界与输出协议）\n${instruction}`
      const schema = kind === 'relations' ? RelationsOutputSchema : kind === 'systemAssess' ? AssessmentOutputSchema : TextOutputSchema
      const result = await gateway.generateStructuredJson({
        connectionId: task.connectionId!, taskId, taskType: 'book_summary', messages: compilePromptMessages('book_summary', { instruction: prompt }, snapshot),
        maxTokens: snapshot.budget!.maxOutputTokens, requestBudget: snapshot.budget,
        zodSchema: schema, jsonSchema: z.toJSONSchema(schema), signal, priority: 'low'
      })
      output = schema.parse(result.data)
      inputTokens = result.usage?.promptTokens ?? 0
      outputTokens = result.usage?.completionTokens ?? 0
      if (output.graph) {
        const ids = new Set(output.graph.nodes.map(n => n.id))
        if (ids.size !== output.graph.nodes.length || output.graph.edges.some(e => !ids.has(e.source) || !ids.has(e.target))) {
          throw new ProjectError('MODEL_OUTPUT_INVALID', '角色关系图节点重复或连线引用不存在的节点')
        }
      }
      if (output.assessment?.applicable && !output.assessment.label.trim()) throw new ProjectError('MODEL_OUTPUT_INVALID', '适用体系必须提供名称')
    }
    if (signal.aborted) throw new ProjectError('TASK_CANCELLED', '分析已停止')
    const artifact: BookSummaryArtifact = { ...planned, stepId: step.id, position: i, ranges, ...output, notApplicable }
    store.transaction(sessionId, () => {
      assertBookSummaryCurrent(store, sessionId, task)
      const currentTask = store.getTask(sessionId, taskId)
      if (currentTask.state !== 'running' || currentTask.cancelRequested) throw new ProjectError('TASK_CANCELLED', '分析已停止')
      store.updateTaskStep(sessionId, step.id, { state: 'completed', checkpointJson: JSON.stringify(artifact), resultState: 'current' })
      store.updateTask(sessionId, taskId, { inputTokens: (currentTask.inputTokens ?? 0) + inputTokens, outputTokens: (currentTask.outputTokens ?? 0) + outputTokens })
    })
    artifacts.push(artifact)
    onProgress(store.getTask(sessionId, taskId))
  }
  // 发布与任务完成在同一事务内；恢复只重做未提交的模型步骤。
  store.transaction(sessionId, () => {
    task = store.getTask(sessionId, taskId)
    assertBookSummaryCurrent(store, sessionId, task)
    if (signal.aborted || task.state !== 'running' || task.cancelRequested) throw new ProjectError('TASK_CANCELLED', '分析已停止')
    const versions = Object.fromEntries(plan.sources.map(s => [s.chapterId, s.version]))
    store.commitBookSynopsis(sessionId, latest('super')!.content, JSON.stringify(versions), taskId)
    if (!store.getBookOutline(sessionId)) store.saveBookOutline(sessionId, { content: latest('outline')!.content, expectedVersion: 0, state: 'draft', sourceVersions: versions })
    store.updateTask(sessionId, taskId, { state: 'completed', completedAt: Date.now() })
  })
  onProgress(store.getTask(sessionId, taskId))
}

export function applySummaryOutline(store: ProjectStore, sessionId: string, taskId: string, expectedVersion: number): BookOutline {
  return store.transaction(sessionId, () => {
    const task = store.getTask(sessionId, taskId)
    if (task.type !== 'book_summary' || task.state !== 'completed') throw new ProjectError('INVALID_STATE_TRANSITION', '只有完整成功的全书总结可以应用大纲')
    assertBookSummaryCurrent(store, sessionId, task)
    const result = bookSummaryResult(store, sessionId, task)!
    return store.saveBookOutline(sessionId, { content: result.outlineCandidate!, expectedVersion, state: 'draft',
      sourceVersions: Object.fromEntries(result.sources.map(s => [s.chapterId, s.version])) })
  })
}

export function exportBookSummary(store: ProjectStore, sessionId: string, taskId: string, destination: string): { savedPath: string } {
  const task = store.getTask(sessionId, taskId)
  const result = bookSummaryResult(store, sessionId, task)
  if (!result) throw new ProjectError('VALIDATION_ERROR', '该任务没有可导出的完整总结流程结果')
  const text = [
    '# 全书剧情提取资料', `任务：${taskId}；状态：${task.state}；来源：${result.resultState}；正文字符数：${result.totalChars}`,
    '## 来源章节', '```json\n' + JSON.stringify(result.sources, null, 2) + '\n```',
    '## 步骤状态', ...task.steps.map((s, i) => `${i + 1}. ${result.stepPlan[i].title}：${s.state}`),
    ...result.artifacts.flatMap(a => [`## ${a.title}`, `来源坐标：\`${JSON.stringify(a.ranges)}\``, a.content,
      ...(a.graph ? ['```json\n' + JSON.stringify(a.graph, null, 2) + '\n```'] : []),
      ...(a.assessment ? ['```json\n' + JSON.stringify(a.assessment, null, 2) + '\n```'] : [])])
  ].join('\n\n')
  const target = resolve(destination)
  if (!existsSync(dirname(target))) throw new ProjectError('VALIDATION_ERROR', '导出目标目录不存在')
  const temp = `${target}.tmp-${randomUUID()}`
  try {
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' })
    renameSync(temp, target)
    return { savedPath: target }
  } catch {
    try { if (existsSync(temp)) unlinkSync(temp) } catch {}
    throw new ProjectError('EXPORT_FAILED', '导出全书总结失败')
  }
}
