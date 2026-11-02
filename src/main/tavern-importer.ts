import { randomUUID } from 'node:crypto'
import {
  NovelPromptPresetSchema,
  SOLIUMBRA_TOOL_NAME,
  type NovelPromptPreset,
  type PresetBlock,
  type PresetToolCalling
} from '../shared/prompt-settings.js'
import { ProjectError } from './project-store.js'

const ANGLE_BLOCK_MAX_LENGTH = 262_144

/**
 * 单遍扫描并替换所有 `<<<...>>>` 宏块。
 *
 * 为什么不用正则：懒惰模式 `<<<[\s\S]*?>>>` 在没有闭合符的输入上是 O(n²)
 * （1MB 的 `<<<` 洪水实测让主进程卡死数分钟），而预设内容来自用户导入的
 * 不可信文件。这里用两个只前进的指针做线性扫描；单个块超过
 * ANGLE_BLOCK_MAX_LENGTH 时按普通文本保留而不是吞掉后续内容。
 * visit 返回替换文本，返回 null 表示保留原块。
 */
function replaceAngleBlocks(text: string, visit: (inner: string) => string | null): string {
  let result = ''
  let cursor = 0
  let openIdx = text.indexOf('<<<')
  let closeIdx = text.indexOf('>>>')
  while (openIdx >= 0) {
    while (closeIdx >= 0 && closeIdx < openIdx + 3) closeIdx = text.indexOf('>>>', closeIdx + 3)
    if (closeIdx < 0) break // 闭符已耗尽，之后不会再有完整宏块
    if (closeIdx + 3 - openIdx > ANGLE_BLOCK_MAX_LENGTH) {
      result += text.slice(cursor, openIdx + 3)
      cursor = openIdx + 3
      openIdx = text.indexOf('<<<', cursor)
      continue
    }
    result += text.slice(cursor, openIdx)
    const inner = text.slice(openIdx + 3, closeIdx)
    const replacement = visit(inner)
    result += replacement === null ? text.slice(openIdx, closeIdx + 3) : replacement
    cursor = closeIdx + 3
    openIdx = text.indexOf('<<<', cursor)
    closeIdx = text.indexOf('>>>', cursor)
  }
  result += text.slice(cursor)
  return result
}

const DEEPTHINK_REPLACEMENT = '【深度思考要求：在输出正式内容之前，必须进行详尽充分的深入思考与剧情推演。】'

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

  // 0.1 猫之神 / SPreset 宏处理与转换。所有 `<<<...>>>` 块最终都被移除：
  // deepthink 换成中文指令，setLastMessage 保留正文，其余（含 registerPart，另由
  // collectRegisterPart 在清洗前收集）直接丢弃。
  text = replaceAngleBlocks(text, (inner) => {
    if (/^\|\s*catgodml\s*\|\s*deepthink\s*$/i.test(inner)) return DEEPTHINK_REPLACEMENT
    const setLastMessage = inner.match(/^\|\s*catgodml\s*\|\s*setLastMessage:([\s\S]*)$/i)
    return setLastMessage ? setLastMessage[1].replace(/^\s+/, '').replace(/\s+$/, '') : ''
  })
  text = text
    .replace(/\{\{\s*SPreset::[^}]*?\}\}/gi, '')
    .replace(/<run_tool_replacement>/gi, '')
    .replace(/<\|sep\|>|<\|merge\|>/gi, '')

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
 * 收集 prompt 正文中的 registerPart 工具部件声明（部件名 → 字段描述）。
 * 必须在 cleanTavernContent 剥离该宏之前调用；同名部件首个生效，
 * 与酒馆 FinalRequestProcessing 脚本的组装行为一致。
 * 复用 replaceAngleBlocks 的线性扫描，避免对不可信文本跑懒惰正则。
 */
function collectRegisterPart(text: string, parts: Map<string, string>): void {
  if (!text) return
  replaceAngleBlocks(text, (inner) => {
    const m = inner.match(/^\|\s*catgodml\s*\|\s*registerPart:([^:]+):([\s\S]*)$/i)
    if (m) {
      const name = m[1].trim()
      if (name && !parts.has(name)) parts.set(name, m[2].trim())
    }
    return null // 只收集，不替换；剔除由 cleanTavernContent 完成
  })
}

interface ToolBindingFormParam {
  name?: string
  type?: string
  description?: string
  required?: boolean
}
interface ToolBindingForm {
  name?: string
  description?: string
  parameters?: ToolBindingFormParam[]
}

/**
 * 从预设的结构化声明解析工具调用配置：extensions.ToolBindings（表单定义的基础参数）
 * 加上 prompt 正文中的 registerPart 宏（酒馆在请求期动态追加的部件），
 * 组装成随请求发送的 parameters JSON Schema。声明缺失时回退到关键词启发式。
 */
function detectPresetToolCalling(
  parsed: any,
  presetName: string,
  jsonContent: string,
  registerParts: Map<string, string>
): PresetToolCalling | undefined {
  // SPreset 扩展把工具绑定挂在 extensions/SPreset 下，裸 extensions/ToolBindings 亦兼容
  const bindings = parsed?.extensions?.SPreset?.ToolBindings ?? parsed?.extensions?.ToolBindings
  if (bindings && typeof bindings === 'object') {
    for (const binding of Object.values<any>(bindings)) {
      if (!binding || binding.enabled !== true || binding.valid !== true) continue
      const form = binding.form as ToolBindingForm | undefined
      const name = String(binding.resolvedName || form?.name || '').trim()
      if (!name) continue

      // 无原型对象：参数名来自不可信预设（如 toString/__proto__），普通对象会被
      // 继承属性误判重复或触发 __proto__ setter 导致参数静默丢失
      const properties: Record<string, unknown> = Object.create(null)
      const required: string[] = []
      for (const param of Array.isArray(form?.parameters) ? form!.parameters! : []) {
        const paramName = String(param?.name || '').trim()
        if (!paramName || Object.hasOwn(properties, paramName)) continue
        properties[paramName] = {
          type: String(param?.type || 'string'),
          ...(param?.description ? { description: String(param.description) } : {})
        }
        if (param?.required === true) required.push(paramName)
      }
      // registerPart 部件覆盖同名基础参数，但不强制 required——刻意比酒馆源脚本宽松，见 docs/adr/0008
      for (const [partName, partDesc] of registerParts) {
        properties[partName] = { type: 'string', description: partDesc || `${partName} content` }
      }

      return {
        enabled: true,
        name,
        ...(form?.description ? { description: String(form.description) } : {}),
        parameters: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
      }
    }
  }

  if (registerParts.size > 0) {
    // 同上：部件名来自不可信预设正文，必须用无原型对象承载
    const properties: Record<string, unknown> = Object.create(null)
    for (const [partName, partDesc] of registerParts) {
      properties[partName] = { type: 'string', description: partDesc || `${partName} content` }
    }
    return {
      enabled: true,
      name: SOLIUMBRA_TOOL_NAME,
      parameters: { type: 'object', properties }
    }
  }

  const contentLower = jsonContent.toLowerCase()
  if (
    contentLower.includes(SOLIUMBRA_TOOL_NAME) ||
    contentLower.includes('<run_tool_replacement>') ||
    contentLower.includes('小猫之神会使用reply工具') ||
    /meowssiah|猫之神|soliumbra/i.test(presetName)
  ) {
    return {
      enabled: true,
      name: SOLIUMBRA_TOOL_NAME
    }
  }

  if (Array.isArray(parsed?.tools) && parsed.tools.length > 0) {
    const firstTool = parsed.tools[0]
    const toolName = firstTool?.function?.name || firstTool?.name || 'novel_reply'
    return {
      enabled: true,
      name: toolName,
      description: firstTool?.function?.description || firstTool?.description,
      parameters: firstTool?.function?.parameters || firstTool?.parameters
    }
  }

  return undefined
}

/**
 * 识别 Block 是否属于小说资料插槽
 */
export function detectBlockMarker(prompt: {
  identifier?: string
  name?: string
  content?: string
  rawContent?: string
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
  const rawText = String(prompt.rawContent ?? prompt.content ?? '')

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
    content === '【本次写作任务】' || content === '【作者任务】' || content.includes('【作者任务】') ||
    rawText.includes('setLastMessage') || rawText.includes('{{lastUserMessage}}') || rawText.includes('{{last_user_message}}')
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

export interface TavernPromptOrder {
  /** identifier → 序号（0 起，按 prompt_order 内出现顺序）与显式启停（undefined 表示未声明） */
  orders: Map<string, { order: number; enabled?: boolean }>
  /**
   * 参与排序的列表长度。0 表示预设没有可用的 prompt_order；AI 转换路径据此区分
   * "有排序列表但条目缺席（视为停用）"与"没有排序列表（回退条目自身 enabled）"。
   */
  listLength: number
}

/**
 * 统一解析 SillyTavern 的 prompt_order 配置（快速导入与 AI 转换两条路径共用）。
 * 支持 SillyTavern 的标准 character 组（如 character_id: 100001，数字或字符串）、
 * 扁平对象数组（包含 identifier 与 enabled）以及纯字符串标识符数组。
 */
export function resolveTavernPromptOrder(promptOrder: unknown): TavernPromptOrder {
  const orders = new Map<string, { order: number; enabled?: boolean }>()
  if (!Array.isArray(promptOrder)) return { orders, listLength: 0 }

  const groups = promptOrder
  const characterGroup = (
    groups.find(
      (item) => item && typeof item === 'object' && ((item as any).character_id === 100001 || (item as any).character_id === '100001') && Array.isArray((item as any).order) && (item as any).order.length > 0
    ) ||
    groups.find(
      (item) => item && typeof item === 'object' && Array.isArray((item as any).order) && (item as any).order.length > 0
    ) ||
    groups.find(
      (item) => item && typeof item === 'object' && Array.isArray((item as any).order)
    )
  ) as { order: any[] } | undefined

  const list = characterGroup ? characterGroup.order : groups
  list.forEach((entry: any, index: number) => {
    if (!entry) return
    const id = typeof entry === 'string' ? entry : (entry.identifier || entry.id)
    if (typeof id === 'string' && id.trim()) {
      orders.set(id.trim(), {
        order: index,
        enabled: typeof entry === 'object' && typeof entry.enabled === 'boolean' ? entry.enabled : undefined
      })
    }
  })

  return { orders, listLength: list.length }
}

/**
 * 从 SillyTavern 的 prompt_order 配置中提取有序映射（仅映射；需要列表长度用 resolveTavernPromptOrder）。
 */
export function extractPromptOrderMap(promptOrder: unknown): Map<string, { order: number; enabled?: boolean }> {
  return resolveTavernPromptOrder(promptOrder).orders
}

/**
 * 剥离 setvar 声明宏并展开 getvar 引用（最多 3 遍，支持变量嵌套）。
 * 快速导入与 AI 转换两条路径共用；onUnresolved 是两者唯一的有意分歧：
 * - 'empty'：快速导入把未解析的 getvar 清空（与酒馆运行时行为一致）
 * - 'keep'：AI 转换保留 {{getvar::key}} 原样，交由编译期校验兜底
 */
export function expandTavernVariables(
  text: string,
  variables: Map<string, string>,
  onUnresolved: 'empty' | 'keep'
): string {
  const getvarRegex = /\{\{\s*(?:getvar|getglobalvar)::([^}]+)\}\}/gi
  const setvarStripRegex = /\{\{\s*(?:setvar|setglobalvar)::([^:]+)::([\s\S]*?)\}\}/gi
  let result = text.replace(setvarStripRegex, '')
  for (let pass = 0; pass < 3; pass++) {
    if (!getvarRegex.test(result)) break
    getvarRegex.lastIndex = 0
    result = result.replace(getvarRegex, (_, key: string) => {
      const resolved = variables.get(key.trim())
      if (resolved !== undefined) return resolved
      return onUnresolved === 'keep' ? `{{getvar::${key.trim()}}}` : ''
    })
  }
  return result
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
    // 去 BOM：Windows 导出的 JSON 常带 \uFEFF，AI 转换路径（preset-conversion）同样处理
    parsed = JSON.parse(jsonContent.replace(/^\uFEFF/, ''))
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
      // Number.isFinite 而非真值判断：显式 injection_order: 0 也是合法序号
      const injectedOrder = Number(raw.injection_order)
      const order = orderInfo !== undefined ? orderInfo.order : (Number.isFinite(injectedOrder) ? injectedOrder : autoOrder)
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

  const blocks: PresetBlock[] = []
  const registerParts = new Map<string, string>()

  for (const item of normalizedPrompts) {
    const { raw, identifier, order, enabled } = item
    // String() 兜底：不可信预设里 name/identifier 可能是数字等非字符串
    const name = String(raw.name ?? '').trim() || String(raw.identifier ?? '').trim() || `Block ${blocks.length + 1}`
    const rawRole = String(raw.role || (raw.system_prompt === true ? 'system' : 'system')).toLowerCase()
    const role: 'system' | 'user' | 'assistant' = rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system'

    // 剔除 setvar 声明并展开替换 getvar（未解析的引用置空）
    const text = expandTavernVariables(String(raw.content ?? ''), variables, 'empty')

    // 仅启用的 prompt 会被酒馆发送，其 registerPart 部件声明才有效；须在清洗剥离宏之前收集
    if (enabled) collectRegisterPart(text, registerParts)

    const cleanedContent = cleanTavernContent(text)
    const marker = detectBlockMarker({ ...raw, identifier, name, content: cleanedContent, rawContent: text })

    const isChat = raw.injection_position === 1 || raw.injection_position === 'in_chat' || raw.injection_position === 'chat'
    const depth = Math.max(0, Number(raw.injection_depth) || 0)

    // 纯变量声明/求值后内容为空且非系统插槽的 Block，或 SPreset 扩展配置，保留在列表中但默认置为关闭状态
    const isSPresetConfig = identifier === 'SPresetSettings' || name.toLowerCase().includes('spreset') || cleanedContent.startsWith('{"ChatSquash"')
    const isPureTaskMacro = marker === 'marker.task' && (cleanedContent === '【作者任务】' || cleanedContent === '【本次写作任务】')
    const finalContent = isPureTaskMacro ? '' : cleanedContent
    const isContentEmpty = finalContent.trim() === ''
    const finalEnabled = isSPresetConfig ? false : (isContentEmpty && !marker ? false : enabled)
    const finalRole: 'system' | 'user' | 'assistant' = marker === 'marker.task' ? 'user' : role

    blocks.push({
      id: randomUUID(),
      name,
      role: finalRole,
      content: finalContent,
      enabled: finalEnabled,
      position: isChat ? 'in_chat' : 'relative',
      depth,
      order,
      marker
    })
  }

  // 排序并重新归一化 order 为 0, 1, 2...
  blocks.sort((a, b) => a.order - b.order)
  blocks.forEach((block, index) => {
    block.order = index
  })

  const detectedToolCalling = detectPresetToolCalling(parsed, presetName, jsonContent, registerParts)

  return {
    id: randomUUID(),
    name: presetName,
    description: presetDescription,
    blocks,
    toolCalling: detectedToolCalling,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}
