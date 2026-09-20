import type {
  ChatWorkflowStage,
  ParsedChapterOutlineModules,
  ParsedChapterOutlineOutput,
  ParsedCreationOutput,
  ParsedDirectionOutput
} from '../shared/project'

export type {
  ParsedChapterOutlineModules,
  ParsedChapterOutlineOutput,
  ParsedCreationOutput,
  ParsedDirectionOutput
}

interface TagToken {
  tag: string
  isClosing: boolean
  start: number
  end: number
}

const KNOWN_TAGS = [
  'thinking',
  'summary',
  'options',
  'plot_options',
  'outline',
  'chapter_outline',
  'direction',
  'questions',
  'content'
]

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

  const tagRegex = /<(\/)?([a-zA-Z_]+)(?:\s+[^>]*)?>/g
  const tokens: TagToken[] = []
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(rawText)) !== null) {
    const isClosing = match[1] === '/'
    const tagName = match[2].toLowerCase()
    if (KNOWN_TAGS.includes(tagName)) {
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

/**
 * Extracts plot options from text.
 */
function extractOptionsList(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[\d+.\-*\s>【（(]+(?:\d+[)）】]?)?\s*/, '').trim())
    .filter((opt) => opt.length > 0 && !/^###?\s+/.test(opt))
}

/**
 * Robust creation output parser.
 * Guarantees that candidate content only contains story prose,
 * cleanly separating thinking, summary, plot options, outlines, etc.
 * Preserves raw output and records warnings.
 */
export function parseCreationOutput(rawText: string): ParsedCreationOutput {
  if (!rawText || typeof rawText !== 'string') {
    return {
      content: '',
      warnings: [],
      rawOutput: rawText || ''
    }
  }

  const { sections, warnings, hasTags } = scanXmlSections(rawText)

  let thinking: string | undefined
  let summary: string | undefined
  let plotOptions: string[] | undefined
  let outline: string | undefined
  let direction: string | undefined
  let content: string | undefined

  if (sections.has('thinking')) {
    thinking = sections.get('thinking')!.join('\n\n').trim()
  }
  if (sections.has('summary')) {
    summary = sections.get('summary')!.join('\n\n').trim()
  }
  if (sections.has('options')) {
    plotOptions = extractOptionsList(sections.get('options')!.join('\n'))
  } else if (sections.has('plot_options')) {
    plotOptions = extractOptionsList(sections.get('plot_options')!.join('\n'))
  }
  if (sections.has('outline')) {
    outline = sections.get('outline')!.join('\n\n').trim()
  } else if (sections.has('chapter_outline')) {
    outline = sections.get('chapter_outline')!.join('\n\n').trim()
  }
  if (sections.has('direction')) {
    direction = sections.get('direction')!.join('\n\n').trim()
  }

  if (sections.has('content')) {
    content = sections.get('content')!.join('\n\n').trim()
  } else if (hasTags) {
    // If other tags exist but <content> was not explicitly tagged,
    // strip out all non-content tag blocks from the raw text to extract pure content.
    let stripped = rawText
    stripped = stripped.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '')
    stripped = stripped.replace(/<summary>[\s\S]*?(?:<\/summary>|$)/gi, '')
    stripped = stripped.replace(/<(?:plot_options|options)>[\s\S]*?(?:<\/(?:plot_options|options)>|$)/gi, '')
    stripped = stripped.replace(/<(?:chapter_outline|outline)>[\s\S]*?(?:<\/(?:chapter_outline|outline)>|$)/gi, '')
    stripped = stripped.replace(/<direction>[\s\S]*?(?:<\/direction>|$)/gi, '')
    stripped = stripped.replace(/<questions>[\s\S]*?(?:<\/questions>|$)/gi, '')
    stripped = stripped.trim()
    content = stripped
  } else {
    // Completely untagged plain text -> check for Markdown header blocks
    let workingText = rawText.trim()

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

  // Ensure content falls back safely to rawText if empty and no other sections extracted
  const finalContent = content && content.length > 0 ? content : (!thinking && !outline && !summary ? rawText.trim() : (content || ''))

  return {
    content: finalContent,
    thinking,
    summary,
    plotOptions: plotOptions && plotOptions.length > 0 ? plotOptions : undefined,
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

  const { sections, warnings } = scanXmlSections(rawText)
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
    let workingText = rawText.trim()
    if (thinking) {
      workingText = workingText.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '').trim()
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
    direction: direction || rawText.trim(),
    questions,
    thinking,
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

  const { sections, warnings } = scanXmlSections(rawText)
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
    let workingText = rawText.trim()
    if (thinking) {
      workingText = workingText.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '').trim()
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
    outline: outline || rawText.trim(),
    modules,
    thinking,
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
