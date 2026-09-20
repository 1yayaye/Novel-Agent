import { createHash, randomUUID } from 'node:crypto'
import { ProjectError, type ProjectStore } from './project-store'
import type { ConnectionStore } from './connection-store'
import type { ModelGateway } from './model-gateway'
import type { SearchIndex } from './search-index'
import { DEFAULT_STAGE_PROMPT_SLOTS } from './default-presets'
import type {
  AssembledMessage,
  ChatWorkflowStage,
  ChatWorkflowType,
  ContextItem,
  ContextItemSourceType,
  ContextPackage,
  ContextPreviewInput,
  DirectorControls,
  ExcludedContextItem,
  PromptSlot,
  PromptSlotPosition,
  PromptSlotRole,
  TaskType
} from '../shared/project'

function estimateTokens(text: string, ratio = 1.3): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length * ratio))
}

interface MacroContext {
  chapterTitle?: string
  chapterNumber?: number
  targetLength?: number
  targetText?: string
  creativeRules?: string
  bookSynopsis?: string
  bookOutline?: string
  volumeOutline?: string
  chapterOutline?: string
  authorInstruction?: string
  store: ProjectStore
  sessionId: string
}

export function expandMacros(template: string, ctx: MacroContext, warnings: string[]): string {
  if (!template) return ''
  return template.replace(/\{\{([^{}]+)\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim()
    if (key === 'chapter_title') return ctx.chapterTitle ?? ''
    if (key === 'chapter_number') return ctx.chapterNumber !== undefined ? String(ctx.chapterNumber) : ''
    if (key === 'target_length') return ctx.targetLength ? String(ctx.targetLength) : ''
    if (key === 'target_text') return ctx.targetText ?? ''
    if (key === 'creative_rules') return ctx.creativeRules ?? ''
    if (key === 'book_synopsis') return ctx.bookSynopsis ?? ''
    if (key === 'book_outline') return ctx.bookOutline ?? ''
    if (key === 'volume_outline') return ctx.volumeOutline ?? ''
    if (key === 'chapter_outline') return ctx.chapterOutline ?? ''
    if (key === 'author_instruction') return ctx.authorInstruction ?? ''

    // {{previous_paragraphs count=3}}
    const prevMatch = key.match(/^previous_paragraphs(?:\s+count=(\d+))?$/)
    if (prevMatch) {
      const count = prevMatch[1] ? parseInt(prevMatch[1], 10) : 3
      const paragraphs = (ctx.targetText ?? '')
        .split(/\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      return paragraphs.slice(-count).join('\n\n')
    }

    // {{character_card name="张三"}}
    const charMatch = key.match(/^character_card\s+name=["']([^"']+)["']$/)
    if (charMatch) {
      const charName = charMatch[1].trim()
      let charContent = ''
      ctx.store.read(ctx.sessionId, (db) => {
        const row = db
          .prepare(
            "SELECT author_content FROM knowledge_entry WHERE knowledge_kind = 'character' AND title = ? AND state = 'active' LIMIT 1"
          )
          .get(charName) as { author_content: string } | undefined
        if (row) charContent = row.author_content
      })
      return charContent
    }

    warnings.push(`未知宏变量: {{${key}}}，已保留原样`)
    return match
  })
}

export function compileDirectorControls(controls?: DirectorControls): PromptSlot[] {
  if (!controls) return []
  const slots: PromptSlot[] = []

  if (controls.pov) {
    let content = ''
    if (controls.pov === 'limited_3p') {
      content = '【叙事视角】第三人称主角限制视角。仅描写主角感知范围内的心理、行为与事态，禁止全知上帝视角越权描写。'
    } else if (controls.pov === 'omniscient_3p') {
      content = '【叙事视角】第三人称全知视角。展现宏观战局与多方动态。'
    } else if (controls.pov === 'first_person') {
      content = '【叙事视角】第一人称自白。以“我”的视角与口吻展开叙事。'
    }
    slots.push({
      id: 'director-pov',
      name: 'POV 视角锚定',
      enabled: true,
      role: 'system',
      content,
      position: 'after_context',
      order: 10,
      trigger: 'always'
    })
  }

  if (controls.sensory) {
    const content =
      controls.sensory === 'strict'
        ? '【感官边界】严格防全知边界。只书写角色此刻身体直接感知到的一切（目之所视、耳之所闻），未经验证的情形不可预知。'
        : '【感官边界】宽松感知。允许在情境需要时适度交代周围环境的整体氛围。'
    slots.push({
      id: 'director-sensory',
      name: '感官边界',
      enabled: true,
      role: 'system',
      content,
      position: 'after_context',
      order: 20,
      trigger: 'always'
    })
  }

  if (controls.pacing) {
    let content = ''
    if (controls.pacing === 'fast') content = '【叙事节奏】快节奏推进。突出核心动作与冲突碰撞，精炼过渡。'
    else if (controls.pacing === 'slow') content = '【叙事节奏】慢热铺垫。强化氛围烘托、细腻白描与心理留白。'
    else content = '【叙事节奏】平稳推进。叙事详略得当，张弛有度。'
    slots.push({
      id: 'director-pacing',
      name: '叙事节奏',
      enabled: true,
      role: 'system',
      content,
      position: 'after_context',
      order: 30,
      trigger: 'always'
    })
  }

  if (controls.initiative) {
    const content =
      controls.initiative === 'follow_input'
        ? '【交互规则】严格遵循作者输入与指令，不擅自替作者角色越权决策。'
        : '【交互规则】允许根据情境合理丰富在场角色的动作与互动细节。'
    slots.push({
      id: 'director-initiative',
      name: '交互规则',
      enabled: true,
      role: 'system',
      content,
      position: 'after_context',
      order: 40,
      trigger: 'always'
    })
  }

  if (controls.banWords && controls.banWords.length > 0) {
    slots.push({
      id: 'director-ban-words',
      name: '杀八股禁词表',
      enabled: true,
      role: 'system',
      content: `【禁忌词汇】严禁在生成中使用以下词汇或八股句式：${controls.banWords.join('、')}`,
      position: 'after_context',
      order: 50,
      trigger: 'always'
    })
  }

  if (controls.enableCoT === true) {
    slots.push({
      id: 'director-cot',
      name: '写前推演检查',
      enabled: true,
      role: 'system',
      content: '【写前推演】在正式输出前，请先简要检查：1.人物动机与性格一致性 2.视角与感官边界合规 3.情境过渡平滑。',
      position: 'after_context',
      order: 60,
      trigger: 'always'
    })
  }

  return slots
}

export class ContextAssembler {
  constructor(
    private readonly store: ProjectStore,
    private readonly searchIndex: SearchIndex,
    private readonly connectionStore: ConnectionStore,
    private readonly modelGateway?: ModelGateway
  ) {}

  /**
   * Main entrypoint to assemble an immutable ContextPackage.
   * SPEC 7.2, 7.3, 7.4 & PROMPT SPEC v2.0
   */
  async assembleContext(input: ContextPreviewInput): Promise<ContextPackage> {
    const { sessionId, connectionId, taskType, stage, workflowType, outlineId, outlineVersion } = input
    const instruction = (input.instruction || '').trim()
    const warnings: string[] = []

    // 1. Read connection configuration
    const { connection } = this.connectionStore.getInternal(connectionId)
    const contextWindow = connection.contextWindow || 128000
    const maxOutputTokens = connection.maxOutputTokens || 4096
    const safetyMarginRatio = connection.safetyMarginRatio ?? 0.1
    const tokenEstimationRatio = connection.tokenEstimationRatio || 1.3

    const safetyMargin = Math.floor(contextWindow * safetyMarginRatio)
    const availableInputTokens = Math.max(0, contextWindow - maxOutputTokens - safetyMargin)

    // 2. Read project & target chapter version
    let targetChapter: { id: string; title: string; content: string; version: number; position: number } | undefined
    let targetText = ''

    this.store.read(sessionId, (db) => {
      if (input.target?.chapterId) {
        const chap = db
          .prepare('SELECT id, title, content, version, position, deleted_at FROM chapter WHERE id = ?')
          .get(input.target.chapterId) as {
          id: string
          title: string
          content: string
          version: number
          position: number
          deleted_at: number | null
        } | undefined

        if (!chap || chap.deleted_at !== null) {
          throw new ProjectError('VALIDATION_ERROR', '目标章节不存在或已被删除')
        }

        targetChapter = chap

        const start = input.target.startOffset ?? 0
        const end = input.target.endOffset ?? chap.content.length

        if (taskType === 'continue') {
          targetText = chap.content.slice(0, start > 0 ? start : chap.content.length)
        } else if (taskType === 'rewrite' || taskType === 'polish') {
          targetText = chap.content.slice(start, end)
        } else {
          targetText = chap.content
        }
      }
    })

    const targetVersion = targetChapter?.version

    // Read Creative Rules & Synopsis for Macro Context
    let creativeRulesText = ''
    if (input.includeCreativeRules !== false) {
      this.store.read(sessionId, (db) => {
        const meta = db.prepare('SELECT creative_rules FROM project_meta LIMIT 1').get() as
          | { creative_rules: string }
          | undefined
        if (meta && meta.creative_rules.trim().length > 0) {
          creativeRulesText = meta.creative_rules.trim()
        }
      })
    }

    let bookSynopsisText = ''
    this.store.read(sessionId, (db) => {
      const synopsis = db
        .prepare("SELECT id, summary FROM book_synopsis WHERE state = 'current' LIMIT 1")
        .get() as { id: string; summary: string } | undefined
      if (synopsis) {
        bookSynopsisText = synopsis.summary
      }
    })

    // Read 3-Layer Outlines (book_outline, volume_outline, chapter_outline)
    let bookOutlineText = ''
    let currentBookOutline: { id: string; content: string; version: number; state: string } | undefined
    this.store.read(sessionId, (db) => {
      const row = db
        .prepare(
          "SELECT id, content, version, state FROM book_outline WHERE state IN ('confirmed', 'current') ORDER BY updated_at DESC LIMIT 1"
        )
        .get() as { id: string; content: string; version: number; state: string } | undefined
      if (row) {
        currentBookOutline = row
        bookOutlineText = row.content
      } else {
        const draft = db
          .prepare(
            "SELECT id, content, version, state FROM book_outline WHERE state != 'stale' ORDER BY updated_at DESC LIMIT 1"
          )
          .get() as { id: string; content: string; version: number; state: string } | undefined
        if (draft) {
          currentBookOutline = draft
          bookOutlineText = draft.content
        }
      }
    })

    let volumeOutlineText = ''
    let currentVolumeOutline: { id: string; title: string; content: string; version: number; state: string } | undefined
    this.store.read(sessionId, (db) => {
      if (targetChapter) {
        const chapOutline = db
          .prepare(
            "SELECT volume_id FROM chapter_outline WHERE chapter_id = ? AND state != 'stale' ORDER BY version DESC LIMIT 1"
          )
          .get(targetChapter.id) as { volume_id: string | null } | undefined
        if (chapOutline?.volume_id) {
          const vol = db
            .prepare("SELECT id, title, content, version, state FROM volume_outline WHERE id = ? AND state != 'stale'")
            .get(chapOutline.volume_id) as
            | { id: string; title: string; content: string; version: number; state: string }
            | undefined
          if (vol) {
            currentVolumeOutline = vol
            volumeOutlineText = vol.content
          }
        }
      }
      if (!currentVolumeOutline) {
        const vol = db
          .prepare(
            "SELECT id, title, content, version, state FROM volume_outline WHERE state IN ('confirmed', 'current') ORDER BY position ASC LIMIT 1"
          )
          .get() as
          | { id: string; title: string; content: string; version: number; state: string }
          | undefined
        if (vol) {
          currentVolumeOutline = vol
          volumeOutlineText = vol.content
        } else {
          const fallbackVol = db
            .prepare(
              "SELECT id, title, content, version, state FROM volume_outline WHERE state != 'stale' ORDER BY position ASC LIMIT 1"
            )
            .get() as
            | { id: string; title: string; content: string; version: number; state: string }
            | undefined
          if (fallbackVol) {
            currentVolumeOutline = fallbackVol
            volumeOutlineText = fallbackVol.content
          }
        }
      }
    })

    let chapterOutlineText = ''
    let currentChapterOutline: { id: string; chapter_id: string; content: string; version: number; state: string } | undefined
    this.store.read(sessionId, (db) => {
      if (outlineId) {
        const row = db
          .prepare("SELECT id, chapter_id, content, version, state FROM chapter_outline WHERE id = ? AND state != 'stale'")
          .get(outlineId) as
          | { id: string; chapter_id: string; content: string; version: number; state: string }
          | undefined
        if (row) {
          currentChapterOutline = row
          chapterOutlineText = row.content
        }
      } else if (targetChapter) {
        if (outlineVersion) {
          const row = db
            .prepare(
              "SELECT id, chapter_id, content, version, state FROM chapter_outline WHERE chapter_id = ? AND version = ? AND state != 'stale'"
            )
            .get(targetChapter.id, outlineVersion) as
            | { id: string; chapter_id: string; content: string; version: number; state: string }
            | undefined
          if (row) {
            currentChapterOutline = row
            chapterOutlineText = row.content
          }
        } else {
          const confirmed = db
            .prepare(
              "SELECT id, chapter_id, content, version, state FROM chapter_outline WHERE chapter_id = ? AND state IN ('confirmed', 'current') ORDER BY version DESC LIMIT 1"
            )
            .get(targetChapter.id) as
            | { id: string; chapter_id: string; content: string; version: number; state: string }
            | undefined
          if (confirmed) {
            currentChapterOutline = confirmed
            chapterOutlineText = confirmed.content
          } else {
            const latest = db
              .prepare(
                "SELECT id, chapter_id, content, version, state FROM chapter_outline WHERE chapter_id = ? AND state != 'stale' ORDER BY version DESC LIMIT 1"
              )
              .get(targetChapter.id) as
              | { id: string; chapter_id: string; content: string; version: number; state: string }
              | undefined
            if (latest) {
              currentChapterOutline = latest
              chapterOutlineText = latest.content
            }
          }
        }
      }
    })

    // Setup Macro Context
    const macroCtx: MacroContext = {
      chapterTitle: targetChapter?.title,
      chapterNumber: targetChapter?.position,
      targetLength: input.targetLength,
      targetText,
      creativeRules: creativeRulesText,
      bookSynopsis: bookSynopsisText,
      bookOutline: bookOutlineText,
      volumeOutline: volumeOutlineText,
      chapterOutline: chapterOutlineText,
      authorInstruction: instruction,
      store: this.store,
      sessionId
    }

    // Expand macros in author instruction
    const expandedInstruction = expandMacros(instruction, macroCtx, warnings).trim()

    // 3. Compile Prompt Slots & Director Controls (Preserving Array Ordering in Hash)
    const userSlots = input.slots || []
    const defaultStageSlots = stage
      ? DEFAULT_STAGE_PROMPT_SLOTS.filter((ds) => !userSlots.some((us) => us.id === ds.id))
      : []
    const directorSlots = compileDirectorControls(input.directorControls)
    const combinedRawSlots = [...defaultStageSlots, ...userSlots, ...directorSlots]

    const compiledSlots: PromptSlot[] = combinedRawSlots
      .filter((slot) => {
        if (!slot.enabled) return false
        if (!slot.trigger || slot.trigger === 'always') return true
        if (stage && slot.trigger === stage) return true
        if (slot.trigger === taskType) return true
        if (
          slot.trigger === 'creation' &&
          (['continue', 'rewrite', 'polish'].includes(taskType) || stage === 'content')
        )
          return true
        return false
      })
      .map((slot) => ({
        ...slot,
        content: expandMacros(slot.content, macroCtx, warnings)
      }))

    // 4. Compute Configuration Fingerprint (SPEC 7.2 & PROMPT SPEC v2.0)
    // NOTE: Preserving slot array ordering in serializedSlots (without sort) ensures slot reordering changes fingerprint!
    const sortedStyles = (input.styleSampleIds || []).slice().sort().join(',')
    const sortedPinned = (input.pinnedSourceIds || []).slice().sort().join(',')
    const serializedSlots = compiledSlots
      .map((s, idx) => `[${idx}]${s.id}:${s.role}:${s.position}:${s.depth ?? ''}:${s.order}:${s.trigger ?? ''}:${s.content}`)
      .join('|')
    const directorControlsJson = JSON.stringify(input.directorControls || {})

    const fingerprintRaw = [
      connectionId,
      taskType,
      stage || '',
      workflowType || '',
      currentChapterOutline?.id || outlineId || '',
      currentChapterOutline?.version !== undefined ? String(currentChapterOutline.version) : (outlineVersion ? String(outlineVersion) : ''),
      currentBookOutline?.version !== undefined ? String(currentBookOutline.version) : '',
      currentVolumeOutline?.version !== undefined ? String(currentVolumeOutline.version) : '',
      input.target?.chapterId || '',
      input.target?.startOffset ?? '',
      input.target?.endOffset ?? '',
      expandedInstruction,
      input.presetId || '',
      sortedStyles,
      sortedPinned,
      serializedSlots,
      directorControlsJson,
      input.includeCreativeRules !== false ? '1' : '0',
      input.targetLength || '',
      input.creativity || '',
      input.scanDepth || ''
    ].join('|')
    const configurationFingerprint = createHash('sha256').update(fingerprintRaw).digest('hex').slice(0, 24)

    // 5. Map Creativity to Temperature
    let temperature: number | undefined
    if (connection.capabilities.temperature && input.creativity) {
      if (input.creativity === 'low') temperature = 0.3
      else if (input.creativity === 'medium') temperature = 0.7
      else if (input.creativity === 'high') temperature = 1.0
    }

    // 6. Build candidate items across Priority Tiers
    const rawItems: Array<{
      sourceType: ContextItemSourceType
      sourceId: string
      authorityLevel: number
      title: string
      content: string
      selectionReason: string
      fixed: boolean
      isUncuttable: boolean
      slotId?: string
      role?: PromptSlotRole
      positionType?: PromptSlotPosition
      depth?: number
      slotOrder?: number
      activationKey?: string
    }> = []

    // Tier 1: System task template & safety constraints (Uncuttable)
    const systemTemplateText = this.getSystemTemplate(taskType, input.targetLength)
    rawItems.push({
      sourceType: 'system_template',
      sourceId: 'system_template',
      authorityLevel: 1,
      title: '系统任务模板',
      content: systemTemplateText,
      selectionReason: '系统核心任务指示与安全约束模板',
      fixed: true,
      isUncuttable: true
    })

    // Tier 2: Creative Rules (Uncuttable if enabled)
    if (creativeRulesText.length > 0) {
      rawItems.push({
        sourceType: 'creative_rules',
        sourceId: 'creative_rules',
        authorityLevel: 2,
        title: '全书创作规则',
        content: creativeRulesText,
        selectionReason: '作者设定的全书长期创作准则与禁忌规范',
        fixed: true,
        isUncuttable: true
      })
    }

    // Tier 3: Current target text or selection (Uncuttable)
    if (targetText.length > 0 && targetChapter) {
      rawItems.push({
        sourceType: 'target_text',
        sourceId: targetChapter.id,
        authorityLevel: 3,
        title: `目标正文（${targetChapter.title}）`,
        content: targetText,
        selectionReason: taskType === 'continue' ? '待续写前文段落' : '待重写/润色目标正文选区',
        fixed: true,
        isUncuttable: true
      })
    }

    // Tier 4: Current author instruction (Uncuttable)
    if (expandedInstruction.length > 0) {
      rawItems.push({
        sourceType: 'author_instruction',
        sourceId: 'author_instruction',
        authorityLevel: 4,
        title: '本次创作指令',
        content: expandedInstruction,
        selectionReason: '作者针对本次任务输入的特定创作要求',
        fixed: true,
        isUncuttable: true
      })
    }

    // Prompt Slots (Compiled items)
    for (const slot of compiledSlots) {
      rawItems.push({
        sourceType: 'prompt_slot',
        sourceId: slot.id,
        authorityLevel: slot.position === 'before_context' ? 4 : 5,
        title: slot.name,
        content: slot.content,
        selectionReason: `已启用的 Prompt Slot [${slot.name}]`,
        fixed: false,
        isUncuttable: false,
        slotId: slot.id,
        role: slot.role,
        positionType: slot.position,
        depth: slot.depth,
        slotOrder: slot.order
      })
    }

    // Tier 5: Author pinned sources (Fixed)
    if (input.pinnedSourceIds && input.pinnedSourceIds.length > 0) {
      this.store.read(sessionId, (db) => {
        for (const pinnedId of input.pinnedSourceIds!) {
          const chunk = db
            .prepare(
              `
            SELECT cc.id, cc.content, ch.title
            FROM content_chunk cc
            JOIN chapter ch ON ch.id = cc.chapter_id
            WHERE cc.id = ?
          `
            )
            .get(pinnedId) as { id: string; content: string; title: string } | undefined

          if (chunk) {
            rawItems.push({
              sourceType: 'pinned_source',
              sourceId: chunk.id,
              authorityLevel: 5,
              title: `固定片段（${chunk.title}）`,
              content: chunk.content,
              selectionReason: '作者手工固定的参考正文章节片段',
              fixed: true,
              isUncuttable: false
            })
            continue
          }

          const entry = db
            .prepare('SELECT id, title, author_content FROM knowledge_entry WHERE id = ?')
            .get(pinnedId) as { id: string; title: string; author_content: string } | undefined
          if (entry) {
            rawItems.push({
              sourceType: 'pinned_source',
              sourceId: entry.id,
              authorityLevel: 5,
              title: `固定设定（${entry.title}）`,
              content: entry.author_content,
              selectionReason: '作者手工固定的关键设定条目',
              fixed: true,
              isUncuttable: false
            })
          }
        }
      })
    }

    // Tier 6: Author maintained knowledge entry content with Lorebook Aliases Matching
    this.store.read(sessionId, (db) => {
      const activeEntries = db
        .prepare(
          "SELECT id, title, aliases_json, author_content FROM knowledge_entry WHERE state = 'active' AND length(trim(author_content)) > 0"
        )
        .all() as Array<{
        id: string
        title: string
        aliases_json?: string
        author_content: string
      }>

      const scanLimit = input.scanDepth ? Math.min(input.scanDepth * 500, 10000) : 1500
      const recentText = targetText.slice(-scanLimit)
      const combinedScanBuffer = `${expandedInstruction} ${targetChapter?.title || ''} ${recentText}`.toLowerCase()

      for (const entry of activeEntries) {
        if (input.pinnedSourceIds?.includes(entry.id)) continue
        if (rawItems.some((item) => item.sourceId === entry.id)) continue

        let matchedKey: string | null = null
        if (entry.title && entry.title.trim().length > 0 && combinedScanBuffer.includes(entry.title.trim().toLowerCase())) {
          matchedKey = entry.title.trim()
        } else if (entry.aliases_json) {
          try {
            const aliases = JSON.parse(entry.aliases_json) as string[]
            for (const alias of aliases) {
              const trimmed = (alias || '').trim()
              if (trimmed.length >= 2 && combinedScanBuffer.includes(trimmed.toLowerCase())) {
                matchedKey = trimmed
                break
              }
            }
          } catch {}
        }

        if (matchedKey) {
          rawItems.push({
            sourceType: 'knowledge_entry',
            sourceId: entry.id,
            authorityLevel: 6,
            title: `设定条目：${entry.title}`,
            content: entry.author_content,
            selectionReason: `命中实体名称/别名「${matchedKey}」的权威作者设定`,
            fixed: false,
            isUncuttable: false,
            activationKey: matchedKey
          })
        }
      }
    })

    // Tier 7: Instruction preset
    if (input.presetId) {
      this.store.read(sessionId, (db) => {
        const preset = db
          .prepare('SELECT id, name, instruction FROM instruction_preset WHERE id = ?')
          .get(input.presetId) as { id: string; name: string; instruction: string } | undefined
        if (preset) {
          const expandedPreset = expandMacros(preset.instruction, macroCtx, warnings)
          rawItems.push({
            sourceType: 'instruction_preset',
            sourceId: preset.id,
            authorityLevel: 7,
            title: `指令预设：${preset.name}`,
            content: expandedPreset,
            selectionReason: '选用的任务指令通用模板',
            fixed: false,
            isUncuttable: false
          })
        }
      })
    }

    // Tier 8: Selected style samples
    if (input.styleSampleIds && input.styleSampleIds.length > 0) {
      this.store.read(sessionId, (db) => {
        for (const sampleId of input.styleSampleIds!) {
          const sample = db
            .prepare('SELECT id, name, content FROM style_sample WHERE id = ?')
            .get(sampleId) as { id: string; name: string; content: string } | undefined
          if (sample) {
            rawItems.push({
              sourceType: 'style_sample',
              sourceId: sample.id,
              authorityLevel: 8,
              title: `文风参考：${sample.name}`,
              content: sample.content,
              selectionReason: '作者指定的行文风格样本',
              fixed: false,
              isUncuttable: false
            })
          }
        }
      })
    }

    // Tier 9: Chapter summaries & Book synopsis
    this.store.read(sessionId, (db) => {
      if (targetChapter) {
        const currSummary = db
          .prepare(
            "SELECT id, summary FROM chapter_summary WHERE chapter_id = ? AND state = 'current' LIMIT 1"
          )
          .get(targetChapter.id) as { id: string; summary: string } | undefined
        if (currSummary) {
          rawItems.push({
            sourceType: 'chapter_summary',
            sourceId: currSummary.id,
            authorityLevel: 9,
            title: `本章梗概（${targetChapter.title}）`,
            content: currSummary.summary,
            selectionReason: '当前章节最新有效剧情摘要',
            fixed: false,
            isUncuttable: false
          })
        }
      }

      if (bookSynopsisText.length > 0) {
        rawItems.push({
          sourceType: 'book_synopsis',
          sourceId: 'current_synopsis',
          authorityLevel: 9,
          title: '全书宏观梗概',
          content: bookSynopsisText,
          selectionReason: '全书宏观故事脉络大纲',
          fixed: false,
          isUncuttable: false
        })
      }

      // Tier 9: Book Outline, Volume Outline & Chapter Outline (T06)
      if (bookOutlineText.trim().length > 0) {
        rawItems.push({
          sourceType: 'book_outline',
          sourceId: currentBookOutline?.id || 'book_outline',
          authorityLevel: 9,
          title: '全书大纲',
          content: bookOutlineText.trim(),
          selectionReason: `全书故事大纲与宏观主线规划（版本 v${currentBookOutline?.version ?? 1}）`,
          fixed: false,
          isUncuttable: false
        })
      }

      if (volumeOutlineText.trim().length > 0 && currentVolumeOutline) {
        rawItems.push({
          sourceType: 'volume_outline',
          sourceId: currentVolumeOutline.id,
          authorityLevel: 9,
          title: `分卷大纲（${currentVolumeOutline.title}）`,
          content: volumeOutlineText.trim(),
          selectionReason: `当前分卷核心故事线与阶段高潮规划（版本 v${currentVolumeOutline.version}）`,
          fixed: false,
          isUncuttable: false
        })
      }

      if (chapterOutlineText.trim().length > 0 && currentChapterOutline) {
        rawItems.push({
          sourceType: 'chapter_outline',
          sourceId: currentChapterOutline.id,
          authorityLevel: 9,
          title: `章大纲（${targetChapter?.title || '本章'}）`,
          content: chapterOutlineText.trim(),
          selectionReason: `本章场景节拍与冲突规划大纲（版本 v${currentChapterOutline.version}，状态：${currentChapterOutline.state}）`,
          fixed: false,
          isUncuttable: false
        })
      }
    })

    // Tier 10: Hybrid retrieved valid text chunks
    let queriesToSearch: string[] = []
    if (taskType === 'chat') {
      const cleanTokens = expandedInstruction
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
      const ngrams: string[] = []
      for (const token of cleanTokens) {
        if (token.length <= 4) {
          ngrams.push(token)
        } else {
          for (let i = 0; i <= token.length - 2 && ngrams.length < 8; i += 2) {
            ngrams.push(token.slice(i, i + 2))
          }
        }
      }
      queriesToSearch = Array.from(new Set(ngrams)).slice(0, 5)
      if (queriesToSearch.length === 0 && expandedInstruction.length > 0) {
        queriesToSearch = [expandedInstruction]
      }
    } else {
      const q = `${expandedInstruction} ${targetChapter?.title || ''}`.trim()
      if (q) queriesToSearch = [q]
    }

    for (const queryStr of queriesToSearch) {
      if (!queryStr) continue
      try {
        const searchResults = await this.searchIndex.searchHybrid(sessionId, {
          sessionId,
          query: queryStr,
          limit: 8,
          filters: { sourceTypes: ['chapter_chunk'] },
          connectionId
        })

        for (const res of searchResults) {
          if (targetChapter && res.target.chapterId === targetChapter.id) continue
          if (input.pinnedSourceIds?.includes(res.id)) continue
          if (rawItems.some((item) => item.sourceId === res.id)) continue

          rawItems.push({
            sourceType: 'retrieved_chunk',
            sourceId: res.id,
            authorityLevel: 10,
            title: `相关片段（${res.title}）`,
            content: res.excerpt,
            selectionReason: `检索命中的章节片段`,
            fixed: false,
            isUncuttable: false
          })
        }
      } catch {}
    }

    // Tier 11: Non-conflicting AI fact suggestions
    this.store.read(sessionId, (db) => {
      const suggestions = db
        .prepare(
          `
        SELECT s.id, s.display_text, s.normalized_subject
        FROM ai_fact_suggestion s
        WHERE s.state IN ('pending', 'accepted')
        LIMIT 6
      `
        )
        .all() as Array<{ id: string; display_text: string; normalized_subject: string }>

      for (const sug of suggestions) {
        rawItems.push({
          sourceType: 'ai_suggestion',
          sourceId: sug.id,
          authorityLevel: 11,
          title: `AI 事实推断：${sug.normalized_subject}`,
          content: `[AI 推断] ${sug.display_text}`,
          selectionReason: '模型分析提取的辅助事实线索（未冲突）',
          fixed: false,
          isUncuttable: false
        })
      }
    })

    // Tier 12: Chat rolling summary & recent 6 rounds of messages
    if (taskType === 'chat' && input.target?.chatId) {
      this.store.read(sessionId, (db) => {
        const chatId = input.target!.chatId!
        const summary = db
          .prepare(
            'SELECT id, content, author_edited FROM chat_summary WHERE chat_session_id = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(chatId) as { id: string; content: string; author_edited: number } | undefined
        if (summary && summary.content.trim().length > 0) {
          rawItems.push({
            sourceType: 'chat_history',
            sourceId: summary.id,
            authorityLevel: 12,
            title: `会话滚动摘要${summary.author_edited === 1 ? '（作者已修订）' : ''}`,
            content: summary.content,
            selectionReason: '前期对话经过压缩提取的核心上下文摘要',
            fixed: false,
            isUncuttable: false
          })
        }

        const recentMessages = db
          .prepare(
            `
          SELECT id, role, content
          FROM chat_message
          WHERE chat_session_id = ? AND state = 'completed'
          ORDER BY created_at DESC
          LIMIT 12
        `
          )
          .all(chatId) as Array<{ id: string; role: string; content: string }>

        if (recentMessages.length > 0) {
          const chronological = recentMessages.slice().reverse()
          const formattedHistory = chronological
            .map((m) => `${m.role === 'user' ? '作者' : '助手'}: ${m.content}`)
            .join('\n\n')
          rawItems.push({
            sourceType: 'chat_history',
            sourceId: chatId,
            authorityLevel: 12,
            title: '近期对话历史（最近6轮）',
            content: formattedHistory,
            selectionReason: '当前会话最近的多轮上下文问答记录',
            fixed: false,
            isUncuttable: false
          })
        }
      })
    }

    // 7. Token Budget Allocation & Trimming (SPEC 7.3, 7.4)
    const items: ContextItem[] = []
    const excludedItems: ExcludedContextItem[] = []
    const packageId = randomUUID()

    const uncuttableItems = rawItems.filter((i) => i.isUncuttable)
    let uncuttableTokens = 0
    for (const item of uncuttableItems) {
      uncuttableTokens += estimateTokens(item.content, tokenEstimationRatio)
    }

    if (uncuttableTokens > availableInputTokens) {
      throw new ProjectError(
        'MODEL_CONTEXT_EXCEEDED',
        `不可裁剪内容（估算 ${uncuttableTokens} tokens）超出可用输入预算（${availableInputTokens} tokens）。请缩短选区长度或关闭创作规则`
      )
    }

    let currentEstimatedTokens = 0

    let positionIndex = 0
    for (const raw of uncuttableItems) {
      const est = estimateTokens(raw.content, tokenEstimationRatio)
      currentEstimatedTokens += est
      items.push({
        id: randomUUID(),
        contextPackageId: packageId,
        sourceType: raw.sourceType,
        sourceId: raw.sourceId,
        authorityLevel: raw.authorityLevel,
        selectionReason: raw.selectionReason,
        estimatedTokens: est,
        fixed: raw.fixed,
        position: positionIndex++,
        title: raw.title,
        content: raw.content,
        slotId: raw.slotId,
        role: raw.role,
        positionType: raw.positionType,
        depth: raw.depth,
        slotOrder: raw.slotOrder,
        activationKey: raw.activationKey
      })
    }

    const cuttableItems = rawItems
      .filter((i) => !i.isUncuttable)
      .sort((a, b) => a.authorityLevel - b.authorityLevel)

    for (const raw of cuttableItems) {
      const est = estimateTokens(raw.content, tokenEstimationRatio)
      if (currentEstimatedTokens + est <= availableInputTokens) {
        currentEstimatedTokens += est
        items.push({
          id: randomUUID(),
          contextPackageId: packageId,
          sourceType: raw.sourceType,
          sourceId: raw.sourceId,
          authorityLevel: raw.authorityLevel,
          selectionReason: raw.selectionReason,
          estimatedTokens: est,
          fixed: raw.fixed,
          position: positionIndex++,
          title: raw.title,
          content: raw.content,
          slotId: raw.slotId,
          role: raw.role,
          positionType: raw.positionType,
          depth: raw.depth,
          slotOrder: raw.slotOrder,
          activationKey: raw.activationKey
        })
      } else {
        excludedItems.push({
          sourceType: raw.sourceType,
          sourceId: raw.sourceId,
          title: raw.title,
          reason: 'budget_exceeded',
          estimatedTokens: est,
          slotId: raw.slotId
        })
      }
    }

    if (excludedItems.length > 0) {
      warnings.push(`由于 Token 预算限制，已自动裁剪 ${excludedItems.length} 项低优先级上下文`)
    }

    // 8. Full Messages Assembly (SPEC v2.0 - Honors role & depth across all message slots)
    const messages = this.buildAssembledMessages(
      taskType,
      items,
      expandedInstruction,
      input.targetLength,
      input.creativity,
      stage
    )

    // Compute backward-compatible single systemMessage and userMessage strings
    const systemMessage = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const userMessage = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n\n')

    const now = Date.now()
    const contextPackage: ContextPackage = {
      id: packageId,
      taskType,
      stage: stage || null,
      workflowType: workflowType || null,
      outlineId: currentChapterOutline?.id || outlineId || null,
      outlineVersion: currentChapterOutline?.version || outlineVersion || null,
      targetVersion: targetVersion ?? null,
          targetLength: input.targetLength ?? null,
          creativity: input.creativity ? { level: input.creativity, temperature } : null,
          connectionId,
          target: input.target || null,
          configurationFingerprint,
      messages,
      systemMessage,
      userMessage,
      items,
      excludedItems,
      estimatedInputTokens: currentEstimatedTokens,
      availableInputTokens,
      warnings,
      createdAt: now
    }

    // 9. Transactionally persist ContextPackage & ContextItems (Immutable)
    this.store.transaction(sessionId, (db) => {
      const messagesJson = JSON.stringify(messages)
      const warningsJson = JSON.stringify(warnings)
      const targetVersions: Record<string, any> = {}
      if (targetChapter) {
        targetVersions[targetChapter.id] = targetChapter.version
        targetVersions[`chapter:${targetChapter.id}`] = targetChapter.version
      }
      if (currentChapterOutline) {
        targetVersions[`chapter_outline:${currentChapterOutline.id}`] = currentChapterOutline.version
      }
      if (currentBookOutline) {
        targetVersions[`book_outline:${currentBookOutline.id}`] = currentBookOutline.version
      }
      if (currentVolumeOutline) {
        targetVersions[`volume_outline:${currentVolumeOutline.id}`] = currentVolumeOutline.version
      }
      if (stage) {
        targetVersions['_meta:stage'] = stage
      }
      if (workflowType) {
        targetVersions['_meta:workflowType'] = workflowType
      }
      if (taskType) {
        targetVersions['_meta:taskType'] = taskType
      }
      if (currentChapterOutline?.id || outlineId) {
        targetVersions['_meta:outlineId'] = currentChapterOutline?.id || outlineId
      }
      if (currentChapterOutline?.version !== undefined || outlineVersion !== undefined) {
        targetVersions['_meta:outlineVersion'] = currentChapterOutline?.version || outlineVersion
      }
      const targetVersionsJson = JSON.stringify(targetVersions)

      db.prepare(
        `
        INSERT INTO context_package(
          id, messages_json, token_budget, estimated_tokens, warnings_json,
          target_versions_json, target_length, creativity, configuration_fingerprint, created_at,
          task_type, connection_id, excluded_items_json, target_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        packageId,
        messagesJson,
        availableInputTokens,
        currentEstimatedTokens,
        warningsJson,
        targetVersionsJson,
        input.targetLength || null,
        temperature || null,
        configurationFingerprint,
        now,
        taskType,
        connectionId,
        JSON.stringify(excludedItems),
        JSON.stringify(input.target || null)
      )

      const insertItem = db.prepare(`
        INSERT INTO context_item(
          id, context_package_id, source_type, source_id, authority_level,
          selection_reason, estimated_tokens, fixed, position, title, content,
          slot_id, role, position_type, depth, slot_order, activation_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const item of items) {
        insertItem.run(
          item.id,
          packageId,
          item.sourceType,
          item.sourceId,
          item.authorityLevel,
          item.selectionReason,
          item.estimatedTokens,
          item.fixed ? 1 : 0,
          item.position,
          item.title || null,
          item.content || null,
          item.slotId || null,
          item.role || null,
          item.positionType || null,
          item.depth ?? null,
          item.slotOrder ?? null,
          item.activationKey || null
        )
      }
    })

    return contextPackage
  }

  /**
   * Retrieve a previously generated and persisted context package by ID.
   */
  getContextPackage(input: { sessionId: string; contextPackageId: string }): ContextPackage {
    return this.store.read(input.sessionId, (db) => {
      const row = db.prepare('SELECT * FROM context_package WHERE id = ?').get(input.contextPackageId) as
        | {
            id: string
            messages_json: string
            token_budget: number
            estimated_tokens: number
            warnings_json: string
            target_versions_json: string
            target_length: number | null
            creativity: number | null
            configuration_fingerprint: string
            created_at: number
            task_type: TaskType
            connection_id: string | null
            excluded_items_json: string
            target_json: string | null
          }
        | undefined

      if (!row) {
        throw new ProjectError('VALIDATION_ERROR', '上下文包不存在')
      }

      const itemsRows = db
        .prepare('SELECT * FROM context_item WHERE context_package_id = ? ORDER BY position ASC')
        .all(input.contextPackageId) as Array<{
        id: string
        context_package_id: string
        source_type: ContextItemSourceType
        source_id: string
        authority_level: number
        selection_reason: string
        estimated_tokens: number
        fixed: number
        position: number
        title: string | null
        content: string | null
        slot_id: string | null
        role: PromptSlotRole | null
        position_type: PromptSlotPosition | null
        depth: number | null
        slot_order: number | null
        activation_key: string | null
      }>

      const messages = JSON.parse(row.messages_json) as AssembledMessage[]
      const systemMessage = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
      const userMessage = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n\n')
      const warnings = JSON.parse(row.warnings_json) as string[]
      const excludedItems = JSON.parse(row.excluded_items_json || '[]') as ExcludedContextItem[]
      const target = row.target_json ? JSON.parse(row.target_json) : null

      const items: ContextItem[] = itemsRows.map((r) => ({
        id: r.id,
        contextPackageId: r.context_package_id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        authorityLevel: r.authority_level,
        selectionReason: r.selection_reason,
        estimatedTokens: r.estimated_tokens,
        fixed: r.fixed === 1,
        position: r.position,
        title: r.title || undefined,
        content: r.content || undefined,
        slotId: r.slot_id || undefined,
        role: r.role || undefined,
        positionType: r.position_type || undefined,
        depth: r.depth ?? undefined,
        slotOrder: r.slot_order ?? undefined,
        activationKey: r.activation_key || undefined
      }))

      let stage: ChatWorkflowStage | null = null
      let workflowType: ChatWorkflowType | null = null
      let taskType: TaskType = row.task_type
      let outlineId: string | null = null
      let outlineVersion: number | null = null
      let targetVersion: number | null = null
      try {
        const targetMap = JSON.parse(row.target_versions_json) as Record<string, any>
        if (targetMap['_meta:stage']) stage = targetMap['_meta:stage']
        if (targetMap['_meta:workflowType']) workflowType = targetMap['_meta:workflowType']
        if (targetMap['_meta:taskType']) taskType = targetMap['_meta:taskType']
        if (targetMap['_meta:outlineId']) outlineId = targetMap['_meta:outlineId']
        if (targetMap['_meta:outlineVersion']) outlineVersion = targetMap['_meta:outlineVersion']

        for (const [k, v] of Object.entries(targetMap)) {
          if (!k.startsWith('_meta:') && !k.includes(':') && typeof v === 'number') {
            targetVersion = v
            break
          }
        }
      } catch {}

      return {
        id: row.id,
        taskType,
        stage,
        workflowType,
        connectionId: row.connection_id,
        target,
        outlineId,
        outlineVersion,
        targetVersion,
        targetLength: row.target_length,
        creativity: row.creativity !== null ? { level: 'medium', temperature: row.creativity } : null,
        configurationFingerprint: row.configuration_fingerprint,
        messages,
        systemMessage,
        userMessage,
        items,
        excludedItems,
        estimatedInputTokens: row.estimated_tokens,
        availableInputTokens: row.token_budget,
        warnings,
        createdAt: row.created_at
      }
    })
  }

  /**
   * Verify whether a context package is still fresh or stale before execution.
   * SPEC 6.9, 7.2
   */
  verifyContextPackage(
    sessionId: string,
    packageId: string,
    currentOptions?: ContextPreviewInput
  ): ContextPackage {
    const pkg = this.getContextPackage({ sessionId, contextPackageId: packageId })

    // 1. Verify target chapter and outline versions and staleness
    this.store.read(sessionId, (db) => {
      const rawPkg = db
        .prepare('SELECT target_versions_json FROM context_package WHERE id = ?')
        .get(packageId) as { target_versions_json: string } | undefined
      if (rawPkg) {
        try {
          const targetVersions = JSON.parse(rawPkg.target_versions_json) as Record<string, any>
          for (const [key, expectedVer] of Object.entries(targetVersions)) {
            if (key.startsWith('_meta:')) continue
            if (key.startsWith('chapter:')) {
              const chapId = key.slice('chapter:'.length)
              const chap = db
                .prepare('SELECT version, deleted_at FROM chapter WHERE id = ?')
                .get(chapId) as { version: number; deleted_at: number | null } | undefined
              if (!chap || chap.deleted_at !== null || chap.version !== expectedVer) {
                throw new ProjectError('STALE_CONTEXT_PACKAGE', '目标章节正文已发生更新，上下文包已失效，请重新生成预览')
              }
            } else if (key.startsWith('chapter_outline:')) {
              const outlineIdKey = key.slice('chapter_outline:'.length)
              const outline = db
                .prepare('SELECT version, state FROM chapter_outline WHERE id = ?')
                .get(outlineIdKey) as { version: number; state: string } | undefined
              if (!outline || outline.version !== expectedVer || outline.state === 'stale') {
                throw new ProjectError('STALE_CONTEXT_PACKAGE', '关联章大纲已发生更新或已过时，上下文包已失效，请重新生成预览')
              }
            } else if (key.startsWith('book_outline:')) {
              const bookIdKey = key.slice('book_outline:'.length)
              const book = db
                .prepare('SELECT version, state FROM book_outline WHERE id = ?')
                .get(bookIdKey) as { version: number; state: string } | undefined
              if (!book || book.version !== expectedVer || book.state === 'stale') {
                throw new ProjectError('STALE_CONTEXT_PACKAGE', '全书大纲已发生更新或已过时，上下文包已失效，请重新生成预览')
              }
            } else if (key.startsWith('volume_outline:')) {
              const volIdKey = key.slice('volume_outline:'.length)
              const vol = db
                .prepare('SELECT version, state FROM volume_outline WHERE id = ?')
                .get(volIdKey) as { version: number; state: string } | undefined
              if (!vol || vol.version !== expectedVer || vol.state === 'stale') {
                throw new ProjectError('STALE_CONTEXT_PACKAGE', '分卷大纲已发生更新或已过时，上下文包已失效，请重新生成预览')
              }
            } else {
              // Raw chapter ID for backward compatibility
              const chap = db
                .prepare('SELECT version, deleted_at FROM chapter WHERE id = ?')
                .get(key) as { version: number; deleted_at: number | null } | undefined
              if (chap && (chap.deleted_at !== null || chap.version !== expectedVer)) {
                throw new ProjectError('STALE_CONTEXT_PACKAGE', '目标章节正文已发生更新，上下文包已失效，请重新生成预览')
              }
            }
          }
        } catch (e) {
          if (e instanceof ProjectError) throw e
        }
      }

      if (currentOptions?.target?.chapterId) {
        const chap = db
          .prepare('SELECT version, deleted_at FROM chapter WHERE id = ?')
          .get(currentOptions.target.chapterId) as { version: number; deleted_at: number | null } | undefined
        if (
          !chap ||
          chap.deleted_at !== null ||
          (pkg.targetVersion !== undefined && pkg.targetVersion !== null && chap.version !== pkg.targetVersion)
        ) {
          throw new ProjectError('STALE_CONTEXT_PACKAGE', '目标章节正文已发生更新，上下文包已失效，请重新生成预览')
        }
      }
    })

    // 2. Re-compute fingerprint to check for configuration changes if options passed
    if (currentOptions) {
      const sortedStyles = (currentOptions.styleSampleIds || []).slice().sort().join(',')
      const sortedPinned = (currentOptions.pinnedSourceIds || []).slice().sort().join(',')

      const userSlots = currentOptions.slots || []
      const defaultStageSlots = currentOptions.stage
        ? DEFAULT_STAGE_PROMPT_SLOTS.filter((ds) => !userSlots.some((us) => us.id === ds.id))
        : []
      const directorSlots = compileDirectorControls(currentOptions.directorControls)
      const combinedRawSlots = [...defaultStageSlots, ...userSlots, ...directorSlots]
      const compiledSlots: PromptSlot[] = combinedRawSlots.filter((slot) => {
        if (!slot.enabled) return false
        if (!slot.trigger || slot.trigger === 'always') return true
        if (currentOptions.stage && slot.trigger === currentOptions.stage) return true
        if (slot.trigger === currentOptions.taskType) return true
        if (
          slot.trigger === 'creation' &&
          (['continue', 'rewrite', 'polish'].includes(currentOptions.taskType) || currentOptions.stage === 'content')
        )
          return true
        return false
      })

      // NOTE: Preserving slot array ordering in serializedSlots (without sort)
      const serializedSlots = compiledSlots
        .map((s, idx) => `[${idx}]${s.id}:${s.role}:${s.position}:${s.depth ?? ''}:${s.order}:${s.trigger ?? ''}:${s.content}`)
        .join('|')
      const directorControlsJson = JSON.stringify(currentOptions.directorControls || {})

      let curChapOutlineId = currentOptions.outlineId || ''
      let curChapOutlineVersion = ''
      let curBookOutlineVersion = ''
      let curVolumeOutlineVersion = ''
      this.store.read(sessionId, (db) => {
        if (currentOptions.outlineId) {
          const co = db.prepare("SELECT id, version FROM chapter_outline WHERE id = ? AND state != 'stale'").get(currentOptions.outlineId) as { id: string; version: number } | undefined
          if (co) {
            curChapOutlineId = co.id
            curChapOutlineVersion = String(co.version)
          }
        } else if (currentOptions.target?.chapterId) {
          if (currentOptions.outlineVersion) {
            const co = db.prepare("SELECT id, version FROM chapter_outline WHERE chapter_id = ? AND version = ? AND state != 'stale'").get(currentOptions.target.chapterId, currentOptions.outlineVersion) as { id: string; version: number } | undefined
            if (co) {
              curChapOutlineId = co.id
              curChapOutlineVersion = String(co.version)
            }
          } else {
            const confirmedCo = db.prepare("SELECT id, version FROM chapter_outline WHERE chapter_id = ? AND state IN ('confirmed', 'current') ORDER BY version DESC LIMIT 1").get(currentOptions.target.chapterId) as { id: string; version: number } | undefined
            if (confirmedCo) {
              curChapOutlineId = confirmedCo.id
              curChapOutlineVersion = String(confirmedCo.version)
            } else {
              const latestCo = db.prepare("SELECT id, version FROM chapter_outline WHERE chapter_id = ? AND state != 'stale' ORDER BY version DESC LIMIT 1").get(currentOptions.target.chapterId) as { id: string; version: number } | undefined
              if (latestCo) {
                curChapOutlineId = latestCo.id
                curChapOutlineVersion = String(latestCo.version)
              }
            }
          }
        }

        const bo = db.prepare("SELECT version FROM book_outline WHERE state IN ('confirmed', 'current') ORDER BY updated_at DESC LIMIT 1").get() as { version: number } | undefined
        if (bo) {
          curBookOutlineVersion = String(bo.version)
        } else {
          const draftBo = db.prepare("SELECT version FROM book_outline WHERE state != 'stale' ORDER BY updated_at DESC LIMIT 1").get() as { version: number } | undefined
          if (draftBo) curBookOutlineVersion = String(draftBo.version)
        }

        if (currentOptions.target?.chapterId) {
          const chapOutline = db.prepare("SELECT volume_id FROM chapter_outline WHERE chapter_id = ? AND state != 'stale' ORDER BY version DESC LIMIT 1").get(currentOptions.target.chapterId) as { volume_id: string | null } | undefined
          if (chapOutline?.volume_id) {
            const vo = db.prepare("SELECT version FROM volume_outline WHERE id = ? AND state != 'stale'").get(chapOutline.volume_id) as { version: number } | undefined
            if (vo) curVolumeOutlineVersion = String(vo.version)
          }
        }
        if (!curVolumeOutlineVersion) {
          const vo = db.prepare("SELECT version FROM volume_outline WHERE state IN ('confirmed', 'current') ORDER BY position ASC LIMIT 1").get() as { version: number } | undefined
          if (vo) {
            curVolumeOutlineVersion = String(vo.version)
          } else {
            const fallbackVo = db.prepare("SELECT version FROM volume_outline WHERE state != 'stale' ORDER BY position ASC LIMIT 1").get() as { version: number } | undefined
            if (fallbackVo) curVolumeOutlineVersion = String(fallbackVo.version)
          }
        }
      })

      const fingerprintRaw = [
        currentOptions.connectionId,
        currentOptions.taskType,
        currentOptions.stage || '',
        currentOptions.workflowType || '',
        curChapOutlineId,
        curChapOutlineVersion,
        curBookOutlineVersion,
        curVolumeOutlineVersion,
        currentOptions.target?.chapterId || '',
        currentOptions.target?.startOffset ?? '',
        currentOptions.target?.endOffset ?? '',
        currentOptions.instruction.trim(),
        currentOptions.presetId || '',
        sortedStyles,
        sortedPinned,
        serializedSlots,
        directorControlsJson,
        currentOptions.includeCreativeRules !== false ? '1' : '0',
        currentOptions.targetLength || '',
        currentOptions.creativity || '',
        currentOptions.scanDepth || ''
      ].join('|')
      const currentFingerprint = createHash('sha256').update(fingerprintRaw).digest('hex').slice(0, 24)

      if (currentFingerprint !== pkg.configurationFingerprint) {
        throw new ProjectError('STALE_CONTEXT_PACKAGE', '创作配置或选项发生变化，原上下文包已失效，请重新生成预览')
      }
    }

    return pkg
  }

  private getSystemTemplate(taskType: TaskType, targetLength?: number): string {
    const lengthHint = targetLength ? `本次目标输出字数约为 ${targetLength} 字。` : ''
    switch (taskType) {
      case 'continue':
        return `你是一位专业的小说创作助手。请根据提供的创作规则、设定背景和前文脉络，紧随作者光标位置进行自然流畅的中文正文续写。保持人设、叙事口吻与行文风格一致。${lengthHint}`
      case 'rewrite':
        return `你是一位专业的小说创作助手。请重写作者指定的正文选区，遵循指令要求改变叙事节奏或表达方式，同时保持基本世界观与人物事实一致。${lengthHint}`
      case 'polish':
        return `你是一位专业的小说创作助手。请对作者指定的正文选区进行精细润色，优化文笔、句式与修辞，严禁改变原有情节走向与设定事实。${lengthHint}`
      case 'chat':
        return '你是一位博学且严谨的小说设定与情节助手，请基于提供的作品正文事实与知识设定回答作者的提问。引述必须准确，在回答中引述参考内容时请注明来源编号（如 [来源1]、[设定:条目名] 等）。不可臆造事实，不得修改或臆造与提供设定相违背的内容。'
      case 'knowledge':
        return '你是一位小说知识提取与剧情逻辑分析专家，负责从章节正文中梳理人物、世界观、时间线与伏笔线索，并排查矛盾漏洞。'
      case 'report':
        return '你是一位专业的小说文学编辑与评论家，负责针对作品进行主题、视角、文风、结构、人物弧光和连续性的六维深度分析。'
    }
  }

  /**
   * Assembles the full message array, correctly honoring:
   * - slot.role ('system' | 'user' | 'assistant')
   * - slot.position ('before_context' | 'after_context' | 'absolute_depth')
   * - slot.depth (in-chat depth relative to end of message stream)
   * - slot.order (priority within same depth/position)
   */
  private buildAssembledMessages(
    taskType: TaskType,
    items: ContextItem[],
    instruction: string,
    targetLength?: number,
    creativity?: string,
    stage?: ChatWorkflowStage
  ): AssembledMessage[] {
    const messages: AssembledMessage[] = []

    // 1. Build Base System Message
    const systemSections: string[] = []
    const templateItem = items.find((i) => i.sourceType === 'system_template')
    if (templateItem?.content) {
      systemSections.push(templateItem.content)
    }

    const rulesItem = items.find((i) => i.sourceType === 'creative_rules')
    if (rulesItem?.content) {
      systemSections.push(`【全书创作规则】\n${rulesItem.content}`)
    }

    // before_context slots with role === 'system'
    const beforeSysSlots = items
      .filter(
        (i) =>
          i.sourceType === 'prompt_slot' &&
          i.positionType === 'before_context' &&
          (i.role === 'system' || !i.role)
      )
      .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))

    for (const slot of beforeSysSlots) {
      if (slot.content) {
        systemSections.push(slot.content)
      }
    }

    if (systemSections.length > 0) {
      messages.push({ role: 'system', content: systemSections.join('\n\n') })
    }

    // 2. before_context slots with role !== 'system' (e.g. user preamble)
    const beforeOtherSlots = items
      .filter(
        (i) =>
          i.sourceType === 'prompt_slot' &&
          i.positionType === 'before_context' &&
          i.role !== 'system' &&
          Boolean(i.role)
      )
      .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))

    for (const slot of beforeOtherSlots) {
      if (slot.content) {
        messages.push({ role: slot.role!, content: slot.content })
      }
    }

    // 3. Build Core Context & Materials Block
    const contextBlocks: string[] = []

    // Project Outlines (book_outline, volume_outline, chapter_outline)
    const outlineItems = items.filter(
      (i) =>
        i.sourceType === 'book_outline' ||
        i.sourceType === 'volume_outline' ||
        i.sourceType === 'chapter_outline'
    )
    if (outlineItems.length > 0) {
      const ot = outlineItems.map((o) => `### ${o.title}\n${o.content}`).join('\n\n')
      contextBlocks.push(`【项目大纲规划】\n${ot}`)
    }

    // Chat history & rolling summary (Tier 12)
    const chatHistoryItems = items.filter((i) => i.sourceType === 'chat_history')
    if (chatHistoryItems.length > 0) {
      const ch = chatHistoryItems.map((c) => `### ${c.title}\n${c.content}`).join('\n\n')
      contextBlocks.push(`【会话历史与对话记忆】\n${ch}`)
    }

    // Background Knowledge & Setting Entries
    const knowledgeItems = items.filter(
      (i) => i.sourceType === 'knowledge_entry' || (i.sourceType === 'pinned_source' && i.title?.includes('设定'))
    )
    if (knowledgeItems.length > 0) {
      const kw = knowledgeItems.map((k) => `### ${k.title}\n${k.content}`).join('\n\n')
      contextBlocks.push(`【背景设定与人物档案】\n${kw}`)
    }

    // Plot Synopsis & Summaries
    const synopsisItems = items.filter((i) => i.sourceType === 'book_synopsis' || i.sourceType === 'chapter_summary')
    if (synopsisItems.length > 0) {
      const sw = synopsisItems.map((s) => `### ${s.title}\n${s.content}`).join('\n\n')
      contextBlocks.push(`【剧情大纲与前情提要】\n${sw}`)
    }

    // Style Samples & References
    const styleItems = items.filter((i) => i.sourceType === 'style_sample')
    if (styleItems.length > 0) {
      const st = styleItems.map((s) => `### ${s.title}\n${s.content}`).join('\n\n')
      contextBlocks.push(`【参考文风样本】\n${st}`)
    }

    // Retrieved Context Fragments
    const retrievedItems = items.filter(
      (i) => i.sourceType === 'retrieved_chunk' || (i.sourceType === 'pinned_source' && i.title?.includes('片段'))
    )
    if (retrievedItems.length > 0) {
      const rt = retrievedItems.map((r, idx) => `### [来源${idx + 1}] ${r.title}\n${r.content}`).join('\n\n')
      contextBlocks.push(`【相关正文引用片段】\n${rt}`)
    }

    // Instruction Presets
    const presetItem = items.find((i) => i.sourceType === 'instruction_preset')
    if (presetItem?.content) {
      contextBlocks.push(`【常用创作要求】\n${presetItem.content}`)
    }

    // Target Text
    const targetItem = items.find((i) => i.sourceType === 'target_text')
    if (targetItem?.content) {
      if (taskType === 'continue') {
        contextBlocks.push(`【前文内容】\n${targetItem.content}`)
      } else {
        contextBlocks.push(`【待修改原文选区】\n${targetItem.content}`)
      }
    }

    // 4. after_context slots
    const afterSlots = items
      .filter((i) => i.sourceType === 'prompt_slot' && i.positionType === 'after_context')
      .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))

    const afterSysSlots = afterSlots.filter((s) => s.role === 'system' || !s.role)
    const afterUserSlots = afterSlots.filter((s) => s.role === 'user')
    const afterAssistantSlots = afterSlots.filter((s) => s.role === 'assistant')

    if (afterSysSlots.length > 0) {
      contextBlocks.push(`【创作控制与即时要求】\n${afterSysSlots.map((s) => s.content).join('\n\n')}`)
    }

    if (afterUserSlots.length > 0) {
      contextBlocks.push(`【补充说明】\n${afterUserSlots.map((s) => s.content).join('\n\n')}`)
    }

    if (taskType === 'chat') {
      if (stage === 'direction') {
        contextBlocks.push(`【阶段任务：方向确认】\n${instruction.trim() || '请结合大纲与设定梳理本章创作核心方向与待确认问题。'}`)
      } else if (stage === 'chapter_outline') {
        contextBlocks.push(`【阶段任务：章大纲规划】\n${instruction.trim() || '请规划本章的六模块结构化章大纲。'}`)
      } else if (stage === 'content') {
        contextBlocks.push(`【阶段任务：正文生成】\n${instruction.trim() || '请基于已确认的章大纲生成正文候选。'}`)
      } else {
        contextBlocks.push(`【作者提问】\n${instruction.trim() || '请根据以上设定与正文内容回答。'}`)
      }
    } else {
      const paramsList: string[] = []
      if (targetLength) paramsList.push(`- 目标长度：约 ${targetLength} 字`)
      if (creativity) {
        paramsList.push(
          `- 创意倾向：${creativity === 'low' ? '低（严谨保守）' : creativity === 'medium' ? '中（平衡自然）' : '高（发散探索）'}`
        )
      }

      let finalInstructionBlock = '【本次创作任务指令】\n'
      if (paramsList.length > 0) {
        finalInstructionBlock += `${paramsList.join('\n')}\n`
      }
      finalInstructionBlock += instruction.trim() ? instruction.trim() : '请基于以上背景脉络与要求开始生成。'
      contextBlocks.push(finalInstructionBlock)
    }

    // Push Core User Message
    messages.push({ role: 'user', content: contextBlocks.join('\n\n---\n\n') })

    // after_context slots with assistant role (e.g. prefill/continuation)
    for (const slot of afterAssistantSlots) {
      if (slot.content) {
        messages.push({ role: 'assistant', content: slot.content })
      }
    }

    // 5. In-Chat Depth Injections (absolute_depth)
    // Depth D = 0 -> inserted at the very end of messages (after last message)
    // Depth D = 1 -> inserted before the last message (1 message back from end)
    // Depth D = N -> inserted N messages back from end (preserving system prompt at index 0)
    const depthSlots = items
      .filter((i) => i.sourceType === 'prompt_slot' && i.positionType === 'absolute_depth')
      .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))

    const baseCount = messages.length
    const depthBuckets: AssembledMessage[][] = Array.from({ length: baseCount + 1 }, () => [])

    for (const slot of depthSlots) {
      if (!slot.content) continue
      const d = slot.depth ?? 0
      const bucketIdx = d === 0 ? baseCount : Math.max(1, baseCount - d)
      depthBuckets[bucketIdx].push({
        role: slot.role || 'user',
        content: slot.content
      })
    }

    const finalMessages: AssembledMessage[] = []
    for (let i = 0; i < baseCount; i++) {
      if (depthBuckets[i].length > 0) {
        finalMessages.push(...depthBuckets[i])
      }
      finalMessages.push(messages[i])
    }
    if (depthBuckets[baseCount].length > 0) {
      finalMessages.push(...depthBuckets[baseCount])
    }

    return finalMessages
  }
}
