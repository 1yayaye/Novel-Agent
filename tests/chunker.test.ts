import { describe, expect, it } from 'vitest'
import { splitIntoChunks } from '../src/main/chunker'

describe('splitIntoChunks', () => {
  it('returns empty array for empty string', () => {
    expect(splitIntoChunks('')).toEqual([])
  })

  it('returns single chunk for short text', () => {
    const text = '这是第一段短文本。\n这是第二行。'
    const chunks = splitIntoChunks(text, 1000)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].startOffset).toBe(0)
    expect(chunks[0].endOffset).toBe(text.length)
    expect(chunks[0].content).toBe(text)
    expect(chunks[0].contentHash).toBeDefined()
  })

  it('aggregates multiple short paragraphs up to target size', () => {
    const p1 = '段落一：天地不仁，以万物为刍狗。'.repeat(10) + '\n\n'
    const p2 = '段落二：道可道，非常道；名可名，非常名。'.repeat(10) + '\n\n'
    const p3 = '段落三：上善若水，水善利万物而不争。'.repeat(10)
    const content = p1 + p2 + p3

    const chunks = splitIntoChunks(content, 400)
    expect(chunks.length).toBeGreaterThan(1)

    // Check invariants
    for (const chunk of chunks) {
      expect(content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content)
      expect(chunk.content.length).toBeGreaterThan(0)
    }
  })

  it('splits long paragraph by punctuation', () => {
    const sentence = '青云门屹立于神州浩土数千年，乃是正道领袖。'
    const longParagraph = sentence.repeat(50) // ~1100 chars
    const chunks = splitIntoChunks(longParagraph, 300)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(longParagraph.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content)
    }
    const reconstructed = chunks.map((c) => c.content).join('')
    expect(reconstructed).toBe(longParagraph)
  })

  it('safely splits long uninterrupted text without breaking surrogate pairs', () => {
    // Emoji character 🌟 is 2 UTF-16 code units (\uD83C\uDF1F)
    const emoji = '🌟'
    const longNoPunctuation = emoji.repeat(200) // 400 UTF-16 code units
    const chunks = splitIntoChunks(longNoPunctuation, 50)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(longNoPunctuation.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content)
      // Check no lone surrogates at edges
      expect(chunk.content.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00) // not low surrogate at start
      expect(chunk.content.charCodeAt(chunk.content.length - 1)).not.toBeLessThanOrEqual(0xdbff) // not high surrogate at end
    }
    const reconstructed = chunks.map((c) => c.content).join('')
    expect(reconstructed).toBe(longNoPunctuation)
  })
})
