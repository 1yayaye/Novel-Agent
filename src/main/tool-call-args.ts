// 工具调用参数（tool_calls[].function.arguments）的解析与修复。
//
// 模型返回的参数有三种形态：已是对象、合法 JSON 字符串、以及被 max_tokens 截断或语法不完整的
// JSON 字符串。截断本身由 model-gateway 的 finish_reason 防护拒绝；这里处理的是"完整但语法
// 拖泥带水"的输出（```json 包裹、未转义换行、缺尾引号/花括号），先尝试严格解析，失败后
// 补全再用贪婪正则逐字段抽取，尽量恢复结构化内容而不是整段丢弃。
// 注意：这不是 JSON 标准解析器，启发式只服务于 novel_reply 系工具的字段约定。

function safeUnescapeJsonString(str: string): string {
  try {
    return JSON.parse(`"${str.replace(/"/g, '\\"')}"`)
  } catch {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

function extractStringField(json: string, fieldNames: string[]): string | undefined {
  const fieldsPattern = fieldNames.join('|')
  const regex = new RegExp(
    `"(?:${fieldsPattern})"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*(?:,\\s*"[a-zA-Z0-9_]+"\\s*:|}|$)|\"|$)`,
    'i'
  )
  const m = json.match(regex)
  if (m && m[1] !== undefined) {
    return safeUnescapeJsonString(m[1])
  }
  return undefined
}

function extractOptionsListField(json: string, fieldNames: string[]): string[] | undefined {
  const fieldsPattern = fieldNames.join('|')
  const regex = new RegExp(`"(?:${fieldsPattern})"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`, 'i')
  const m = json.match(regex)
  if (!m) return undefined
  const items: string[] = []
  const itemRegex = /"((?:[^"\\]|\\.)*)"/g
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemRegex.exec(m[1])) !== null) {
    items.push(safeUnescapeJsonString(itemMatch[1]))
  }
  return items.length > 0 ? items : undefined
}

export function parseToolCallArguments(argsRaw: unknown): Record<string, unknown> {
  if (!argsRaw) return {}
  if (typeof argsRaw === 'object' && argsRaw !== null) {
    return argsRaw as Record<string, unknown>
  }
  if (typeof argsRaw === 'string') {
    let clean = argsRaw.trim()
    if (clean.startsWith('```json')) clean = clean.slice(7)
    else if (clean.startsWith('```')) clean = clean.slice(3)
    if (clean.endsWith('```')) clean = clean.slice(0, -3)
    clean = clean.trim()
    try {
      return JSON.parse(clean) as Record<string, unknown>
    } catch {
      try {
        let repaired = clean
        const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length
        if (quoteCount % 2 !== 0) repaired += '"'
        if (!repaired.endsWith('}')) repaired += '}'
        return JSON.parse(repaired) as Record<string, unknown>
      } catch {}

      const res: Record<string, unknown> = {}

      const content = extractStringField(clean, ['game_content', 'content', 'story', 'story_body', 'text', 'prose', 'chapter_content'])
      if (content !== undefined) res.game_content = content

      const summary = extractStringField(clean, ['summary', 'chapter_summary'])
      if (summary !== undefined) res.summary = summary

      const comment = extractStringField(clean, ['comment', 'cat_comment', 'author_comment', 'note', 'notes', 'extra'])
      if (comment !== undefined) res.comment = comment

      const outline = extractStringField(clean, ['outline', 'chapter_outline', 'fox_hugou'])
      if (outline !== undefined) res.outline = outline

      const direction = extractStringField(clean, ['direction'])
      if (direction !== undefined) res.direction = direction

      const thinking = extractStringField(clean, ['think_nya', 'thinking', 'thought', 'analysis'])
      if (thinking !== undefined) res.think_nya = thinking

      const options = extractOptionsListField(clean, ['options', 'choices', 'plot_options', 'plotOptions', 'fox_selc'])
      if (options !== undefined) res.options = options

      return res
    }
  }
  return {}
}
