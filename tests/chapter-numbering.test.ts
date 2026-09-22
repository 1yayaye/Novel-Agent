import { describe, expect, it } from 'vitest'
import { getChapterNumber, getFirstChapterIndex } from '../src/renderer/utils/chapter-numbering'

describe('chapter numbering', () => {
  it('does not count leading front matter', () => {
    const chapters = [{ title: '正文' }, { title: '第一章 初露端倪' }, { title: '第二章 继续' }]
    expect(chapters.map((_, index) => getChapterNumber(chapters, index))).toEqual([undefined, 1, 2])
  })

  it('keeps legacy numbering when no formal chapter title exists', () => {
    const chapters = [{ title: '开篇' }, { title: '内容' }]
    expect(chapters.map((_, index) => getChapterNumber(chapters, index))).toEqual([1, 2])
  })

  it('correctly returns getFirstChapterIndex and supports precalculated index', () => {
    const chapters = [{ title: '序言' }, { title: '楔子' }, { title: '第1章 惊变' }, { title: '第2章 启程' }]
    const firstIdx = getFirstChapterIndex(chapters)
    expect(firstIdx).toBe(2)
    expect(getChapterNumber(chapters, 0, firstIdx)).toBeUndefined()
    expect(getChapterNumber(chapters, 1, firstIdx)).toBeUndefined()
    expect(getChapterNumber(chapters, 2, firstIdx)).toBe(1)
    expect(getChapterNumber(chapters, 3, firstIdx)).toBe(2)
  })
})

