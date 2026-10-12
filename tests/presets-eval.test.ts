import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { extractPromptOrderMap, parseTavernPreset } from '../src/main/tavern-importer'
import { ANALYSIS_TASKS, compilePromptMessages } from '../src/main/prompt-runtime'
import { TASK_PROTOCOLS } from '../src/main/prompt-preset'
import { PromptSettingsStore } from '../src/main/prompt-store'
import { NovelPromptPresetSchema } from '../src/shared/prompt-settings'

const fixtures = fileURLToPath(new URL('./fixtures/tavern-presets/', import.meta.url))
const output = fileURLToPath(new URL('../test-results/tavern-import/', import.meta.url))
const cases = [
  { file: 'Izumi 1002.json', sourceBlocks: 231, enabledBlocks: 28, scripts: 1, promptRegexes: 9 },
  { file: '[主预设] V19.7.3 狐神抚 · 毓忻.json', sourceBlocks: 220, enabledBlocks: 16, scripts: 2, promptRegexes: 6 },
  { file: '智脑-Z（10.1）-2.json', sourceBlocks: 92, enabledBlocks: 53, scripts: 0, promptRegexes: 3 },
  { file: 'Kemini_Dramatron_v3.1.json', sourceBlocks: 55, enabledBlocks: 18, scripts: 1, promptRegexes: 5 }
].map((sample) => {
  const content = readFileSync(join(fixtures, sample.file), 'utf8')
  const source = JSON.parse(content)
  const order = extractPromptOrderMap(source.prompt_order)
  const enabledText = source.prompts
    .filter((prompt: { identifier: string; enabled?: boolean }) => order.get(prompt.identifier)?.enabled ?? prompt.enabled ?? true)
    .map((prompt: { content?: string }) => prompt.content ?? '').join('\n') as string
  const declaredVariables = new Set([...enabledText.matchAll(/\{\{\s*(?:setvar|setglobalvar)::([^:]+)::/gi)].map((match) => match[1].trim()))
  const unresolvedVariables = [...new Set([...enabledText.matchAll(/\{\{\s*(?:getvar|getglobalvar)::([^}]+)\}\}/gi)]
    .map((match) => match[1].trim()).filter((key) => !declaredVariables.has(key)))].sort()
  const dependencies = {
    tavernHelperVariableMacros: [...new Set((source.prompts.map((prompt: { content?: string }) => prompt.content ?? '').join('\n') as string)
      .match(/\{\{\s*(?:get|format)_(?:message|chat|character|preset|global)_variable(?:_quoted)?::[^}]*\}\}/gi) ?? [])],
    enabledScripts: (source.extensions?.tavern_helper?.scripts ?? [])
      .filter((script: { enabled: boolean }) => script.enabled)
      .map((script: { name: string; content: string }) => ({
        name: script.name,
        promptHookReferenced: /CHAT_COMPLETION_PROMPT_READY|chat_completion_prompt_ready/.test(script.content),
        customMacroRegistrationReferenced: /registerMacroLike|registerMacro/.test(script.content)
      })),
    enabledPromptRegexes: (source.extensions?.regex_scripts ?? [])
      .filter((regex: { disabled: boolean; promptOnly: boolean }) => !regex.disabled && regex.promptOnly)
      .map((regex: { scriptName: string }) => regex.scriptName),
    unresolvedVariables,
    compatibility: 'static-prompts-only',
    warnings: ['仅评估静态提示词转换；未执行酒馆助手脚本、正则处理或酒馆运行时。',
      ...(unresolvedVariables.length ? ['当前导入器将无启用声明的 getvar 引用替换为空；不能据此认定原预设缺少这些变量。'] : [])]
  }
  return { ...sample, source, dependencies, preset: parseTavernPreset(content, sample.file.replace(/\.json$/, '')) }
})

const input = {
  instruction: '描写韩立雨夜初见墨大夫，心理试探。',
  targetLength: 2000,
  creativity: 'medium' as const,
  materials: {
    knowledge: [{ role: 'user' as const, content: '【设定资料】墨大夫：神手谷名医，暗藏灵根夺舍图谋。' }],
    history: [{ role: 'user' as const, content: '上一章：韩立初入七玄门。' }],
    outlines: [{ role: 'user' as const, content: '本章大纲：神手谷草药初试。' }]
  }
}

describe('四个真实酒馆预设的静态导入转换评估', () => {
  afterAll(() => {
    const store = new PromptSettingsStore(output)
    store.save({ activePresetId: null, presets: cases.map(({ preset }) => preset) })
  })

  it.each(cases)('$file：解析、持久化及编译', ({ file, sourceBlocks, enabledBlocks, source, dependencies, preset }) => {
    const enabled = preset.blocks.filter((block) => block.enabled)
    const store = new PromptSettingsStore()
    store.save({ activePresetId: preset.id, presets: [preset] })
    const snapshot = store.snapshot()
    const compiled = compilePromptMessages('continue', input, snapshot)
    const literalPlaceholders = [...new Set(enabled.flatMap((block) => block.content.match(/\{\{[^}]+\}\}/g) ?? []))]
    const report = {
      file,
      sourceBlocks: source.prompts.length,
      convertedBlocks: preset.blocks.length,
      enabledBlocks: enabled.length,
      enabledContentChars: enabled.reduce((sum, block) => sum + block.content.length, 0),
      compiledMessages: compiled.length,
      compiledChars: compiled.reduce((sum, message) => sum + message.content.length, 0),
      markers: preset.blocks.filter((block) => block.marker).map(({ name, marker, enabled }) => ({ name, marker, enabled })),
      literalPlaceholders,
      extensionKeys: Object.keys(source.extensions ?? {}),
      dependencies
    }
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, `${file}.converted.json`), JSON.stringify(preset, null, 2), 'utf8')
    writeFileSync(join(output, `${file}.messages.json`), JSON.stringify(compiled, null, 2), 'utf8')
    writeFileSync(join(output, `${file}.report.json`), JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify(report))

    expect(NovelPromptPresetSchema.parse(preset)).toEqual(preset)
    expect(preset.name).toBe(source.name || file.replace(/\.json$/, ''))
    expect(source.prompts).toHaveLength(sourceBlocks)
    expect(preset.blocks).toHaveLength(sourceBlocks + (source.prompts.some((prompt: { identifier: string }) => prompt.identifier === 'agentTask') ? 0 : 1))
    expect(enabled).toHaveLength(enabledBlocks)
    expect(new Set(preset.blocks.map((block) => block.id)).size).toBe(preset.blocks.length)
    expect(preset.blocks.map((block) => block.order)).toEqual(preset.blocks.map((_, index) => index))
    for (const marker of ['marker.knowledge', 'marker.history', 'marker.task']) {
      expect(enabled.some((block) => block.marker === marker)).toBe(true)
    }
    // Kemini 的中文双花括号是输出格式示例，不是酒馆可执行宏。
    expect(literalPlaceholders).toEqual(file === 'Kemini_Dramatron_v3.1.json'
      ? ['{{思考内容}}', '{{正文内容}}', '{{可能要求的附加内容}}']
      : [])

    for (const task of ['continue', 'direction', 'chapter_outline', 'content'] as const) {
      const messages = compilePromptMessages(task, input, snapshot)
      expect(messages.some((message) => message.content === TASK_PROTOCOLS[task])).toBe(true)
      expect(messages.every((message) => message.content.trim().length > 0)).toBe(true)
      for (const material of Object.values(input.materials).flat()) {
        expect(messages.filter((message) => message.content === material.content)).toEqual([material])
      }
      expect(messages.filter((message) => message.content.includes('【本次作者任务】'))).toHaveLength(1)
      expect(messages.some((message) => message.content.includes(input.instruction))).toBe(true)
    }

    const emptySnapshot = new PromptSettingsStore().snapshot()
    for (const task of ANALYSIS_TASKS) {
      expect(compilePromptMessages(task, input, snapshot)).toEqual(compilePromptMessages(task, input, emptySnapshot))
    }
  })

  it.each(cases)('$file：记录插件依赖，静态编译通过不代表完整兼容', ({ file, dependencies, scripts, promptRegexes }) => {
    expect(dependencies.compatibility).toBe('static-prompts-only')
    expect(dependencies.tavernHelperVariableMacros).toEqual([])
    expect(dependencies.enabledScripts).toHaveLength(scripts)
    expect(dependencies.enabledPromptRegexes).toHaveLength(promptRegexes)
    expect(dependencies.enabledScripts.some((script: { promptHookReferenced: boolean }) => script.promptHookReferenced)).toBe(scripts > 0)
    expect(dependencies.unresolvedVariables).toEqual(file.startsWith('[主预设]')
      ? ['extra', 'hugou', 'huying', 'kill1', 'quuserzhongxin'] : [])
  })

  it('四个预设可一起保存、重启后读取并切换活跃预设', () => {
    const dataPath = join(output, 'store')
    const presets = cases.map(({ preset }) => preset)
    const store = new PromptSettingsStore(dataPath)
    store.save({ activePresetId: presets[0].id, presets })
    const reopened = new PromptSettingsStore(dataPath)
    expect(reopened.get().store).toEqual({ activePresetId: presets[0].id, presets })
    for (const preset of presets) {
      reopened.save({ activePresetId: preset.id, presets })
      const snapshot = new PromptSettingsStore(dataPath).snapshot()
      expect(snapshot.activePreset).toEqual(preset)
      store.save({ activePresetId: preset.id, presets })
      expect(compilePromptMessages('continue', input, snapshot)).toEqual(compilePromptMessages('continue', input, store.snapshot()))
    }
  })
})
