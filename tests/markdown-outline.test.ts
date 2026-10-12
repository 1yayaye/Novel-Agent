import { describe, expect, it } from 'vitest'
import { extractHeadings } from '../src/renderer/utils/markdownOutline.js'

describe('extractHeadings', () => {
  it('抽出标题并给出可定位的偏移', () => {
    const md = '# 标题一\n正文\n## 标题二\n### 标题三\n'
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '标题一', offset: 0 },
      { level: 2, text: '标题二', offset: 9 },
      { level: 3, text: '标题三', offset: 16 }
    ])
  })

  it('CRLF 文本的偏移同样准确', () => {
    const md = '# 甲\r\n## 乙\r\n'
    const headings = extractHeadings(md)
    expect(headings.map((h) => h.text)).toEqual(['甲', '乙'])
    expect(md.slice(headings[1].offset).startsWith('## 乙')).toBe(true)
  })

  it('忽略非标题行与过深的 # 号', () => {
    const md = '####### 七个井号不是标题\n#没有空格\n正文 # 中间井号'
    expect(extractHeadings(md)).toEqual([])
  })
})
