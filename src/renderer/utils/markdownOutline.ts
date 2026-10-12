export type HeadingItem = {
  level: number
  text: string
  /** 该行在原文中的字符偏移，用于 EditorView.scrollIntoView */
  offset: number
}

/**
 * 抽出 Markdown 的 # 标题，供提示词编辑器的大纲导航使用。
 * 刻意保持为纯字符串扫描：不引 @lezer / lang-markdown，只为跳转定位。
 */
export function extractHeadings(markdown: string): HeadingItem[] {
  const headings: HeadingItem[] = []
  const lines = markdown.split('\n')
  let offset = 0

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (match) {
      headings.push({ level: match[1].length, text: match[2], offset })
    }
    // 累加原始行长（含 \r）+ \n，保证 offset 对 CRLF 文本同样准确
    offset += rawLine.length + 1
  }

  return headings
}
