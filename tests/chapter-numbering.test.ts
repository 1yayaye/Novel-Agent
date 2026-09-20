import { describe, expect, it } from 'vitest'
import { getChapterNumber } from '../src/renderer/utils/chapter-numbering'

describe('chapter numbering', () => {
  it('does not count leading front matter', () => {
    const chapters = [{ title: '正文' }, { title: '第一章 初露端倪' }, { title: '第二章 继续' }]
    expect(chapters.map((_, index) => getChapterNumber(chapters, index))).toEqual([undefined, 1, 2])
  })

  it('keeps legacy numbering when no formal chapter title exists', () => {
    const chapters = [{ title: '开篇' }, { title: '内容' }]
    expect(chapters.map((_, index) => getChapterNumber(chapters, index))).toEqual([1, 2])
  })
})
