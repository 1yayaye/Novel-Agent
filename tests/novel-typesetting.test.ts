import { describe, expect, it } from 'vitest'
import {
  formatNovelParagraphs,
  cleanRedundantBlankLines,
  normalizeChinesePunctuation,
  wrapWithPunctuation
} from '../src/renderer/components/editor/novel-typesetting'

describe('Novel Typesetting Utilities', () => {
  it('formatNovelParagraphs indents Chinese paragraphs with 2 full-width spaces and cleans whitespace', () => {
    const raw = `盛夏的夜晚，空气湿润而闷热。
我在自家豪宅，母亲的卧室门前。

  母亲卧室的房间并没有关严。`

    const formatted = formatNovelParagraphs(raw)
    expect(formatted).toBe(
      `　　盛夏的夜晚，空气湿润而闷热。\n　　我在自家豪宅，母亲的卧室门前。\n\n　　母亲卧室的房间并没有关严。`
    )
  })

  it('cleanRedundantBlankLines collapses multiple blank lines into standard single line breaks', () => {
    const messy = `第一段\n\n\n\n\n第二段\n\n\n第三段`
    const cleaned = cleanRedundantBlankLines(messy)
    expect(cleaned).toBe(`第一段\n\n第二段\n\n第三段`)
  })

  it('normalizeChinesePunctuation converts half-width English marks to Chinese novel punctuation', () => {
    const mixed = `她说: "你好, 真的吗? 太棒了! (笑)"`
    const normalized = normalizeChinesePunctuation(mixed)
    expect(normalized).toBe(`她说： “你好， 真的吗？ 太棒了！ （笑）”`)
  })

  it('wrapWithPunctuation wraps selected text in target quotes or punctuation', () => {
    const text = '剑来'
    expect(wrapWithPunctuation(text, '《', '》')).toBe('《剑来》')
    expect(wrapWithPunctuation(text, '“', '”')).toBe('“剑来”')
    expect(wrapWithPunctuation(text, '「', '」')).toBe('「剑来」')
  })
})
