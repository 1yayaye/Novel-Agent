import { randomUUID } from 'node:crypto'
import {
  NovelPromptPresetSchema,
  type NovelPromptPreset,
  type PresetBlock
} from '../shared/prompt-settings.js'
import { ProjectError } from './project-store.js'

/**
 * 清洗酒馆预设文本：替换宏并将单人角色扮演专有提示弱化/过滤为长篇小说创作语境。
 */
export function cleanTavernContent(rawText: string): string {
  if (!rawText) return ''
  let text = rawText

  // 0. 酒馆注释与基础格式控制宏清理
  text = text
    .replace(/\{\{\s*\/\/(?:[\s\S]*?)\}\}/g, '')
    .replace(/\{\{\s*trim\s*\}\}/gi, '')
    .replace(/\{\{\s*random::([\s\S]*?)\s*\}\}/gi, (_, opts) => opts.split('::')[0] || '')
    .replace(/\{\{\s*roll(?:\s+[^}]+)?\s*\}\}/gi, '')

  // 1. 宏替换（支持带空格的 Mustache/Jinja 语法）
  text = text
    .replace(/\{\{\s*user\s*\}\}/gi, '作者')
    .replace(/\{\{\s*char\s*\}\}/gi, '叙述者')
    .replace(/\{\{\s*bot\s*\}\}/gi, '叙述者')
    .replace(/\{\{\s*(?:persona|user_persona)\s*\}\}/gi, '【作者设定】')
    .replace(/\{\{\s*(?:personality|char_personality)\s*\}\}/gi, '【叙述风格与人设】')
    .replace(/\{\{\s*(?:description|char_description)\s*\}\}/gi, '【人物与故事背景】')
    .replace(/\{\{\s*scenario\s*\}\}/gi, '【当前场景与定位】')
    .replace(/<world_info>|<worldinfo>|\{\{\s*(?:worldInfo|world_info|lore|lorebook)\s*\}\}|<lore>|<lorebook>/gi, '【设定库资料】')
    .replace(/<chat_history>|<chathistory>|\{\{\s*(?:chat_history|chatHistory|history)\s*\}\}|<history>/gi, '【会话历史】')
    .replace(/<input>|\{\{\s*input\s*\}\}/gi, '【作者任务】')
    .replace(/\{\{\s*(?:lastUserMessage|last_user_message)\s*\}\}/gi, '【作者任务】')
    .replace(/\{\{\s*(?:lastMessage|lastMessageId)\s*\}\}/gi, '【最新剧情】')

  // 2. 过滤/弱化纯 RP 角色扮演指令
  text = text
    .replace(/(?:Please\s+)?wait\s+for\s+(?:作者|user)\s+to\s+(?:respond|reply|act|input|type)[^\n.]*[\n.]?/gi, '')
    .replace(/(?:Never|Do not|Don't|Avoid|You should not|Must not|Cannot)\s+(?:speak(?:ing)?|act(?:ing)?|reply(?:ing)?|writ(?:e|ing)|decid(?:e|ing)|impersonat(?:e|ing)|generat(?:e|ing)(?:\s+\w+)?|continue(?:\s+the\s+story)?)\s+(?:(?:on behalf of|for)\s+)?(?:作者|user)[^\n.]*[\n.]?/gi, '')
    .replace(/(?:You are in a roleplay session(?: with (?:作者|user))?|This is a roleplay(?: session)?|You are roleplaying[^\n.]*)[^\n.]*[\n.]?/gi, '')
    .replace(/(?:Respond in a roleplay chat format|Format your response as a roleplay message)[^\n.]*[\n.]?/gi, '')
    .replace(/(?:Stay in character(?: at all times)?|Never break character|Act as an AI roleplay[^\n.]*)[^\n.]*[\n.]?/gi, '')
    .replace(/(?:请)?(?:等待|静候)(?:作者|用户)(?:回复|回应|输入|做决定)[^\n。]*[，。\n]?/gi, '')
    .replace(/(?:切勿|不要|绝不|严禁|禁止|不得|请勿)\s*(?:代表|替|代替|代为)?\s*(?:作者|用户)?\s*(?:发言|做决定|行动|回复|角色扮演|推进剧情|输入)[^\n。]*[，。\n]?/gi, '')
    .replace(/(?:你正在与(?:作者|用户)进行角色扮演|这是一场角色扮演|你是一个用于角色扮演[^\n。]*|作为角色扮演助手[^\n。]*)[^\n。]*[，。\n]?/gi, '')

  // 3. 去除多余空行与两端空格
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 识别 Block 是否属于小说资料插槽
 */
export function detectBlockMarker(prompt: {
  identifier?: string
  name?: string
  content?: string
  marker?: unknown
}): string | undefined {
  if (typeof prompt.marker === 'string' && prompt.marker.startsWith('marker.')) {
    return prompt.marker
  }

  const id = (prompt.identifier ?? '').trim()
  const lowerId = id.toLowerCase()
  const name = (prompt.name ?? '').trim()
  const lowerName = name.toLowerCase()
  const content = (prompt.content ?? '').trim()

  // 1. SillyTavern 官方系统插槽标识符精准匹配
  if (['worldinfobefore', 'worldinfoafter', 'worldinfo', 'world_info', 'lorebook'].includes(lowerId)) {
    return 'marker.knowledge'
  }
  if (['chathistory', 'chat_history'].includes(lowerId)) {
    return 'marker.history'
  }
  if (['dialogueexamples', 'dialogue_history'].includes(lowerId)) {
    return 'marker.style_samples'
  }
  if (['agenttask', 'agent_task', 'input', 'userinput'].includes(lowerId)) {
    return 'marker.task'
  }

  // 2. 排除标签开闭包装器与大段具体提示词指令（防止将带设定/历史字样的普通指令误判为插槽）
  const isWrapperOrDelimiter =
    /[开初起]始$|[结完收]束$|(?:::|--|──)\s*(?:start|end|open|close)$/i.test(name) ||
    /^📌?[^，。\n]*(?:开始|结束)$/.test(name)
  const isSubstantiveInstruction =
    content.length > 200 ||
    /思维链|写作指导|协议|规则|规范|说明|条目/.test(name)

  if (isWrapperOrDelimiter || isSubstantiveInstruction) {
    return undefined
  }

  // 3. 语义化插槽名称匹配
  if (
    lowerName === 'chat history' || lowerName === 'chathistory' ||
    lowerName.includes('聊天记录【系统锚点】') || lowerName.includes('正文历史插槽') ||
    lowerName.includes('对话历史插槽')
  ) {
    return 'marker.history'
  }

  if (
    lowerName.includes('world info') || lowerName.includes('worldinfo') ||
    lowerName.includes('世界书【系统锚点】') || lowerName.includes('设定库资料插槽') ||
    lowerName.includes('世界书插槽')
  ) {
    return 'marker.knowledge'
  }

  if (
    lowerId === 'agenttask' || lowerId === 'agent_task' || lowerId === 'input' || lowerId === 'userinput' ||
    lowerName.includes('agent task') || lowerName.includes('agenttask') ||
    lowerName.includes('作者任务与指令插槽') || lowerName.includes('作者任务插槽') ||
    lowerName.includes('用户输入插槽') ||
    content === '【本次写作任务】' || content === '【作者任务】'
  ) {
    return 'marker.task'
  }

  if (lowerId.includes('outline') || lowerName.includes('大纲插槽') || lowerName.includes('大纲注入')) {
    return 'marker.outlines'
  }

  if (lowerId.includes('style_sample') || lowerName.includes('文风样本') || lowerName.includes('风格样本')) {
    return 'marker.style_samples'
  }

  if (lowerId.includes('project_rules') || lowerName.includes('全书准则') || lowerName.includes('创作规则')) {
    return 'marker.project_rules'
  }

  return undefined
}

/**
 * 从 SillyTavern 的 prompt_order 配置中提取有序映射。
 * 支持 SillyTavern 的标准 character 组（如 character_id: 100001 包含 order 数组）、
 * 扁平对象数组（包含 identifier 与 enabled）以及纯字符串标识符数组。
 */
export function extractPromptOrderMap(promptOrder: unknown): Map<string, { order: number; enabled?: boolean }> {
  const map = new Map<string, { order: number; enabled?: boolean }>()
  if (!Array.isArray(promptOrder)) return map

  let list = promptOrder
  const characterGroup = promptOrder.find(
    (item) => item && typeof item === 'object' && Array.isArray((item as any).order)
  ) as { order: any[] } | undefined

  if (characterGroup && Array.isArray(characterGroup.order)) {
    list = characterGroup.order
  }

  list.forEach((entry: any, index: number) => {
    if (!entry) return
    const id = typeof entry === 'string' ? entry : (entry.identifier || entry.id)
    if (typeof id === 'string' && id.trim()) {
      map.set(id.trim(), {
        order: index,
        enabled: typeof entry === 'object' && typeof entry.enabled === 'boolean' ? entry.enabled : undefined
      })
    }
  })

  return map
}

/**
 * 提取启用的 Block 中声明的酒馆局部与全局变量宏 (setvar / setglobalvar)。
 */
export function resolveTavernVariables(prompts: Array<{
  identifier?: string
  id?: string
  content?: string
  enabled?: boolean
}>): Map<string, string> {
  const vars = new Map<string, string>()
  const setvarRegex = /\{\{\s*(?:setvar|setglobalvar)::([^:]+)::([\s\S]*?)\}\}/gi
  for (const p of prompts) {
    if (p.enabled === false) continue
    const text = String(p.content ?? '')
    let m: RegExpExecArray | null
    setvarRegex.lastIndex = 0
    while ((m = setvarRegex.exec(text)) !== null) {
      vars.set(m[1].trim(), m[2])
    }
  }
  return vars
}

/**
 * 解析 SillyTavern Preset JSON 或导出的 NovelPromptPreset
 */
export function parseTavernPreset(jsonContent: string, fallbackName?: string): NovelPromptPreset {
  let parsed: any
  try {
    parsed = JSON.parse(jsonContent)
  } catch {
    throw new ProjectError('VALIDATION_ERROR', '无效的 JSON 内容，无法解析预设文件')
  }

  // 1. 如果已经是本项目的 NovelPromptPreset
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks) && typeof parsed.name === 'string') {
    const validated = NovelPromptPresetSchema.safeParse(parsed)
    if (validated.success) {
      return {
        ...validated.data,
        name: validated.data.name || fallbackName?.trim() || '酒馆导入预设',
        id: randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    }
  }

  // 2. 解析 SillyTavern Preset 结构
  const presetName =
    (typeof parsed?.name === 'string' && parsed.name.trim()) ||
    (typeof fallbackName === 'string' && fallbackName.trim()) ||
    '酒馆导入预设'
  const presetDescription = typeof parsed?.description === 'string' ? parsed.description.trim() : undefined

  let rawPrompts: any[] = []
  if (Array.isArray(parsed?.prompts)) {
    rawPrompts = parsed.prompts
  } else if (typeof parsed?.system_prompt === 'string') {
    rawPrompts = [{ identifier: 'main', name: '系统提示词', role: 'system', content: parsed.system_prompt, enabled: true }]
  } else if (Array.isArray(parsed)) {
    rawPrompts = parsed
  } else {
    throw new ProjectError('VALIDATION_ERROR', '未在文件中识别到有效的酒馆预设 (prompts) 结构')
  }

  // 读取 prompt_order 排序
  const orderMap = extractPromptOrderMap(parsed?.prompt_order)

  let autoOrder = 0
  const normalizedPrompts = rawPrompts
    .filter((raw) => raw && typeof raw === 'object')
    .map((raw) => {
      const identifier = raw.identifier || raw.id || randomUUID()
      const orderInfo = orderMap.get(identifier)
      const order = orderInfo !== undefined ? orderInfo.order : (Number(raw.injection_order) || autoOrder)
      autoOrder++
      const enabled = orderInfo?.enabled !== undefined ? orderInfo.enabled : Boolean(raw.enabled ?? true)
      return { raw, identifier, order, enabled }
    })
    .sort((a, b) => a.order - b.order)

  // 提取所有启用 Block 中声明的变量
  const variables = resolveTavernVariables(
    normalizedPrompts.map((p) => ({
      identifier: p.identifier,
      content: p.raw.content,
      enabled: p.enabled
    }))
  )

  const getvarRegex = /\{\{\s*(?:getvar|getglobalvar)::([^}]+)\}\}/gi
  const setvarStripRegex = /\{\{\s*(?:setvar|setglobalvar)::([^:]+)::([\s\S]*?)\}\}/gi

  const blocks: PresetBlock[] = []

  for (const item of normalizedPrompts) {
    const { raw, identifier, order, enabled } = item
    const name = raw.name || raw.identifier || `Block ${blocks.length + 1}`
    const rawRole = String(raw.role || (raw.system_prompt === true ? 'system' : 'system')).toLowerCase()
    const role: 'system' | 'user' | 'assistant' = rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system'

    // 剔除 setvar 声明并在各处展开替换 getvar
    let text = String(raw.content ?? '').replace(setvarStripRegex, '')
    for (let pass = 0; pass < 3; pass++) {
      if (!getvarRegex.test(text)) break
      getvarRegex.lastIndex = 0
      text = text.replace(getvarRegex, (_, key) => variables.get(key.trim()) ?? '')
    }

    const cleanedContent = cleanTavernContent(text)
    const marker = detectBlockMarker({ ...raw, identifier, name, content: cleanedContent })

    const isChat = raw.injection_position === 1 || raw.injection_position === 'in_chat' || raw.injection_position === 'chat'
    const depth = Math.max(0, Number(raw.injection_depth) || 0)

    // 纯变量声明/求值后内容为空且非系统插槽的 Block，保留在列表中但默认置为关闭状态
    const isContentEmpty = cleanedContent.trim() === ''
    const finalEnabled = isContentEmpty && !marker ? false : enabled

    blocks.push({
      id: randomUUID(),
      name,
      role,
      content: cleanedContent,
      enabled: finalEnabled,
      position: isChat ? 'in_chat' : 'relative',
      depth,
      order,
      marker
    })
  }

  // 排序
  blocks.sort((a, b) => a.order - b.order)

  // 检查是否缺失核心小说资料插槽：设定库、正文历史、作者任务
  const hasKnowledge = blocks.some((b) => b.marker === 'marker.knowledge')
  const hasHistory = blocks.some((b) => b.marker === 'marker.history')
  const hasTask = blocks.some((b) => b.marker === 'marker.task')

  if (!hasKnowledge) {
    blocks.push({
      id: randomUUID(),
      name: '设定库资料插槽',
      role: 'user',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: blocks.length + 1,
      marker: 'marker.knowledge'
    })
  }

  if (!hasHistory) {
    blocks.push({
      id: randomUUID(),
      name: '会话与正文历史插槽',
      role: 'user',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: blocks.length + 2,
      marker: 'marker.history'
    })
  }

  if (!hasTask) {
    blocks.push({
      id: randomUUID(),
      name: '作者任务与指令插槽',
      role: 'user',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: blocks.length + 3,
      marker: 'marker.task'
    })
  }

  // 重新归一化 order 为 0, 1, 2...
  blocks.forEach((block, index) => {
    block.order = index
  })

  return {
    id: randomUUID(),
    name: presetName,
    description: presetDescription,
    blocks,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}
