import { describe, expect, it } from 'vitest'
import {
  PromptTaskSchema,
  type AssembledMessage,
  type PromptTask,
  type NovelPromptPreset,
  DEFAULT_PRESET_STORE
} from '../src/shared/project'
import {
  ANALYSIS_PROTOCOLS,
  FALLBACK_CREATION_PROTOCOLS,
  PROMPT_MARKERS
} from '../src/main/prompt-preset'
import {
  compilePromptMessages,
  promptTask,
  ANALYSIS_TASKS
} from '../src/main/prompt-runtime'
import { PromptSettingsStore } from '../src/main/prompt-store'

function snapshotWithPreset(preset?: NovelPromptPreset) {
  const store = new PromptSettingsStore()
  if (preset) {
    store.save({ activePresetId: preset.id, presets: [preset] })
  } else {
    store.save(DEFAULT_PRESET_STORE)
  }
  return store.snapshot()
}

describe('酒馆预设与任务插槽编译入口', () => {
  it('所有后台分析类任务严格使用内置协议，不受预设影响', () => {
    const customPreset: NovelPromptPreset = {
      id: 'custom-preset',
      name: '自定义创作预设',
      blocks: [
        { id: 'b1', name: '覆盖系统提示', role: 'system', content: '酒馆提示词不应污染分析任务', enabled: true, position: 'relative', depth: 0, order: 0 }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const snap = snapshotWithPreset(customPreset)

    for (const task of ANALYSIS_TASKS) {
      const messages = compilePromptMessages(task, { instruction: '请分析本章' }, snap)
      const contents = messages.map((m) => m.content)
      // 必须包含内置结构化分析协议
      expect(contents.some((c) => c.includes(ANALYSIS_PROTOCOLS[task]))).toBe(true)
      // 绝不包含创作预设的正文
      expect(contents.some((c) => c.includes('酒馆提示词不应污染分析任务'))).toBe(false)
    }
  })

  it('未配置预设或全部关闭时，创作类任务安全回退到内置极简创作协议', () => {
    const snap = snapshotWithPreset(undefined)
    const creationTasks: PromptTask[] = ['continue', 'rewrite', 'polish', 'chat', 'direction', 'chapter_outline', 'content']

    for (const task of creationTasks) {
      const messages = compilePromptMessages(task, { instruction: '作者指令' }, snap)
      const contents = messages.map((m) => m.content)
      expect(contents.some((c) => c.includes(FALLBACK_CREATION_PROTOCOLS[task]))).toBe(true)
      expect(contents.at(-1)).toContain('作者指令')
    }
  })

  it('配置活跃预设时，创作类任务由预设 Block 接管，支持启停控制', () => {
    const preset: NovelPromptPreset = {
      id: 'preset-active',
      name: '活跃预设',
      blocks: [
        { id: 'b1', name: '系统引导', role: 'system', content: '【系统引导正文】', enabled: true, position: 'relative', depth: 0, order: 1 },
        { id: 'b2', name: '禁用模块', role: 'system', content: '【已禁用的模块】', enabled: false, position: 'relative', depth: 0, order: 2 },
        { id: 'b3', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 3, marker: 'marker.history' },
        { id: 'b4', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 4, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const snap = snapshotWithPreset(preset)
    const messages = compilePromptMessages('continue', { instruction: '正文续写指令' }, snap)
    const contents = messages.map((m) => m.content)

    expect(contents).toContain('【系统引导正文】')
    expect(contents).not.toContain('【已禁用的模块】')
    expect(contents.at(-1)).toContain('正文续写指令')
  })

  it('资料插槽保持 role 和独立消息，显式排序并在历史与任务前注入', () => {
    const materials = Object.fromEntries(
      PROMPT_MARKERS.filter((m) => m !== 'task' && m !== 'history').map((marker) => [
        marker,
        [{ role: 'user', content: `材料:${marker}` }]
      ])
    )
    materials.history = [
      { role: 'user', content: '历史:user' },
      { role: 'assistant', content: '历史:assistant' }
    ]

    const preset: NovelPromptPreset = {
      id: 'preset-materials',
      name: '材料测试预设',
      blocks: [
        { id: 'b0', name: '顶层设定', role: 'system', content: '系统顶层说明', enabled: true, position: 'relative', depth: 0, order: 0 },
        { id: 'b-hist', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 10, marker: 'marker.history' },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 20, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }

    const messages = compilePromptMessages('continue', {
      instruction: '最终作者指令',
      materials: materials as Parameters<typeof compilePromptMessages>[1]['materials']
    }, snapshotWithPreset(preset))

    const contents = messages.map((m) => m.content)

    // 所有材料应该在历史和任务之前
    const historyIndex = contents.indexOf('历史:user')
    expect(historyIndex).toBeGreaterThan(0)
    for (const marker of PROMPT_MARKERS) {
      if (marker !== 'history' && marker !== 'task') {
        const matIndex = contents.indexOf(`材料:${marker}`)
        expect(matIndex).toBeGreaterThan(0)
        expect(matIndex).toBeLessThan(historyIndex)
      }
    }

    // 历史角色保持
    expect(messages.find((m) => m.content === '历史:assistant')?.role).toBe('assistant')
    // 最终作者指令在最后
    expect(contents.at(-1)).toContain('最终作者指令')
  })

  it.each([0, 1, 20])('in_chat depth=%s 从历史尾部定位，超深度夹到开头', (depth) => {
    const preset: NovelPromptPreset = {
      id: 'preset-inchat',
      name: 'In-chat预设',
      blocks: [
        { id: 'b-chat', name: '会话中提示', role: 'system', content: `深度提示:${depth}`, enabled: true, position: 'in_chat', depth, order: 1 },
        { id: 'b-hist', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.history' },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 3, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const history: AssembledMessage[] = [
      { role: 'user', content: '历史一' },
      { role: 'assistant', content: '历史二' }
    ]
    const contents = compilePromptMessages('continue', {
      instruction: '作者',
      materials: { history }
    }, snapshotWithPreset(preset)).map((m) => m.content)

    const injectIndex = contents.indexOf(`深度提示:${depth}`)
    if (depth === 0) expect(injectIndex).toBe(contents.indexOf('历史二') + 1)
    if (depth === 1) expect(injectIndex).toBe(contents.indexOf('历史一') + 1)
    if (depth === 20) expect(injectIndex).toBe(contents.indexOf('历史一') - 1)
  })

  it('没有历史仍注入 depth 0，且同位置按 order 升序排列', () => {
    const preset: NovelPromptPreset = {
      id: 'preset-orders',
      name: '多Block排序预设',
      blocks: [
        { id: 'b1', name: '后置块', role: 'system', content: '定位后', enabled: true, position: 'in_chat', depth: 0, order: 5 },
        { id: 'b2', name: '前置块', role: 'system', content: '定位前', enabled: true, position: 'in_chat', depth: 0, order: -1 },
        { id: 'b3', name: '中置块', role: 'system', content: '定位中', enabled: true, position: 'in_chat', depth: 0, order: 2 },
        { id: 'b-hist', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 10, marker: 'marker.history' },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 20, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const contents = compilePromptMessages('continue', { instruction: '作者' }, snapshotWithPreset(preset)).map((m) => m.content)
    const taskIndex = contents.findIndex((c) => c.includes('【本次作者任务】'))
    expect(contents.slice(taskIndex - 3, taskIndex)).toEqual(['定位前', '定位中', '定位后'])
  })

  it('聊天阶段映射保留 direction/outline/content，reviewed 回普通 chat', () => {
    expect(promptTask('chat', 'direction')).toBe('direction')
    expect(promptTask('chat', 'chapter_outline')).toBe('chapter_outline')
    expect(promptTask('chat', 'content')).toBe('content')
    expect(promptTask('chat', 'reviewed')).toBe('chat')
    expect(promptTask('polish', 'content')).toBe('polish')
  })

  it('显式声明的资料插槽按其 order 精确注入，位于历史之后的插槽绝不被提前倾倒', () => {
    const preset: NovelPromptPreset = {
      id: 'preset-order-faithful',
      name: '插槽精确拓扑预设',
      blocks: [
        { id: 'b0', name: '顶层设定', role: 'system', content: '顶层说明', enabled: true, position: 'relative', depth: 0, order: 0 },
        { id: 'b-know', name: '设定插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 5, marker: 'marker.knowledge' },
        { id: 'b-hist', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 10, marker: 'marker.history' },
        { id: 'b-post', name: '历史后置规则', role: 'system', content: '【Post-History 强约束规则】', enabled: true, position: 'relative', depth: 0, order: 15 },
        { id: 'b-style', name: '风格样本插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 20, marker: 'marker.style_samples' },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 25, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }

    const messages = compilePromptMessages('continue', {
      instruction: '正文任务指令',
      materials: {
        knowledge: [{ role: 'user', content: '设定正文:掌天瓶' }],
        history: [{ role: 'user', content: '前文正文:修仙第一步' }],
        style_samples: [{ role: 'user', content: '风格范文:沉稳内敛' }]
      }
    }, snapshotWithPreset(preset))

    const contents = messages.map((m) => m.content)
    const knowIdx = contents.indexOf('设定正文:掌天瓶')
    const histIdx = contents.indexOf('前文正文:修仙第一步')
    const postIdx = contents.indexOf('【Post-History 强约束规则】')
    const styleIdx = contents.indexOf('风格范文:沉稳内敛')
    const taskIdx = contents.findIndex((c) => c.includes('正文任务指令'))

    // 严格遵循预设 order: know < hist < post < style < task
    expect(knowIdx).toBeGreaterThan(0)
    expect(knowIdx).toBeLessThan(histIdx)
    expect(postIdx).toBeGreaterThan(histIdx)
    expect(styleIdx).toBeGreaterThan(postIdx)
    expect(taskIdx).toBeGreaterThan(styleIdx)
  })

  it('任务前置拓扑保真：Task 插槽位于 History 之前时，严格保持在 History 之前发射', () => {
    const preset: NovelPromptPreset = {
      id: 'preset-task-before-hist',
      name: 'Task前置预设',
      blocks: [
        { id: 'b-guide', name: '引导', role: 'system', content: '写作引导', enabled: true, position: 'relative', depth: 0, order: 1 },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 5, marker: 'marker.task' },
        { id: 'b-hist', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 10, marker: 'marker.history' }
      ],
      createdAt: 1,
      updatedAt: 1
    }

    const messages = compilePromptMessages('continue', {
      instruction: '前置任务指令内容',
      materials: {
        history: [{ role: 'user', content: '历史对话' }]
      }
    }, snapshotWithPreset(preset))

    const contents = messages.map((m) => m.content)
    const taskIdx = contents.findIndex((c) => c.includes('前置任务指令内容'))
    const histIdx = contents.indexOf('历史对话')

    expect(taskIdx).toBeGreaterThan(0)
    expect(histIdx).toBeGreaterThan(taskIdx)
  })

  it('预设完全未声明 task 插槽时，在末尾保底补发一次任务指令', () => {
    const preset: NovelPromptPreset = {
      id: 'preset-no-task',
      name: '无Task预设',
      blocks: [
        { id: 'b-main', name: '主提示', role: 'system', content: '写小说', enabled: true, position: 'relative', depth: 0, order: 1 },
        { id: 'b-hist', name: '历史', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.history' }
      ],
      createdAt: 1,
      updatedAt: 1
    }

    const messages = compilePromptMessages('continue', {
      instruction: '保底任务指令',
      materials: {
        history: [{ role: 'user', content: '历史内容' }]
      }
    }, snapshotWithPreset(preset))

    const contents = messages.map((m) => m.content)
    const histIdx = contents.indexOf('历史内容')
    const taskIdx = contents.findIndex((c) => c.includes('保底任务指令'))

    expect(taskIdx).toBeGreaterThan(histIdx)
    expect(taskIdx).toBe(contents.length - 1)
  })
})