import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseTavernPreset,
  cleanTavernContent,
  detectBlockMarker
} from '../src/main/tavern-importer'
import {
  DEFAULT_PRESET_STORE,
  type NovelPromptPreset,
  type PresetStoreData
} from '../src/shared/prompt-settings'
import {
  compilePromptMessages,
  resolvePromptDefinitions,
  ANALYSIS_TASKS
} from '../src/main/prompt-runtime'
import { ANALYSIS_PROTOCOLS, FALLBACK_CREATION_PROTOCOLS } from '../src/main/prompt-preset'
import { PromptSettingsStore } from '../src/main/prompt-store'

describe('酒馆预设导入解析与清洗 (tavern-importer)', () => {
  it('自动替换酒馆宏变量为小说语境', () => {
    const raw = `你是{{char}}，由{{user}}设定的助手。<world_info>\n<chat_history>\n请等待{{user}}的指令：<input>`
    const cleaned = cleanTavernContent(raw)
    expect(cleaned).toContain('你是叙述者，由作者设定的助手。')
    expect(cleaned).not.toContain('{{user}}')
    expect(cleaned).not.toContain('{{char}}')
    expect(cleaned).toContain('【设定库资料】')
    expect(cleaned).toContain('【会话历史】')
    expect(cleaned).toContain('【作者任务】')
  })

  it('智能过滤单人角色扮演专有提示语', () => {
    const raw = `
作为专业小说创作者，你需要深入刻画人物动机。
Wait for {{user}} to respond.
Do not act on behalf of {{user}}.
Never impersonate {{user}}.
You are in a roleplay session.
Stay in character at all times.
以沉浸式第三人称展开叙述。
`
    const cleaned = cleanTavernContent(raw)
    expect(cleaned).toContain('作为专业小说创作者，你需要深入刻画人物动机。')
    expect(cleaned).toContain('以沉浸式第三人称展开叙述。')
    expect(cleaned).not.toContain('Wait for')
    expect(cleaned).not.toContain('Do not act on behalf')
    expect(cleaned).not.toContain('Never impersonate')
    expect(cleaned).not.toContain('roleplay session')
    expect(cleaned).not.toContain('Stay in character')
  })

  it('自动识别并绑定资料插槽 marker', () => {
    expect(detectBlockMarker({ identifier: 'world_info', name: 'World Info', content: '' })).toBe('marker.knowledge')
    expect(detectBlockMarker({ identifier: 'chat_history', name: 'Chat History', content: '' })).toBe('marker.history')
    expect(detectBlockMarker({ identifier: 'input_block', name: 'Author Input', content: '【本次写作任务】' })).toBe('marker.task')
    expect(detectBlockMarker({ identifier: 'custom', name: 'Main Style', content: '华丽文风' })).toBeUndefined()
  })

  it('正确解析标准 SillyTavern Preset JSON 并补齐必要插槽', () => {
    const tavernJson = JSON.stringify({
      name: '狐神抚酒馆预设',
      prompts: [
        {
          identifier: 'main_prompt',
          name: 'Main Prompt',
          content: 'You are {{char}} assisting {{user}} in novel writing.',
          role: 'system',
          injection_position: 'relative',
          injection_order: 10,
          enabled: true
        },
        {
          identifier: 'dialogue_style',
          name: 'Dialogue Style',
          content: 'Keep dialogue concise and authentic.',
          role: 'system',
          injection_position: 'in_chat',
          injection_depth: 2,
          injection_order: 20,
          enabled: true
        }
      ]
    })

    const parsed = parseTavernPreset(tavernJson)
    expect(parsed.name).toBe('狐神抚酒馆预设')
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(2)

    // 验证清洗结果
    const mainBlock = parsed.blocks.find((b) => b.name === 'Main Prompt')
    expect(mainBlock).toBeDefined()
    expect(mainBlock?.content).toContain('叙述者')
    expect(mainBlock?.content).toContain('作者')
    expect(mainBlock?.role).toBe('system')
    expect(mainBlock?.position).toBe('relative')

    // 验证 in-chat 深度
    const dialogueBlock = parsed.blocks.find((b) => b.name === 'Dialogue Style')
    expect(dialogueBlock).toBeDefined()
    expect(dialogueBlock?.position).toBe('in_chat')
    expect(dialogueBlock?.depth).toBe(2)

    // 验证自动补充缺失的设定库、历史和任务插槽
    expect(parsed.blocks.some((b) => b.marker === 'marker.knowledge')).toBe(true)
    expect(parsed.blocks.some((b) => b.marker === 'marker.history')).toBe(true)
    expect(parsed.blocks.some((b) => b.marker === 'marker.task')).toBe(true)
  })

  it('正确解析包含嵌套 character_id 的标准 SillyTavern prompt_order 及其启停开关与排序', () => {
    const stJson = JSON.stringify({
      name: '智脑高阶预设',
      prompts: [
        { identifier: 'main', name: 'Main Prompt', content: 'You are {{char}}.', role: 'system' },
        { identifier: 'worldInfoBefore', name: 'World Info (before)', content: '', system_prompt: true },
        { identifier: 'chatHistory', name: 'Chat History', content: '' },
        { identifier: 'nsfw', name: 'NSFW Filter', content: 'filter text', role: 'system' }
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'worldInfoBefore', enabled: true },
            { identifier: 'main', enabled: true },
            { identifier: 'nsfw', enabled: false },
            { identifier: 'chatHistory', enabled: true }
          ]
        }
      ]
    })

    const parsed = parseTavernPreset(stJson)
    expect(parsed.name).toBe('智脑高阶预设')

    const wiBlock = parsed.blocks.find((b) => b.name === 'World Info (before)')
    const mainBlock = parsed.blocks.find((b) => b.name === 'Main Prompt')
    const nsfwBlock = parsed.blocks.find((b) => b.name === 'NSFW Filter')
    const chatBlock = parsed.blocks.find((b) => b.name === 'Chat History')

    expect(wiBlock).toBeDefined()
    expect(mainBlock).toBeDefined()
    expect(nsfwBlock).toBeDefined()
    expect(chatBlock).toBeDefined()

    // 验证 prompt_order 顺序：worldInfoBefore 在 main 之前
    expect(wiBlock!.order).toBeLessThan(mainBlock!.order)
    expect(mainBlock!.order).toBeLessThan(nsfwBlock!.order)
    expect(nsfwBlock!.order).toBeLessThan(chatBlock!.order)

    // 验证启停状态正确继承
    expect(wiBlock!.enabled).toBe(true)
    expect(mainBlock!.enabled).toBe(true)
    expect(nsfwBlock!.enabled).toBe(false)
    expect(chatBlock!.enabled).toBe(true)

    // 验证插槽正确映射
    expect(wiBlock!.marker).toBe('marker.knowledge')
    expect(chatBlock!.marker).toBe('marker.history')
  })

  it('全面清洗中文与英文角色扮演禁令及带空格的宏', () => {
    const raw = `
{{ user }}要求你保持严谨。{{ char }}是叙述者。
严禁代替{{ user }}发言，请等待{{ user }}输入。
禁止替作者做决定，切勿代为推进剧情。
Don't speak for {{user}}.
Never impersonate {{user}}.
Avoid generating dialogue for user.
Stay in character at all times.
You are in a roleplay session with user.
`
    const cleaned = cleanTavernContent(raw)
    expect(cleaned).toContain('作者要求你保持严谨。叙述者是叙述者。')
    expect(cleaned).not.toContain('严禁代替')
    expect(cleaned).not.toContain('请等待')
    expect(cleaned).not.toContain('禁止替作者做决定')
    expect(cleaned).not.toContain('切勿代为推进剧情')
    expect(cleaned).not.toContain("Don't speak for")
    expect(cleaned).not.toContain('Never impersonate')
    expect(cleaned).not.toContain('Avoid generating dialogue')
    expect(cleaned).not.toContain('Stay in character')
    expect(cleaned).not.toContain('roleplay session')
  })

  it('当 Block 既有说明正文又绑定插槽时，正文得以保留且材料不会重复注入', () => {
    const preset: NovelPromptPreset = {
      id: 'p-dual',
      name: '说明文与插槽共存预设',
      blocks: [
        { id: 'b1', name: '设定说明与插槽', role: 'system', content: '【必须遵守以下设定库资料】', enabled: true, position: 'relative', depth: 0, order: 0, marker: 'marker.knowledge' },
        { id: 'b2', name: '次级设定插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 1, marker: 'marker.knowledge' },
        { id: 'b-task', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.task' }
      ],
      createdAt: 1,
      updatedAt: 1
    }

    const store = new PromptSettingsStore()
    store.save({ activePresetId: 'p-dual', presets: [preset] })
    const snap = store.snapshot()

    const messages = compilePromptMessages('continue', {
      instruction: '请续写',
      materials: {
        knowledge: [{ role: 'user', content: '设定正文：掌天瓶' }]
      }
    }, snap)

    const contents = messages.map((m) => m.content)
    // 静态说明文字得到保留
    expect(contents).toContain('【必须遵守以下设定库资料】')
    // 材料正文存在且仅注入一次（不重复）
    const occurrences = contents.filter((c) => c === '设定正文：掌天瓶')
    expect(occurrences).toHaveLength(1)
  })
})

describe('多预设库管理与装配编译', () => {
  it('多预设切换与持久化状态', () => {
    const store = new PromptSettingsStore()
    expect(store.getActivePreset()).toBeNull()

    const preset1: NovelPromptPreset = {
      id: 'p1',
      name: '纯爱日常',
      blocks: [
        { id: 'b1', name: '日常风格', role: 'system', content: '细腻温馨', enabled: true, position: 'relative', depth: 0, order: 0 }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const preset2: NovelPromptPreset = {
      id: 'p2',
      name: '硬核克苏鲁',
      blocks: [
        { id: 'b2', name: '克系风格', role: 'system', content: '不可名状与疯狂', enabled: true, position: 'relative', depth: 0, order: 0 }
      ],
      createdAt: 2,
      updatedAt: 2
    }

    const state1 = store.save({ activePresetId: 'p1', presets: [preset1, preset2] })
    expect(state1.store.activePresetId).toBe('p1')
    expect(store.getActivePreset()?.name).toBe('纯爱日常')

    const state2 = store.save({ activePresetId: 'p2', presets: [preset1, preset2] })
    expect(state2.store.activePresetId).toBe('p2')
    expect(store.getActivePreset()?.name).toBe('硬核克苏鲁')
  })

  it('创作任务使用活跃预设，分析任务使用严格结构化协议', () => {
    const customPreset: NovelPromptPreset = {
      id: 'p-custom',
      name: '创作预设',
      blocks: [
        { id: 'b-sys', name: '文风', role: 'system', content: '【古风仙侠文风】', enabled: true, position: 'relative', depth: 0, order: 1 }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    const store = new PromptSettingsStore()
    store.save({ activePresetId: 'p-custom', presets: [customPreset] })
    const snap = store.snapshot()

    // 创作类任务（如 continue）包含预设内容
    const continueDefs = resolvePromptDefinitions('continue', snap)
    expect(continueDefs.some((d) => d.content?.includes('【古风仙侠文风】'))).toBe(true)

    // 分析类任务（如 knowledge, report）不包含预设内容，包含专属分析协议
    const knowledgeDefs = resolvePromptDefinitions('knowledge', snap)
    expect(knowledgeDefs.some((d) => d.content?.includes('【古风仙侠文风】'))).toBe(false)
    expect(knowledgeDefs.some((d) => d.content === ANALYSIS_PROTOCOLS.knowledge)).toBe(true)

    const reportDefs = resolvePromptDefinitions('report', snap)
    expect(reportDefs.some((d) => d.content?.includes('【古风仙侠文风】'))).toBe(false)
    expect(reportDefs.some((d) => d.content === ANALYSIS_PROTOCOLS.report)).toBe(true)
  })

  it('无预设或全关闭时，创作任务使用安全回退协议', () => {
    const store = new PromptSettingsStore()
    store.save(DEFAULT_PRESET_STORE)
    const snap = store.snapshot()

    const defs = resolvePromptDefinitions('continue', snap)
    expect(defs.some((d) => d.content === FALLBACK_CREATION_PROTOCOLS.continue)).toBe(true)
  })

  it('通用酒馆语法兼容：正确解析变量宏 (setvar/getvar)、注释清理与空 Block 处理', () => {
    const tavernJson = JSON.stringify({
      name: '动态变量测试预设',
      prompts: [
        {
          identifier: 'vars_init',
          name: '初始化',
          content: '{{setvar::style::日系轻小说}}{{// 这里是作者注释，应当被过滤}}{{trim}}',
          role: 'system',
          enabled: true
        },
        {
          identifier: 'override_inactive',
          name: '未启用的覆盖',
          content: '{{setvar::style::严肃文学}}',
          role: 'system',
          enabled: false
        },
        {
          identifier: 'rules_block',
          name: '创作规则',
          content: '文风要求：{{getvar::style}}。{{// 调试提示：注意段落节奏}}',
          role: 'system',
          enabled: true
        },
        {
          identifier: 'agentTask',
          name: 'Agent Task',
          content: '',
          role: 'user',
          enabled: true
        }
      ]
    })

    const parsed = parseTavernPreset(tavernJson)
    expect(parsed.name).toBe('动态变量测试预设')

    // 1. 初始化 Block 提取完 setvar 且过滤注释后，内容变为空字符串，保留但自动置为 disabled
    const initBlock = parsed.blocks.find((b) => b.name === '初始化')
    expect(initBlock).toBeDefined()
    expect(initBlock?.content).toBe('')
    expect(initBlock?.enabled).toBe(false)

    // 2. 创作规则 Block 成功展开变量且过滤了注释
    const rulesBlock = parsed.blocks.find((b) => b.name === '创作规则')
    expect(rulesBlock).toBeDefined()
    expect(rulesBlock?.content).toContain('文风要求：日系轻小说。')
    expect(rulesBlock?.content).not.toContain('{{getvar::style}}')
    expect(rulesBlock?.content).not.toContain('严肃文学') // 未启用的 setvar 不生效
    expect(rulesBlock?.content).not.toContain('调试提示') // 注释被过滤
    expect(rulesBlock?.enabled).toBe(true)

    // 3. agentTask 被精准识别为 marker.task，未重复追加任务插槽
    const taskBlock = parsed.blocks.find((b) => b.marker === 'marker.task')
    expect(taskBlock).toBeDefined()
    expect(taskBlock?.name).toBe('Agent Task')
    const taskBlocksCount = parsed.blocks.filter((b) => b.marker === 'marker.task').length
    expect(taskBlocksCount).toBe(1)
  })

  it('回归验证真实预设：Kemini_Dramatron_v3.1.json 成功展开变量并映射插槽', () => {
    const raw = readFileSync(new URL('./fixtures/tavern-presets/Kemini_Dramatron_v3.1.json', import.meta.url), 'utf8')
    const preset = parseTavernPreset(raw)
    expect(preset.blocks.length).toBeGreaterThanOrEqual(40)

    // 检查核心指令 Block（🎬ROLE AND GUIDE）中变量展开情况
    const guideBlock = preset.blocks.find((b) => b.name === '🎬ROLE AND GUIDE')
    expect(guideBlock).toBeDefined()
    expect(guideBlock?.content).toContain('使用日式视觉小说风格的文字进行创作') // writingstyle 展开
    expect(guideBlock?.content).toContain('避免过度文学化') // rule 展开
    expect(guideBlock?.content).not.toContain('{{getvar::writingstyle}}')
    expect(guideBlock?.content).not.toContain('{{getvar::rule}}')

    // 检查设定 Block（⚙️SETTING）中人称设置展开情况
    const settingBlock = preset.blocks.find((b) => b.name === '⚙️SETTING')
    expect(settingBlock).toBeDefined()
    expect(settingBlock?.content).toContain('忽略<Interaction_history>，必须以**第三人称**创作正文') // rencheng 展开
    expect(settingBlock?.content).not.toContain('{{getvar::rencheng}}')

    // 检查纯变量声明 Block（🔗）保留且置为 disabled
    const linkBlock = preset.blocks.find((b) => b.name === '🔗')
    expect(linkBlock).toBeDefined()
    expect(linkBlock?.content).toBe('')
    expect(linkBlock?.enabled).toBe(false)

    // 检查编译时空 Block 自动跳过，不输出空消息
    const store = new PromptSettingsStore()
    store.save({ activePresetId: preset.id, presets: [preset] })
    const snap = store.snapshot()
    const compiled = compilePromptMessages('continue', {
      instruction: '继续写下一段',
      materials: {
        knowledge: [{ role: 'user', content: '世界观资料' }],
        history: [{ role: 'user', content: '前文正文' }]
      }
    }, snap)

    expect(compiled.length).toBeGreaterThan(0)
    for (const msg of compiled) {
      expect(msg.content.trim().length).toBeGreaterThan(0)
    }
  })
})
