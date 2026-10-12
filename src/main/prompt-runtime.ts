import type { AssembledMessage, PromptSnapshot, PromptTask, TaskType, ChatWorkflowStage } from '../shared/project.js'
import {
  ANALYSIS_PROTOCOLS,
  TASK_PROTOCOLS,
  PROMPT_DEFINITIONS,
  PROMPT_MARKERS,
  type PromptDefinition,
  type PromptMarker
} from './prompt-preset.js'
import { ProjectError } from './project-store.js'
import type { PromptSettingsStore } from './prompt-store.js'
export type { PromptMarker } from './prompt-preset.js'

export const ANALYSIS_TASKS: ReadonlySet<PromptTask> = new Set([
  'knowledge', 'report', 'style_distill', 'book_summary', 'synopsis_compress',
  'synopsis_step', 'synopsis_final', 'distill_segment', 'distill_stage', 'distill_master',
  'summary_segment', 'summary_stage', 'summary_master', 'book_outline', 'chat_summary'
])

export function promptTask(taskType: TaskType, stage?: ChatWorkflowStage | null): PromptTask {
  return taskType === 'chat' && stage && stage !== 'reviewed' ? stage : taskType
}

export function resolvePromptDefinitions(task: PromptTask, snapshot: PromptSnapshot): PromptDefinition[] {
  // 1. 后台分析类任务：严格遵循内置结构化 JSON 协议，不受酒馆预设影响
  if (ANALYSIS_TASKS.has(task)) {
    return [
      { id: 'core', name: '共同边界', role: 'system', content: PROMPT_DEFINITIONS[0].content },
      { id: `task.${task}`, name: `任务协议：${task}`, role: 'system', tasks: [task], content: ANALYSIS_PROTOCOLS[task] },
      ...PROMPT_MARKERS.map((marker) => ({ id: `marker.${marker}`, name: marker, role: 'user' as const, marker }))
    ]
  }

  // 2. 创作类任务：保留共同边界和任务协议，活跃预设只提供额外指导
  const activePreset = snapshot.activePreset
  const activeBlocks = activePreset?.blocks.filter((b) => b.enabled) ?? []
  const required: PromptDefinition[] = [
    { id: 'core', name: '共同边界', role: 'system', content: PROMPT_DEFINITIONS[0].content },
    { id: `task.${task}`, name: `任务协议：${task}`, role: 'system', tasks: [task], content: TASK_PROTOCOLS[task] }
  ]

  if (activeBlocks.length > 0) {
    const definitions: PromptDefinition[] = [
      ...required,
      ...activeBlocks
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((b) => b.id !== 'core' && b.id !== `task.${task}`)
      .map((b) => {
        const markerKey = b.marker ? (b.marker.startsWith('marker.') ? b.marker.slice(7) : b.marker) as PromptMarker : undefined
        const structuralMarker = markerKey === 'history' || markerKey === 'task'
        return {
          id: b.id,
          name: b.name,
          role: b.role,
          content: b.content,
          position: structuralMarker ? 'relative' : b.position,
          depth: structuralMarker ? 0 : b.depth,
          order: b.order,
          marker: markerKey
        }
      })
    ]

    // 确保所有材料插槽在 history 和 task 之前
    for (const marker of PROMPT_MARKERS) {
      if (marker !== 'history' && marker !== 'task' && !definitions.some((d) => d.marker === marker)) {
        const historyIndex = definitions.findIndex((d) => d.marker === 'history')
        if (historyIndex >= 0) {
          definitions.splice(historyIndex, 0, { id: `marker.${marker}`, name: marker, role: 'user', marker })
        } else {
          const taskIndex = definitions.findIndex((d) => d.marker === 'task')
          if (taskIndex >= 0) {
            definitions.splice(taskIndex, 0, { id: `marker.${marker}`, name: marker, role: 'user', marker })
          } else {
            definitions.push({ id: `marker.${marker}`, name: marker, role: 'user', marker })
          }
        }
      }
    }
    if (!definitions.some((d) => d.marker === 'history')) {
      const taskIndex = definitions.findIndex((d) => d.marker === 'task')
      if (taskIndex >= 0) {
        definitions.splice(taskIndex, 0, { id: 'marker.history', name: 'history', role: 'user', marker: 'history' })
      } else {
        definitions.push({ id: 'marker.history', name: 'history', role: 'user', marker: 'history' })
      }
    }
    if (!definitions.some((d) => d.marker === 'task')) {
      definitions.push({ id: 'marker.task', name: 'task', role: 'user', marker: 'task' })
    }
    return definitions
  }

  // 3. 回退状态：未配置预设或全部关闭时使用内置协议
  return [
    ...required,
    ...PROMPT_MARKERS.map((marker) => ({ id: `marker.${marker}`, name: marker, role: 'user' as const, marker }))
  ]
}

export function compilePromptMessages(
  task: PromptTask,
  input: {
    instruction: string
    materials?: Partial<Record<PromptMarker, AssembledMessage[]>>
    targetLength?: number
    creativity?: 'low' | 'medium' | 'high'
    includedDefinitionIds?: string[]
  },
  snapshot: PromptSnapshot
): AssembledMessage[] {
  const allDefinitions = resolvePromptDefinitions(task, snapshot)
  const requiredDefinitionIds = new Set(['core', `task.${task}`])
  const definitions = allDefinitions.filter((definition) =>
    definition.marker || requiredDefinitionIds.has(definition.id) || !input.includedDefinitionIds || input.includedDefinitionIds.includes(definition.id)
  )
  const messages: AssembledMessage[] = []
  const history = input.materials?.history ?? []
  const inChatDefinitions = definitions.filter((entry) => entry.position === 'in_chat')
  const emittedMarkers = new Set<string>()

  const emitPendingMaterials = () => {
    for (const marker of PROMPT_MARKERS) {
      if (marker !== 'history' && marker !== 'task' && !emittedMarkers.has(marker)) {
        const mat = input.materials?.[marker]
        if (mat && mat.length > 0) {
          messages.push(...mat)
          emittedMarkers.add(marker)
        }
      }
    }
  }

  for (const definition of definitions) {
    if (definition.position === 'in_chat') continue

    if (definition.marker === 'history') {
      emitPendingMaterials()
      emittedMarkers.add('history')
      if (definition.content && definition.content.trim()) messages.push({ role: definition.role, content: definition.content })
      for (let index = 0; index <= history.length; index++) {
        const atPosition = inChatDefinitions
          .filter((entry) => Math.max(0, history.length - (entry.depth ?? 0)) === index)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        for (const entry of atPosition) {
          if (entry.content && entry.content.trim()) messages.push({ role: entry.role, content: entry.content })
          if (entry.marker && !emittedMarkers.has(entry.marker)) {
            const mat = input.materials?.[entry.marker]
            if (mat) {
              messages.push(...mat)
              emittedMarkers.add(entry.marker)
            }
          }
        }
        if (history[index]) messages.push(history[index])
      }
    } else if (definition.marker === 'task') {
      emitPendingMaterials()
      emittedMarkers.add('task')
      if (definition.content && definition.content.trim()) {
        messages.push({ role: definition.role, content: definition.content })
      }
      messages.push({ role: 'user', content: authorTaskMessage(input) })
    } else {
      if (definition.content && definition.content.trim()) {
        messages.push({ role: definition.role, content: definition.content })
      }
      if (definition.marker && !emittedMarkers.has(definition.marker)) {
        const mat = input.materials?.[definition.marker]
        if (mat) {
          messages.push(...mat)
          emittedMarkers.add(definition.marker)
        }
      }
    }
  }

  emitPendingMaterials()
  if (!emittedMarkers.has('history') && history.length > 0) {
    messages.push(...history)
    emittedMarkers.add('history')
  }
  if (!emittedMarkers.has('task')) {
    messages.push({ role: 'user', content: authorTaskMessage(input) })
  }

  return messages
}

function authorTaskMessage(input: { instruction: string; targetLength?: number; creativity?: 'low' | 'medium' | 'high' }): string {
  const parameters = [
    input.targetLength ? `目标篇幅约 ${input.targetLength} 字，避免为凑字数填充重复内容。` : '',
    input.creativity ? `探索范围：${({ low: '在已定事件与设定内细化表达，不增加剧情分支', medium: '允许符合人物动机的局部发展，不改变关键事件', high: '可探索合理分支与新细节，但须遵守事实、范围与作者要求' })[input.creativity]}。` : '',
    input.instruction.trim() || '请根据以上资料完成本次任务。'
  ].filter(Boolean)
  return `【本次作者任务】\n${parameters.join('\n')}`
}

export function assertPromptSnapshotFresh(
  store: PromptSettingsStore,
  snapshot: PromptSnapshot,
  connection: { id: string; version: number; contextWindow: number; maxOutputTokens: number; safetyMarginRatio: number; tokenEstimationRatio: number }
): void {
  const current = store.snapshot(connection)
  if (snapshot.fingerprint !== current.fingerprint || JSON.stringify(snapshot.budget) !== JSON.stringify(current.budget)) {
    throw new ProjectError('STALE_CONTEXT_PACKAGE', '全局预设设置、提示词定义或连接预算已变化，请重新生成预览或创建任务')
  }
}
