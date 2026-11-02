import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTavernPreset } from '../src/main/tavern-importer'
import { resolvePresetTools, SOLIUMBRA_REPLY_TOOL } from '../src/main/prompt-preset'
import type { NovelPromptPreset } from '../src/shared/prompt-settings'
import { SOLIUMBRA_TOOL_NAME } from '../src/shared/prompt-settings'

describe('Tavern Preset Tool Calling Recognition', () => {
  it('automatically recognizes toolCalling for Meowssiah 1.9.12 preset file', () => {
    const raw = readFileSync(new URL('./fixtures/tavern-presets/Meowssiah_1.9.12.json', import.meta.url), 'utf8')
    const preset = parseTavernPreset(raw, 'Meowssiah 1.9.12')

    expect(preset.toolCalling).toBeDefined()
    expect(preset.toolCalling?.enabled).toBe(true)
    expect(preset.toolCalling?.name).toBe(SOLIUMBRA_TOOL_NAME)

    // 工具 schema 来自预设声明（ToolBindings form + registerPart 宏），而非硬编码工具
    expect(preset.toolCalling?.description).toBe('SoliUmbra replies ALL the things with this tool.')
    const params = preset.toolCalling?.parameters as {
      type: string
      properties: Record<string, { type: string; description?: string }>
      required?: string[]
    }
    expect(params.type).toBe('object')
    expect(Object.keys(params.properties)).toEqual(
      expect.arrayContaining(['think_nya', 'game_content', 'summary', 'comment', 'options', 'extra'])
    )
    expect(params.properties.think_nya).toMatchObject({ type: 'string', description: '小猫之神在<think_nya>中的详细软萌思考。' })
    expect(params.properties.game_content).toMatchObject({ type: 'string', description: '<game></game>内的完整互动小说剧情正文。' })
    // registerPart 部件不进 required，仅保留声明式 required
    expect(params.required).toEqual(['think_nya'])

    const resolved = resolvePresetTools(preset)
    expect(resolved).toBeDefined()
    expect(resolved?.tools).toHaveLength(1)
    expect(resolved?.tools[0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(resolved?.tools[0].function.parameters).toEqual(preset.toolCalling?.parameters)
    expect(resolved?.toolChoice).toEqual({ type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } })
  })

  it('builds tool parameters from registerPart macros when ToolBindings is absent', () => {
    const raw = JSON.stringify({
      name: '宏部件预设',
      prompts: [
        { identifier: 'p1', name: '正文部件', role: 'system', enabled: true, content: '<<<|catgodml|registerPart:game_content:完整小说正文>>>' },
        { identifier: 'p2', name: '摘要部件', role: 'system', enabled: true, content: '<<<|catgodml|registerPart:summary:剧情总结>>>' },
        { identifier: 'p3', name: '禁用部件', role: 'system', enabled: false, content: '<<<|catgodml|registerPart:ignored:不该被收集>>>' }
      ]
    })
    const preset = parseTavernPreset(raw, '宏部件预设')

    expect(preset.toolCalling?.enabled).toBe(true)
    expect(preset.toolCalling?.name).toBe(SOLIUMBRA_TOOL_NAME)
    const params = preset.toolCalling?.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(params.properties)).toEqual(expect.arrayContaining(['game_content', 'summary']))
    expect(Object.keys(params.properties)).toHaveLength(2)
    expect(params.properties.summary).toEqual({ type: 'string', description: '剧情总结' })
    expect(params.required).toBeUndefined()

    const resolved = resolvePresetTools(preset)
    expect(resolved?.tools[0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(resolved?.tools[0].function.parameters).toEqual(preset.toolCalling?.parameters)
  })

  it('prefers preset.toolCalling.parameters over the hardcoded soliumbra tool', () => {
    const generated: NovelPromptPreset = {
      id: 'generated-1',
      name: 'Meowssiah (imported)',
      blocks: [],
      toolCalling: {
        enabled: true,
        name: SOLIUMBRA_TOOL_NAME,
        parameters: {
          type: 'object',
          properties: {
            game_content: { type: 'string', description: '正文' }
          }
        }
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const resolved = resolvePresetTools(generated)
    expect(resolved?.tools[0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(resolved?.tools[0].function.parameters).toEqual(generated.toolCalling?.parameters)
    // 未声明 description 时回退到内置文案
    expect(resolved?.tools[0].function.description).toBe(SOLIUMBRA_REPLY_TOOL.function.description)
  })

  it('resolves custom tool definitions from explicit preset.toolCalling', () => {
    const customPreset: NovelPromptPreset = {
      id: 'custom-preset-1',
      name: 'Custom Writer',
      blocks: [],
      toolCalling: {
        enabled: true,
        name: 'custom_chapter_writer',
        description: '自定义章节写入工具',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string' }
          },
          required: ['content']
        }
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const resolved = resolvePresetTools(customPreset)
    expect(resolved).toBeDefined()
    expect(resolved?.tools[0].function.name).toBe('custom_chapter_writer')
    expect(resolved?.tools[0].function.description).toBe('自定义章节写入工具')
    expect(resolved?.toolChoice).toEqual({ type: 'function', function: { name: 'custom_chapter_writer' } })
  })

  it('returns undefined for standard non-tool presets', () => {
    const regularPreset: NovelPromptPreset = {
      id: 'regular-preset-1',
      name: '纯文本预设',
      blocks: [
        {
          id: 'b1',
          name: '系统要求',
          role: 'system',
          content: '请写正文',
          enabled: true,
          position: 'relative',
          depth: 0,
          order: 0
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const resolved = resolvePresetTools(regularPreset)
    expect(resolved).toBeUndefined()
  })
})
