import { describe, expect, it } from 'vitest'
import { parseCreationOutput } from '../src/main/output-parser'
import type { ToolCall } from '../src/main/model-gateway'
import { SOLIUMBRA_TOOL_NAME } from '../src/shared/prompt-settings'

describe('Output Parser - Native Tool Calling Support (Scheme A / soliumbra_reply)', () => {
  it('parses complete soliumbra_reply tool call arguments into ParsedCreationOutput', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call_cat_001',
        type: 'function',
        function: {
          name: SOLIUMBRA_TOOL_NAME,
          arguments: JSON.stringify({
            think_nya: '喵呜，韩立此时需要潜入药园，观察墨大夫的反应喵~',
            game_content: '夜黑如墨，寒风呼啸。\n\n韩立屏息凝神，悄然推开药园的柴扉。泥土与草药的苦涩香气扑面而来。',
            options: [
              '1. 采摘降尘草并立即离开',
              '2. 躲在丹炉后窥视墨大夫动静',
              '3. 留下伪造的脚印转移视线'
            ],
            summary: '韩立夜探药园，面临是否涉险探查墨大夫秘密的抉择。',
            comment: '喵喵~ 主人，这里给韩立加了点紧张的感官描写喵，顺畅吗喵？'
          })
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('夜黑如墨，寒风呼啸。\n\n韩立屏息凝神，悄然推开药园的柴扉。泥土与草药的苦涩香气扑面而来。')
    expect(parsed).not.toHaveProperty('thinking')
    expect(parsed.content).not.toContain('喵呜')
    expect(parsed.content).not.toContain('think_nya')
    expect(parsed.summary).toBe('韩立夜探药园，面临是否涉险探查墨大夫秘密的抉择。')
    expect(parsed.comment).toBe('喵喵~ 主人，这里给韩立加了点紧张的感官描写喵，顺畅吗喵？')
    expect(parsed.plotOptions).toEqual([
      '采摘降尘草并立即离开',
      '躲在丹炉后窥视墨大夫动静',
      '留下伪造的脚印转移视线'
    ])
    expect(parsed.warnings.length).toBe(0)
  })

  it('strips residual XML tags or markdown inside tool call game_content', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call_cat_002',
        type: 'function',
        function: {
          name: SOLIUMBRA_TOOL_NAME,
          arguments: JSON.stringify({
            think_nya: '小猫推演中喵……',
            game_content: '<think_nya>残存思考</think_nya><game>\n晨曦微露，山道泛起薄雾。\n\n韩立踏着青石板拾级而上。\n</game>',
            summary: '清晨上山。',
            options: ['继续前行', '原地驻足']
          })
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('晨曦微露，山道泛起薄雾。\n\n韩立踏着青石板拾级而上。')
    expect(parsed.content).not.toContain('<game>')
    expect(parsed.content).not.toContain('残存思考')
    expect(parsed.summary).toBe('清晨上山。')
    expect(parsed.plotOptions).toEqual(['继续前行', '原地驻足'])
  })

  it('unpacks serialized tool arguments JSON string from rawText without toolCalls parameter', () => {
    // When loaded from SQLite candidate.raw_output where raw text is the serialized arguments JSON
    const rawJson = JSON.stringify({
      think_nya: '思考过程喵喵喵',
      game_content: '一道青色剑光自云海破空而出。',
      summary: '飞剑破云。',
      options: ['【1】御剑乘风', '【2】降落林间'],
      comment: '小猫留言：御剑帅气吧喵！'
    })

    const parsed = parseCreationOutput(rawJson)

    expect(parsed.content).toBe('一道青色剑光自云海破空而出。')
    expect(parsed.summary).toBe('飞剑破云。')
    expect(parsed.comment).toBe('小猫留言：御剑帅气吧喵！')
    expect(parsed.plotOptions).toEqual(['御剑乘风', '降落林间'])
    expect(parsed.rawOutput).toBe(rawJson)
  })

  it('unpacks full tool_call envelope serialized in rawText', () => {
    const rawJson = JSON.stringify({
      name: SOLIUMBRA_TOOL_NAME,
      arguments: JSON.stringify({
        game_content: '残阳如血，照在断壁残垣之上。',
        summary: '黄昏战场。'
      })
    })

    const parsed = parseCreationOutput(rawJson)

    expect(parsed.content).toBe('残阳如血，照在断壁残垣之上。')
    expect(parsed.summary).toBe('黄昏战场。')
  })

  it('parses generic novel_reply tool calling format with content and options', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call_novel_001',
        type: 'function',
        function: {
          name: 'novel_reply',
          arguments: JSON.stringify({
            thinking: '分析剧情矛盾点...',
            content: '窗外雨声淅沥，烛火摇曳。他放下手中的古卷。',
            summary: '深夜秉烛夜读。',
            options: '1. 推门探查异响\n2. 熄灭烛火戒备'
          })
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('窗外雨声淅沥，烛火摇曳。他放下手中的古卷。')
    expect(parsed.summary).toBe('深夜秉烛夜读。')
    expect(parsed.plotOptions).toEqual(['推门探查异响', '熄灭烛火戒备'])
  })

  it('handles empty content gracefully with warning', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call_empty',
        type: 'function',
        function: {
          name: SOLIUMBRA_TOOL_NAME,
          arguments: JSON.stringify({
            think_nya: '思考了半天但没写正文喵',
            game_content: ''
          })
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('')
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.warnings.some((w) => w.includes('未包含可供审阅的小说正文'))).toBe(true)
  })

  it('robustly extracts prose when tool call arguments JSON is truncated at EOF without closing quote', () => {
    // Simulated token context exhaustion cutoff or cancellation mid-sentence
    const truncatedArgs = '{"think_nya": "思考韩立的行踪喵", "game_content": "夜黑如墨，寒风呼啸。\\n\\n韩立屏息凝神，悄然推开药园柴扉。'
    const toolCalls: ToolCall[] = [
      {
        id: 'call_truncated',
        type: 'function',
        function: {
          name: SOLIUMBRA_TOOL_NAME,
          arguments: truncatedArgs
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('夜黑如墨，寒风呼啸。\n\n韩立屏息凝神，悄然推开药园柴扉。')
    expect(parsed.content).not.toContain('think_nya')
    expect(parsed.warnings.length).toBe(0)
  })

  it('unpacks truncated rawText JSON string from DB candidate output into clean prose', () => {
    const truncatedRaw = '{"think_nya": "推演中喵", "game_content": "天边泛起鱼肚白，长风猎猎。林晨御剑而起。'
    const parsed = parseCreationOutput(truncatedRaw)

    expect(parsed.content).toBe('天边泛起鱼肚白，长风猎猎。林晨御剑而起。')
    expect(parsed.content).not.toContain('think_nya')
    expect(parsed.content).not.toContain('{"')
  })

  it('correctly handles options array containing object items', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call_obj_opts',
        type: 'function',
        function: {
          name: SOLIUMBRA_TOOL_NAME,
          arguments: JSON.stringify({
            game_content: '韩立站在岔路口。',
            options: [
              { text: '1. 采摘降尘草并立即离开' },
              { title: '2. 丹炉后潜伏观察' },
              { desc: '3. 留下伪造的脚印' }
            ]
          })
        }
      }
    ]

    const parsed = parseCreationOutput('', toolCalls)

    expect(parsed.content).toBe('韩立站在岔路口。')
    expect(parsed.plotOptions).toEqual([
      '采摘降尘草并立即离开',
      '丹炉后潜伏观察',
      '留下伪造的脚印'
    ])
    expect(parsed.plotOptions?.some((opt) => opt.includes('[object Object]'))).toBe(false)
  })
})
