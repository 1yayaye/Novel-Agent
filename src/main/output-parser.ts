import type {
  ChatWorkflowStage,
  ParsedChapterOutlineModules,
  ParsedChapterOutlineOutput,
  ParsedCreationOutput,
  ParsedDirectionOutput
} from '../shared/project'
import type { ToolCall } from './model-gateway.js'
import { parseToolCallArguments } from './tool-call-args.js'
import { SOLIUMBRA_TOOL_NAME } from '../shared/prompt-settings.js'

export type {
  ParsedChapterOutlineModules,
  ParsedChapterOutlineOutput,
  ParsedCreationOutput,
  ParsedDirectionOutput,
  ToolCall
}

interface TagToken {
  tag: string
  isClosing: boolean
  start: number
  end: number
}

const KNOWN_TAGS = [
  'thinking',
  'think',
  'thought',
  'analysis',
  'reasoning',
  'interleaved_thinking',
  'interleaving',
  'chain_of_thought',
  'think_nya',
  'report_nya',
  'summary',
  'options',
  'plot_options',
  'choice',
  'choices',
  'fox_selc',
  'outline',
  'chapter_outline',
  'fox_hugou',
  'direction',
  'questions',
  'content',
  'game',
  'game_content',
  'comment',
  'option'
]

function isReasoningTag(tag: string): boolean {
  const t = tag.toLowerCase()
  return (
    t === 'thinking' ||
    t === 'think' ||
    t === 'thought' ||
    t === 'analysis' ||
    t === 'reasoning' ||
    t === 'interleaved_thinking' ||
    t === 'chain_of_thought' ||
    t === 'think_nya' ||
    t === 'report_nya' ||
    t.startsWith('think_nya') ||
    t.startsWith('report_nya') ||
    t.startsWith('thinking_') ||
    t.startsWith('think_') ||
    t.endsWith('_planning') ||
    t.endsWith('_planning~') ||
    t.endsWith('_cot')
  )
}

/**
 * Scans text for known XML-like tags (case-insensitive) and isolates sections,
 * handling:
 * 1. Fully closed tags: <tag>content</tag>
 * 2. Unclosed tags interrupted by next tag: <tag1>content1<tag2>content2
 * 3. Unclosed tags reaching EOF: <tag>content
 */
function scanXmlSections(rawText: string): {
  sections: Map<string, string[]>
  warnings: string[]
  hasTags: boolean
} {
  const sections = new Map<string, string[]>()
  const warnings: string[] = []
  if (!rawText) return { sections, warnings, hasTags: false }

  const tagRegex = /<(\/)?([a-zA-Z0-9_\-~]+)(?:\s+[^>]*)?>/g
  const tokens: TagToken[] = []
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(rawText)) !== null) {
    const isClosing = match[1] === '/'
    const tagName = match[2].toLowerCase()
    if (KNOWN_TAGS.includes(tagName) || isReasoningTag(tagName)) {
      tokens.push({
        tag: tagName,
        isClosing,
        start: match.index,
        end: match.index + match[0].length
      })
    }
  }

  if (tokens.length === 0) {
    return { sections, warnings, hasTags: false }
  }

  // Iterate over tokens and extract content between matching or subsequent tags
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i]
    if (current.isClosing) continue

    const tagName = current.tag
    const contentStart = current.end

    // Find the next token (either closing </tagName> or any next opening/closing token)
    let contentEnd = rawText.length
    let isClosedProperly = false

    for (let j = i + 1; j < tokens.length; j++) {
      const next = tokens[j]
      if (next.isClosing && next.tag === tagName) {
        contentEnd = next.start
        isClosedProperly = true
        break
      } else if (!next.isClosing) {
        // Child tags like <option> inside <options>/<choices>/<plot_options> do not prematurely terminate parent
        if ((tagName === 'options' || tagName === 'choices' || tagName === 'plot_options') && next.tag === 'option') {
          continue
        }
        // Next opening tag started before closing current tag
        contentEnd = next.start
        break
      }
    }

    if (!isClosedProperly) {
      warnings.push(`检测到未闭合的 <${tagName}> 标签，已自动进行隔离切分`)
    }

    const chunk = rawText.slice(contentStart, contentEnd).trim()
    if (chunk.length > 0) {
      const existing = sections.get(tagName) || []
      existing.push(chunk)
      sections.set(tagName, existing)
    }
  }

  return { sections, warnings, hasTags: true }
}

const OPTION_PREFIX_REGEX = /^(?:(?:(?:选项|分支)\s*[0-9一二三四五六七八九十]+|[A-Za-z0-9]+)\s*[:：.、)）】\-\]]\s*|[【（(\[]?\s*\d+\s*[)）】\]:：.、\-]\s*|[-*•>+、:：\s]+)/

function cleanSingleOption(text: string): string {
  const clean = text.replace(/<\/?[^>]+>/g, '').trim()
  return clean.replace(OPTION_PREFIX_REGEX, '').trim()
}

/**
 * Extracts plot options from text.
 */
function extractOptionsList(text: string): string[] {
  if (/<option\b[^>]*>/i.test(text)) {
    const matches: string[] = []
    const optionRegex = /<option\b[^>]*>([\s\S]*?)(?:<\/option>|(?=<option\b|<\/options>|<\/choices>|<\/plot_options>)|$)/gi
    let m: RegExpExecArray | null
    while ((m = optionRegex.exec(text)) !== null) {
      const clean = m[1].replace(/<\/?[^>]+>/g, '').trim()
      const stripped = clean.replace(OPTION_PREFIX_REGEX, '').trim()
      if (stripped.length > 0 && !/^###?\s+/.test(stripped)) {
        matches.push(stripped)
      }
    }
    if (matches.length > 0) return matches
  }

  return text
    .split(/\n+/)
    .map((line) => line.replace(/<\/?option\b[^>]*>/gi, '').replace(OPTION_PREFIX_REGEX, '').trim())
    .filter((opt) => opt.length > 0 && !/^###?\s+/.test(opt))
}

function stripReasoning(text: string): string {
  // First, strip all properly closed reasoning blocks directly so that internal tag mentions (e.g. `<game>` inside thinking) are cleanly removed
  const working = text.replace(/<([a-zA-Z0-9_\-~]+)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/gi, (match, tag) => {
    if (isReasoningTag(tag.toLowerCase())) return ''
    return match
  })

  const tags = /<(\/)?([a-zA-Z0-9_\-~]+)(?:\s+[^>]*)?>/g
  const reasoning: string[] = []
  const parts: string[] = []
  let offset = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(working)) !== null) {
    if (!reasoning.length) parts.push(working.slice(offset, match.index))
    const name = match[2].toLowerCase()
    if (isReasoningTag(name)) {
      if (match[1]) {
        if (reasoning.at(-1) === name) reasoning.pop()
      } else {
        reasoning.push(name)
      }
    } else {
      if (!match[1]) {
        reasoning.length = 0
      }
      if (!reasoning.length && name !== 'interleaving') {
        parts.push(match[0])
      }
    }
    offset = tags.lastIndex
  }
  // An unfinished reasoning section cannot safely be treated as prose.
  if (!reasoning.length) parts.push(working.slice(offset))
  return parts.join('')
    .replace(/(?:^|\n)#{1,6}\s*【?(?:思考过程|写前推演|构思推演|思维链|分析过程)】?[^\n]*\n[\s\S]*?(?=\n#{1,6}\s*【?(?:正文|方向|核心事件|本章目标|待确认问题)|$)/g, '')
    .trim()
}

/**
 * Robust creation output parser.
 * Guarantees that candidate content only contains story prose,
 * cleanly separating thinking, summary, plot options, outlines, etc.
 * Supports native Tool Calling arguments (e.g. soliumbra_reply) as well as XML/Markdown.
 * Preserves raw output and records warnings.
 */
export function parseCreationOutput(rawText: string, toolCalls?: ToolCall[]): ParsedCreationOutput {
  if (toolCalls && toolCalls.length > 0) {
    const effectiveTool = toolCalls.find((tc) => tc.function?.name === SOLIUMBRA_TOOL_NAME) || toolCalls[0]
    if (effectiveTool?.function) {
      const args = parseToolCallArguments(effectiveTool.function.arguments)
      const rawContent = String(
        args.game_content ?? args.content ?? args.story ?? args.story_body ?? args.text ?? args.prose ?? args.chapter_content ?? ''
      )

      const summary = args.summary ?? args.chapter_summary
        ? String(args.summary ?? args.chapter_summary).trim()
        : undefined
      const commentBase = args.comment ?? args.cat_comment ?? args.author_comment ?? args.note ?? args.notes
        ? String(args.comment ?? args.cat_comment ?? args.author_comment ?? args.note ?? args.notes).trim()
        : undefined
      // registerPart 部件 extra（世界规则补充等）不作为正文，并入留言展示
      const extra = args.extra ? String(args.extra).trim() : undefined
      const comment = [commentBase, extra].filter(Boolean).join('\n\n') || undefined
      const outline = args.outline ?? args.chapter_outline ?? args.fox_hugou
        ? String(args.outline ?? args.chapter_outline ?? args.fox_hugou).trim()
        : undefined
      const direction = args.direction ? String(args.direction).trim() : undefined

      let plotOptions: string[] | undefined
      const rawOpts = args.options ?? args.plot_options ?? args.plotOptions ?? args.choices ?? args.fox_selc
      if (Array.isArray(rawOpts)) {
        const list = rawOpts
          .map((item) => {
            if (typeof item === 'object' && item !== null) {
              const obj = item as Record<string, unknown>
              const textVal = obj.text ?? obj.content ?? obj.option ?? obj.title ?? obj.desc ?? obj.value
              return cleanSingleOption(String(textVal ?? ''))
            }
            return cleanSingleOption(String(item))
          })
          .filter((item) => item.length > 0 && !/^###?\s+/.test(item))
        if (list.length > 0) plotOptions = list
      } else if (typeof rawOpts === 'string' && rawOpts.trim()) {
        const list = extractOptionsList(rawOpts)
        if (list.length > 0) plotOptions = list
      }

      let cleanContent = stripReasoning(rawContent)
      cleanContent = cleanContent
        .replace(/<comment\b[^>]*>[\s\S]*?(?:<\/comment>|$)/gi, '')
        .replace(/<summary\b[^>]*>[\s\S]*?(?:<\/summary>|$)/gi, '')
        .replace(/<(?:plot_options|options|choice|choices|fox_selc)\b[^>]*>[\s\S]*?(?:<\/(?:plot_options|options|choice|choices|fox_selc)>|$)/gi, '')
        .replace(/<option\b[^>]*>[\s\S]*?(?:<\/option>|$)/gi, '')
        .replace(/<\/?(?:game|game_content|content)(?:\s+[^>]*)?>/gi, '')
        .trim()

      const warnings: string[] = []
      if (!cleanContent.trim()) {
        warnings.push('输出未包含可供审阅的小说正文')
      }

      return {
        content: cleanContent,
        summary,
        plotOptions,
        comment,
        outline,
        direction,
        warnings,
        rawOutput: rawText
      }
    }
  }

  if (!rawText || typeof rawText !== 'string') {
    return {
      content: '',
      warnings: [],
      rawOutput: rawText || ''
    }
  }

  const trimmed = rawText.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let jsonParsed: unknown = null
    try {
      jsonParsed = JSON.parse(trimmed)
    } catch {
      let clean = trimmed
      if (clean.startsWith('```json')) clean = clean.slice(7)
      else if (clean.startsWith('```')) clean = clean.slice(3)
      if (clean.endsWith('```')) clean = clean.slice(0, -3)
      clean = clean.trim()
      try {
        jsonParsed = JSON.parse(clean)
      } catch {}
    }

    if (jsonParsed && typeof jsonParsed === 'object') {
      if (Array.isArray(jsonParsed) && jsonParsed.length > 0 && (jsonParsed[0] as any)?.type === 'function') {
        return parseCreationOutput(rawText, jsonParsed as ToolCall[])
      }
      if ('type' in jsonParsed && (jsonParsed as any).type === 'function' && 'function' in jsonParsed) {
        return parseCreationOutput(rawText, [jsonParsed as ToolCall])
      }
      if ('name' in jsonParsed && 'arguments' in jsonParsed) {
        const obj = jsonParsed as { name: string; arguments: unknown }
        const argsStr = typeof obj.arguments === 'string' ? obj.arguments : JSON.stringify(obj.arguments)
        return parseCreationOutput(rawText, [{ type: 'function', function: { name: obj.name, arguments: argsStr } }])
      }
      const keys = Object.keys(jsonParsed)
      const hasCreationKeys = keys.some((k) =>
        ['game_content', 'content', 'story', 'text', 'think_nya', 'summary', 'options', 'comment'].includes(k)
      )
      if (hasCreationKeys) {
        return parseCreationOutput(rawText, [
          { type: 'function', function: { name: SOLIUMBRA_TOOL_NAME, arguments: JSON.stringify(jsonParsed) } }
        ])
      }
    } else {
      const args = parseToolCallArguments(trimmed)
      const hasCreationKeys = Object.keys(args).some((k) =>
        ['game_content', 'content', 'story', 'text', 'summary', 'options', 'comment'].includes(k)
      )
      if (hasCreationKeys) {
        return parseCreationOutput(rawText, [
          { type: 'function', function: { name: SOLIUMBRA_TOOL_NAME, arguments: trimmed } }
        ])
      }
    }
  }

  const cleanText = stripReasoning(rawText)
  const { sections, warnings, hasTags } = scanXmlSections(cleanText)

  let thinking: string | undefined
  let summary: string | undefined
  let plotOptions: string[] | undefined
  let comment: string | undefined
  let outline: string | undefined
  let direction: string | undefined
  let content: string | undefined

  for (const [key, val] of sections.entries()) {
    if (isReasoningTag(key)) {
      thinking = val.join('\n\n').trim()
    }
  }
  if (sections.has('summary')) {
    summary = sections.get('summary')!.join('\n\n').trim()
  }
  if (sections.has('comment')) {
    comment = sections.get('comment')!.join('\n\n').trim()
  }
  for (const optTag of ['options', 'plot_options', 'choice', 'choices', 'fox_selc']) {
    if (sections.has(optTag)) {
      plotOptions = extractOptionsList(sections.get(optTag)!.join('\n'))
      break
    }
  }
  if (!plotOptions && sections.has('option')) {
    const rawOpts = sections.get('option')!
    const cleaned = rawOpts
      .map((chunk) => cleanSingleOption(chunk))
      .filter((opt) => opt.length > 0 && !/^###?\s+/.test(opt))
    if (cleaned.length > 0) plotOptions = cleaned
  }
  for (const outlineTag of ['chapter_outline', 'outline', 'fox_hugou']) {
    if (sections.has(outlineTag)) {
      outline = sections.get(outlineTag)!.join('\n\n').trim()
      break
    }
  }
  if (sections.has('direction')) {
    direction = sections.get('direction')!.join('\n\n').trim()
  }

  for (const contentTag of ['content', 'game_content', 'game']) {
    if (sections.has(contentTag)) {
      content = sections.get(contentTag)!.join('\n\n').trim()
      break
    }
  }

  if (content === undefined && hasTags) {
    // If other tags exist but neither <content> nor <game>/<game_content> was explicitly isolated,
    // strip out all non-content tag blocks from the raw text to extract pure content.
    let stripped = cleanText
    stripped = stripped.replace(/<([a-zA-Z0-9_\-~]+)>[\s\S]*?(?:<\/\1>|$)/gi, (m, tag) => {
      if (isReasoningTag(tag)) return ''
      return m
    })
    stripped = stripped.replace(/<\/?(interleaving|interleaved_thinking)(?:\s+[^>]*)?>/gi, '')
    stripped = stripped.replace(/<comment\b[^>]*>[\s\S]*?(?:<\/comment>|$)/gi, '')
    stripped = stripped.replace(/<summary\b[^>]*>[\s\S]*?(?:<\/summary>|$)/gi, '')
    stripped = stripped.replace(/<(?:plot_options|options|choice|choices|fox_selc|option)\b[^>]*>[\s\S]*?(?:<\/(?:plot_options|options|choice|choices|fox_selc|option)>|$)/gi, '')
    stripped = stripped.replace(/<(?:chapter_outline|outline|fox_hugou)\b[^>]*>[\s\S]*?(?:<\/(?:chapter_outline|outline|fox_hugou)>|$)/gi, '')
    stripped = stripped.replace(/<direction\b[^>]*>[\s\S]*?(?:<\/direction>|$)/gi, '')
    stripped = stripped.replace(/<questions\b[^>]*>[\s\S]*?(?:<\/questions>|$)/gi, '')
    stripped = stripped.replace(/<\/?(?:game|game_content)(?:\s+[^>]*)?>/gi, '')
    stripped = stripped.trim()
    content = stripped
  } else if (content === undefined) {
    // Completely untagged plain text -> check for Markdown header blocks
    let workingText = cleanText

    // 0. Check for comment section in markdown: ### 【猫猫留言】
    const mdCommentMatch = workingText.match(/(?:###?\s*【?(?:猫猫留言|小猫留言|留言|创作者寄语|作者留言|助手留言)】?)([\s\S]*?)(?=(?:###?\s*【?(?:正文|正文内容|续写正文|剧情选项|大纲|思考过程)】?)|$)/i)
    if (mdCommentMatch) {
      comment = mdCommentMatch[1].trim()
      workingText = workingText.replace(mdCommentMatch[0], '').trim()
    }

    // 1. Check for thinking section in markdown: ### 【思考过程】 or ### 【推演】
    const mdThinkMatch = workingText.match(/(?:###?\s*【?(?:思考过程|写前推演|构思推演|思维链)】?)([\s\S]*?)(?=(?:###?\s*【?(?:正文|正文内容|续写正文|剧情选项|大纲)】?)|$)/i)
    if (mdThinkMatch) {
      thinking = mdThinkMatch[1].trim()
      workingText = workingText.replace(mdThinkMatch[0], '').trim()
    }

    // 2. Check for outline section in markdown: ### 【本章大纲】
    const mdOutlineMatch = workingText.match(/(?:###?\s*【?(?:本章大纲|章大纲|大纲规划)】?)([\s\S]*?)(?=(?:###?\s*【?(?:正文|正文内容|续写正文|剧情选项)】?)|$)/i)
    if (mdOutlineMatch) {
      outline = mdOutlineMatch[1].trim()
      workingText = workingText.replace(mdOutlineMatch[0], '').trim()
    }

    // 3. Check for plot options in markdown: ### 【剧情选项】 / ### 【走向分支】
    const mdOptsMatch = workingText.match(/(?:###?\s*【?(?:剧情选项|分支走向|后续选项|选项)】?)([\s\S]*?)$/i)
    if (mdOptsMatch) {
      plotOptions = extractOptionsList(mdOptsMatch[1].trim())
      workingText = workingText.replace(mdOptsMatch[0], '').trim()
    }

    // 4. Check for pure content header: ### 【正文】
    const mdContentMatch = workingText.match(/(?:###?\s*【?(?:正文|正文内容|续写正文)】?)\s*([\s\S]*)$/i)
    if (mdContentMatch) {
      workingText = mdContentMatch[1].trim()
    }

    content = workingText
  }

  if (content) {
    // Strip residual metadata tags that might have been nested or unclosed inside content
    content = content
      .replace(/<comment\b[^>]*>[\s\S]*?(?:<\/comment>|$)/gi, '')
      .replace(/<summary\b[^>]*>[\s\S]*?(?:<\/summary>|$)/gi, '')
      .replace(/<(?:plot_options|options|choice|choices|fox_selc)\b[^>]*>[\s\S]*?(?:<\/(?:plot_options|options|choice|choices|fox_selc)>|$)/gi, '')
      .replace(/<option\b[^>]*>[\s\S]*?(?:<\/option>|$)/gi, '')
      .replace(/<\/?(?:game|game_content)(?:\s+[^>]*)?>/gi, '')
      .trim()
  }

  // Ensure content falls back safely to rawText if empty and no other sections extracted
  const finalContent = content?.trim() || ''
  if (!finalContent && rawText.trim()) warnings.push('输出未包含可供审阅的小说正文')

  return {
    content: finalContent,
    summary,
    plotOptions: plotOptions && plotOptions.length > 0 ? plotOptions : undefined,
    comment,
    outline,
    direction,
    warnings,
    rawOutput: rawText
  }
}

/**
 * Parses model output for the 'direction' stage.
 * Extracts core direction text, questions for the author, and optional thinking.
 */
export function parseDirectionOutput(rawText: string): ParsedDirectionOutput {
  if (!rawText || typeof rawText !== 'string') {
    return { direction: '', questions: [], warnings: [], rawOutput: rawText || '' }
  }

  const cleanText = stripReasoning(rawText)
  const { sections, warnings } = scanXmlSections(cleanText)
  let thinking: string | undefined
  let direction = ''
  let questions: string[] = []

  if (sections.has('thinking')) {
    thinking = sections.get('thinking')!.join('\n\n').trim()
  }

  if (sections.has('direction')) {
    direction = sections.get('direction')!.join('\n\n').trim()
  }

  if (sections.has('questions')) {
    questions = extractOptionsList(sections.get('questions')!.join('\n'))
  }

  if (!direction) {
    // Parse Markdown structure
    let workingText = cleanText
    if (thinking) {
      workingText = workingText.replace(/<(thinking|think|thought|analysis|reasoning|interleaved_thinking)>[\s\S]*?(?:<\/\1>|$)/gi, '').trim()
    }

    // Match question block in markdown: 【待确认问题】 or ### 待确认问题
    const qMatch = workingText.match(/(?:(?:###?\s*)?【?(?:待确认问题|关键问题|作者确认|问题清单)】?[:：]?)([\s\S]*?)$/i)
    if (qMatch) {
      questions = extractOptionsList(qMatch[1].trim())
      direction = workingText.slice(0, qMatch.index).trim()
    } else {
      direction = workingText
    }
  }

  return {
    direction,
    questions: questions.slice(0, 3),
    warnings,
    rawOutput: rawText
  }
}

/**
 * Parses model output for the 'chapter_outline' stage.
 * Extracts the 6-module structured outline and its individual components.
 */
export function parseChapterOutlineOutput(rawText: string): ParsedChapterOutlineOutput {
  if (!rawText || typeof rawText !== 'string') {
    return {
      outline: '',
      modules: {},
      warnings: [],
      rawOutput: rawText || ''
    }
  }

  const cleanText = stripReasoning(rawText)
  const { sections, warnings } = scanXmlSections(cleanText)
  let thinking: string | undefined
  let outline = ''

  if (sections.has('thinking')) {
    thinking = sections.get('thinking')!.join('\n\n').trim()
  }

  if (sections.has('chapter_outline')) {
    outline = sections.get('chapter_outline')!.join('\n\n').trim()
  } else if (sections.has('outline')) {
    outline = sections.get('outline')!.join('\n\n').trim()
  } else {
    let workingText = cleanText
    if (thinking) {
      workingText = workingText.replace(/<(thinking|think|thought|analysis|reasoning|interleaved_thinking)>[\s\S]*?(?:<\/thinking>|$)/gi, '').trim()
    }
    outline = workingText
  }

  // Parse the 6 core modules
  const modules: ParsedChapterOutlineModules = {}

  const matchSection = (names: string[]): string | undefined => {
    const pattern = new RegExp(
      `(?:(?:###?\\s*)?【?(?:${names.join('|')})】?[:：]?)([\\s\\S]*?)(?=(?:(?:###?\\s*)?【?(?:本章目标|场景节拍|人物与动机|冲突与信息增量|连续性风险|结尾钩子|待确认问题)】?[:：]?)|$)`,
      'i'
    )
    const m = outline.match(pattern)
    return m ? m[1].trim() : undefined
  }

  modules.goal = matchSection(['本章目标', '目标使命', '核心目标'])
  modules.sceneBeats = matchSection(['场景节拍', '节拍设计', '场景顺序'])
  modules.characters = matchSection(['人物与动机', '人物动机', '角色动因'])
  modules.conflicts = matchSection(['冲突与信息增量', '核心冲突', '信息增量'])
  modules.continuityRisk = matchSection(['连续性风险', '伏笔与连续性', '一致性风险'])
  modules.endingHook = matchSection(['结尾钩子', '结尾悬念', '收尾动作'])

  return {
    outline,
    modules,
    warnings,
    rawOutput: rawText
  }
}

/**
 * Universal dispatcher for stage-specific output parsing.
 */
export function parseStageOutput(
  stage: ChatWorkflowStage,
  rawText: string
): ParsedCreationOutput | ParsedDirectionOutput | ParsedChapterOutlineOutput {
  switch (stage) {
    case 'direction':
      return parseDirectionOutput(rawText)
    case 'chapter_outline':
      return parseChapterOutlineOutput(rawText)
    case 'content':
    case 'reviewed':
    default:
      return parseCreationOutput(rawText)
  }
}
