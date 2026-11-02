import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseTavernPreset } from '../src/main/tavern-importer'
import { compilePromptMessages } from '../src/main/prompt-runtime'
import { PromptSettingsStore } from '../src/main/prompt-store'
import type { NovelPromptPreset } from '../src/shared/prompt-settings'

describe('验收测试：酒馆预设保真导入与装配（消除强制纠偏、全面遵循原生编排）', () => {
  // ---------------------------------------------------------------------------
  // 测试用例 1：用户上传的酒馆默认预设（Default SillyTavern Preset）结构还原度与 Post-History 验收
  // ---------------------------------------------------------------------------
  describe('用例 1：酒馆默认预设 12 项标准拓扑还原度与 Post-History 验收', () => {
    it('导入后 preset.blocks 严格保持 12 项，绝不追加任何虚构末尾插槽，且 Post-History 排在历史之后', () => {
      // 构造包含用户截图标准 12 项的 SillyTavern 预设
      const defaultSillyTavernPreset = {
        name: 'Default SillyTavern Preset',
        prompts: [
          { identifier: 'main', name: 'Main Prompt', role: 'system', content: '【系统主提示词：你是一名长篇玄幻修仙小说叙述者】', enabled: true },
          { identifier: 'worldInfoBefore', name: 'World Info (before)', role: 'system', content: '', enabled: true },
          { identifier: 'personaDescription', name: 'Persona Description', role: 'system', content: '【作者设定：严谨逻辑与慢热布局】', enabled: true },
          { identifier: 'charDescription', name: 'Char Description', role: 'system', content: '【主角设定：韩立，心思缜密，行事低调】', enabled: true },
          { identifier: 'charPersonality', name: 'Char Personality', role: 'system', content: '【性格基调：果决冷酷，保留底线】', enabled: true },
          { identifier: 'scenario', name: 'Scenario', role: 'system', content: '【当前情境：神手谷夜雨，墨大夫暗藏杀机】', enabled: true },
          { identifier: 'enhanceDefinitions', name: 'Enhance Definitions', role: 'system', content: '【修仙境界定义：练气期九层细节】', enabled: true },
          { identifier: 'nsfwPrompt', name: 'NSFW Prompt', role: 'system', content: '【内容审查与安全基准】', enabled: false },
          { identifier: 'worldInfoAfter', name: 'World Info (after)', role: 'system', content: '', enabled: true },
          { identifier: 'dialogueExamples', name: 'Chat Examples', role: 'system', content: '【对话范例：文风古朴凝练】', enabled: true },
          { identifier: 'chatHistory', name: 'Chat History', role: 'user', content: '', enabled: true },
          { identifier: 'postHistoryInstructions', name: 'Post-History Instructions', role: 'system', content: '【Post-History 强约束指令：必须以第三人称展开，着重描写墨大夫手中青铜短剑的微颤】', enabled: true }
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'main', enabled: true },
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'charPersonality', enabled: true },
              { identifier: 'scenario', enabled: true },
              { identifier: 'enhanceDefinitions', enabled: true },
              { identifier: 'nsfwPrompt', enabled: false },
              { identifier: 'worldInfoAfter', enabled: true },
              { identifier: 'dialogueExamples', enabled: true },
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'postHistoryInstructions', enabled: true }
            ]
          }
        ]
      }

      const preset = parseTavernPreset(JSON.stringify(defaultSillyTavernPreset))

      // 验证点 1：导入后 blocks 数量严格等于 12 项，绝不追加任何虚构末尾插槽
      expect(preset.blocks).toHaveLength(12)
      expect(preset.blocks.some((b) => b.name === '设定库资料插槽')).toBe(false)
      expect(preset.blocks.some((b) => b.name === '会话与正文历史插槽')).toBe(false)
      expect(preset.blocks.some((b) => b.name === '作者任务与指令插槽')).toBe(false)

      // 验证顺序拓扑严格对齐
      const blockNames = preset.blocks.map((b) => b.name)
      expect(blockNames).toEqual([
        'Main Prompt',
        'World Info (before)',
        'Persona Description',
        'Char Description',
        'Char Personality',
        'Scenario',
        'Enhance Definitions',
        'NSFW Prompt',
        'World Info (after)',
        'Chat Examples',
        'Chat History',
        'Post-History Instructions'
      ])

      // 验证装配编译：传入章节历史与写作任务指令
      const store = new PromptSettingsStore()
      store.save({ activePresetId: preset.id, presets: [preset] })
      const snapshot = store.snapshot()

      const compiledMessages = compilePromptMessages('continue', {
        instruction: '请详细描写韩立推门而入的动作与心理试探',
        materials: {
          knowledge: [{ role: 'user', content: '【设定库资料】墨大夫擅长炼制定颜丹与黄龙丹' }],
          history: [
            { role: 'user', content: '上一章：韩立站在神手谷竹楼外，雨势渐大。' },
            { role: 'assistant', content: '竹楼内透出昏黄的油灯光亮，隐约有药香弥漫。' }
          ]
        }
      }, snapshot)

      const contents = compiledMessages.map((m) => m.content)

      // 验证点 2：Post-History Instructions 必须严格位于所有历史对话消息之后
      const history1Idx = contents.indexOf('上一章：韩立站在神手谷竹楼外，雨势渐大。')
      const history2Idx = contents.indexOf('竹楼内透出昏黄的油灯光亮，隐约有药香弥漫。')
      const postHistIdx = contents.findIndex((c) => c.includes('Post-History 强约束指令'))
      const taskIdx = contents.findIndex((c) => c.includes('请详细描写韩立推门而入的动作与心理试探'))

      expect(history1Idx).toBeGreaterThan(0)
      expect(history2Idx).toBeGreaterThan(history1Idx)
      expect(postHistIdx).toBeGreaterThan(history2Idx)
      expect(taskIdx).toBeGreaterThan(postHistIdx)
    })
  })

  // ---------------------------------------------------------------------------
  // 测试用例 2：下载目录与测试目录四大真实预设的导入与拓扑保真验收
  // ---------------------------------------------------------------------------
  describe('用例 2：下载目录四大真实预设的导入与拓扑保真验收', () => {
    const fixtureDir = join(__dirname, 'fixtures/tavern-presets')
    const downloadsDir = join(homedir(), 'Downloads')
    const presetFiles = [
      '[主预设] V19.7.3 狐神抚 · 毓忻.json',
      '智脑-Z（10.1）-2.json',
      'Izumi 1002.json',
      'Kemini_Dramatron_v3.1.json'
    ]

    for (const fileName of presetFiles) {
      it(`真实预设 ${fileName}：零擅自注入虚构插槽，源块数 100% 拓扑还原`, () => {
        const filePath = existsSync(join(downloadsDir, fileName))
          ? join(downloadsDir, fileName)
          : join(fixtureDir, fileName)

        const raw = readFileSync(filePath, 'utf8')
        const sourceJson = JSON.parse(raw)
        const preset = parseTavernPreset(raw, fileName.replace(/\.json$/, ''))

        // 验证点 1：严格保真，源 prompt 数量与转换后 block 数量一致
        expect(preset.blocks).toHaveLength(sourceJson.prompts.length)

        // 验证点 2：绝不擅自注入虚假插槽
        expect(preset.blocks.some((b) => b.name === '设定库资料插槽')).toBe(false)
        expect(preset.blocks.some((b) => b.name === '会话与正文历史插槽')).toBe(false)
        expect(preset.blocks.some((b) => b.name === '作者任务与指令插槽')).toBe(false)
      })
    }

    it('重点验证 Kemini_Dramatron_v3.1.json：Agent Task (order 34) 严格排在 Chat History (order 35) 之前，绝不被截断挪至末尾', () => {
      const filePath = existsSync(join(downloadsDir, 'Kemini_Dramatron_v3.1.json'))
        ? join(downloadsDir, 'Kemini_Dramatron_v3.1.json')
        : join(fixtureDir, 'Kemini_Dramatron_v3.1.json')

      const raw = readFileSync(filePath, 'utf8')
      const preset = parseTavernPreset(raw)

      const taskBlock = preset.blocks.find((b) => b.marker === 'marker.task')
      const historyBlock = preset.blocks.find((b) => b.marker === 'marker.history')

      expect(taskBlock).toBeDefined()
      expect(historyBlock).toBeDefined()
      // 验证原生 order 保真：Task 在 History 之前
      expect(taskBlock!.order).toBeLessThan(historyBlock!.order)

      // 验证装配编译：Task 消息严格出现在 History 消息之前
      const store = new PromptSettingsStore()
      store.save({ activePresetId: preset.id, presets: [preset] })
      const snapshot = store.snapshot()

      const compiled = compilePromptMessages('continue', {
        instruction: '执行 Kemini 编排续写',
        materials: {
          history: [{ role: 'user', content: '【Kemini 前情提要历史】' }]
        }
      }, snapshot)

      const contents = compiled.map((m) => m.content)
      const taskMsgIdx = contents.findIndex((c) => c.includes('执行 Kemini 编排续写'))
      const histMsgIdx = contents.indexOf('【Kemini 前情提要历史】')

      expect(taskMsgIdx).toBeGreaterThan(0)
      expect(histMsgIdx).toBeGreaterThan(taskMsgIdx)
    })

    it('重点验证 智脑-Z（10.1）-2.json：【本轮 作者 的输入】与尾部规则严格位于历史之后', () => {
      const filePath = existsSync(join(downloadsDir, '智脑-Z（10.1）-2.json'))
        ? join(downloadsDir, '智脑-Z（10.1）-2.json')
        : join(fixtureDir, '智脑-Z（10.1）-2.json')

      const raw = readFileSync(filePath, 'utf8')
      const preset = parseTavernPreset(raw)

      const historyBlock = preset.blocks.find((b) => b.name.includes('聊天记录'))
      const inputEmphasisBlock = preset.blocks.find((b) => b.name.includes('输入强调（收尾）'))

      expect(historyBlock).toBeDefined()
      expect(inputEmphasisBlock).toBeDefined()
      // 原生排序：输入强调（收尾）排在历史之后
      expect(inputEmphasisBlock!.order).toBeGreaterThan(historyBlock!.order)

      // 验证装配编译：【本轮 作者 的输入】严格在历史正文之后输出
      const store = new PromptSettingsStore()
      store.save({ activePresetId: preset.id, presets: [preset] })
      const snapshot = store.snapshot()

      const compiled = compilePromptMessages('continue', {
        instruction: '作者本次输入任务',
        materials: {
          history: [{ role: 'user', content: '【智脑前情提要历史记录】' }]
        }
      }, snapshot)

      const contents = compiled.map((m) => m.content)
      const histMsgIdx = contents.indexOf('【智脑前情提要历史记录】')
      const inputEmphasisMsgIdx = contents.findIndex((c) => c.includes('【本轮 作者 的输入】'))

      expect(histMsgIdx).toBeGreaterThan(0)
      expect(inputEmphasisMsgIdx).toBeGreaterThan(histMsgIdx)
    })
  })

  // ---------------------------------------------------------------------------
  // 测试用例 3：In-Chat 穿插与 Depth 深度不被抹平验收
  // ---------------------------------------------------------------------------
  describe('用例 3：In-Chat 穿插与 Depth 深度不被抹平验收', () => {
    it('验证导入与装配时，position 不被篡改成 relative，depth 不被篡改成 0，且精准插在倒数第 2 轮与倒数第 4 轮', () => {
      const inChatPresetJson = JSON.stringify({
        name: 'In-Chat 深度保真预设',
        prompts: [
          {
            identifier: 'sys_core',
            name: 'Core System',
            role: 'system',
            content: '【系统核心说明】',
            injection_position: 'relative',
            injection_order: 0,
            enabled: true
          },
          {
            identifier: 'chatHistory',
            name: 'Chat History',
            role: 'user',
            content: '',
            injection_position: 'relative',
            injection_order: 10,
            enabled: true
          },
          {
            identifier: 'depth_4_prompt',
            name: 'Depth 4 Anchor',
            role: 'system',
            content: '【深度4穿插提示：回忆昔日恩怨】',
            injection_position: 'in_chat',
            injection_depth: 4,
            injection_order: 20,
            enabled: true
          },
          {
            identifier: 'depth_2_prompt',
            name: 'Depth 2 Anchor',
            role: 'system',
            content: '【深度2穿插提示：注意对手微表情】',
            injection_position: 'in_chat',
            injection_depth: 2,
            injection_order: 30,
            enabled: true
          },
          {
            identifier: 'agentTask',
            name: 'Agent Task',
            role: 'user',
            content: '',
            injection_position: 'relative',
            injection_order: 40,
            enabled: true
          }
        ]
      })

      const preset = parseTavernPreset(inChatPresetJson)

      const d4Block = preset.blocks.find((b) => b.name === 'Depth 4 Anchor')
      const d2Block = preset.blocks.find((b) => b.name === 'Depth 2 Anchor')

      expect(d4Block).toBeDefined()
      expect(d2Block).toBeDefined()

      // 验证点 1：导入时 position 绝不被篡改为 relative，depth 绝不被篡改为 0
      expect(d4Block!.position).toBe('in_chat')
      expect(d4Block!.depth).toBe(4)
      expect(d2Block!.position).toBe('in_chat')
      expect(d2Block!.depth).toBe(2)

      // 验证装配编译：构造 6 条历史对话
      const store = new PromptSettingsStore()
      store.save({ activePresetId: preset.id, presets: [preset] })
      const snapshot = store.snapshot()

      const historyMessages = [
        { role: 'user' as const, content: '历史对话第0条（最久远）' },
        { role: 'assistant' as const, content: '历史对话第1条' },
        { role: 'user' as const, content: '历史对话第2条（倒数第4条）' },
        { role: 'assistant' as const, content: '历史对话第3条（倒数第3条）' },
        { role: 'user' as const, content: '历史对话第4条（倒数第2条）' },
        { role: 'assistant' as const, content: '历史对话第5条（倒数第1条）' }
      ]

      const compiled = compilePromptMessages('continue', {
        instruction: '执行本轮动作',
        materials: {
          history: historyMessages
        }
      }, snapshot)

      const contents = compiled.map((m) => m.content)

      const d4Idx = contents.indexOf('【深度4穿插提示：回忆昔日恩怨】')
      const d2Idx = contents.indexOf('【深度2穿插提示：注意对手微表情】')
      const h0Idx = contents.indexOf('历史对话第0条（最久远）')
      const h1Idx = contents.indexOf('历史对话第1条')
      const h2Idx = contents.indexOf('历史对话第2条（倒数第4条）')
      const h3Idx = contents.indexOf('历史对话第3条（倒数第3条）')
      const h4Idx = contents.indexOf('历史对话第4条（倒数第2条）')
      const h5Idx = contents.indexOf('历史对话第5条（倒数第1条）')

      // 验证点 2：深度 4 精准插入在倒数第 4 条（h2）之前，即 h1 之后、h2 之前
      expect(d4Idx).toBeGreaterThan(h1Idx)
      expect(d4Idx).toBeLessThan(h2Idx)
      expect(contents[d4Idx + 1]).toBe('历史对话第2条（倒数第4条）')

      // 验证点 3：深度 2 精准插入在倒数第 2 条（h4）之前，即 h3 之后、h4 之前
      expect(d2Idx).toBeGreaterThan(h3Idx)
      expect(d2Idx).toBeLessThan(h4Idx)
      expect(contents[d2Idx + 1]).toBe('历史对话第4条（倒数第2条）')

      // 验证后续对话保持完整
      expect(h5Idx).toBeGreaterThan(h4Idx)
    })
  })
})
