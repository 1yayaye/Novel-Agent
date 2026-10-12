import { createHash, randomUUID } from 'node:crypto'
import { ProjectError, type ProjectStore } from './project-store'
import type { ConnectionStore } from './connection-store'
import type { ModelGateway } from './model-gateway'
import type { SearchIndex } from './search-index'
import type { PromptSettingsStore } from './prompt-store'
import { assertPromptSnapshotFresh, compilePromptMessages, promptTask, resolvePromptDefinitions, type PromptMarker } from './prompt-runtime'
import { PromptSnapshotSchema } from '../shared/prompt-settings'
import type {
  AssembledMessage,
  ChatWorkflowStage,
  ChatWorkflowType,
  ContextItem,
  ContextItemSourceType,
  ContextPackage,
  ContextPreviewInput,
  ExcludedContextItem,
  PromptSnapshot,
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

export class ContextAssembler {
  constructor(
    private readonly store: ProjectStore,
    private readonly promptStore: PromptSettingsStore,
    private readonly searchIndex: SearchIndex,
    private readonly connectionStore: ConnectionStore,
    private readonly modelGateway?: ModelGateway
  ) {}

  /**
   * Main entrypoint to assemble an immutable ContextPackage.
   * SPEC 7.2, 7.3, 7.4 & PROMPT SPEC v2.0
   */
  async assembleContext(input: ContextPreviewInput, frozenSnapshot?: PromptSnapshot, excludedHistoryMessageId?: string): Promise<ContextPackage> {
    const { sessionId, connectionId, taskType, stage, workflowType, outlineId, outlineVersion } = input
    const instruction = (input.instruction || '').trim()
    const warnings: string[] = []

    // 1. Read connection configuration
    const { connection } = this.connectionStore.getInternal(connectionId)
    const promptSnapshot = frozenSnapshot ?? this.promptStore.snapshot(connection)
    if (!promptSnapshot.budget) throw new ProjectError('STALE_CONTEXT_PACKAGE', '任务缺少冻结预算，请重新创建')
    const contextWindow = promptSnapshot.budget.contextWindow
    const maxOutputTokens = promptSnapshot.budget.maxOutputTokens
    const safetyMarginRatio = promptSnapshot.budget.safetyMarginRatio
    const tokenEstimationRatio = promptSnapshot.budget.tokenEstimationRatio

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

        const start = input.target.startOffset ?? (taskType === 'continue' ? chap.content.length : 0)
        const end = input.target.endOffset ?? chap.content.length
        if (start > end || end > chap.content.length) {
          throw new ProjectError('VALIDATION_ERROR', '目标选区超出章节正文范围，请重新选择')
        }

        if (taskType === 'continue') {
          targetText = chap.content.slice(0, start)
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
    let bookSynopsisId = ''
    this.store.read(sessionId, (db) => {
      const synopsis = db
        .prepare("SELECT id, summary FROM book_synopsis WHERE state = 'current' LIMIT 1")
        .get() as { id: string; summary: string } | undefined
      if (synopsis) {
        bookSynopsisText = synopsis.summary
        bookSynopsisId = synopsis.id
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

    const optionsFingerprint = this.optionsFingerprint(input, promptSnapshot)
    const definitions = resolvePromptDefinitions(promptTask(taskType, stage), promptSnapshot)

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
      moduleId?: string
      role?: AssembledMessage['role']
      positionType?: 'relative' | 'in_chat'
      depth?: number
      slotOrder?: number
      activationKey?: string
    }> = []

    for (const definition of definitions) {
      if (!definition.content) continue
      rawItems.push({
        sourceType: 'system_template',
        sourceId: definition.id,
        authorityLevel: 1, title: definition.name, content: definition.content,
        selectionReason: '预设提示词模块或任务协议',
        fixed: true, isUncuttable: true,
        role: definition.role, positionType: definition.position ?? 'relative',
        depth: definition.depth, slotOrder: definition.order, moduleId: definition.id
      })
    }

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
          sourceId: bookSynopsisId,
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

    const materialFingerprints = new Map(rawItems.map((item) => [
      `${item.sourceType}:${item.sourceId}`, this.materialFingerprint(sessionId, item.sourceType, item.sourceId)
    ]))

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
          WHERE chat_session_id = ? AND state = 'completed' AND id != ?
          ORDER BY created_at DESC
          LIMIT 12
        `
          )
          .all(chatId, excludedHistoryMessageId ?? '') as Array<{ id: string; role: AssembledMessage['role']; content: string }>

        for (const message of recentMessages.reverse()) {
          rawItems.push({
            sourceType: 'chat_history', sourceId: message.id, authorityLevel: 12,
            title: message.role === 'user' ? '历史作者消息' : '历史助手消息',
            content: message.content, role: message.role,
            selectionReason: '当前会话真实历史消息，按时间顺序保留角色',
            fixed: false, isUncuttable: false
          })
        }
      })
    }

    for (const item of rawItems) {
      const key = `${item.sourceType}:${item.sourceId}`
      if (!materialFingerprints.has(key)) materialFingerprints.set(key, this.materialFingerprint(sessionId, item.sourceType, item.sourceId))
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
        moduleId: raw.moduleId,
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
        moduleId: raw.moduleId,
        role: raw.role,
        positionType: raw.positionType,
        depth: raw.depth,
        slotOrder: raw.slotOrder,
        activationKey: raw.activationKey
      })

    }

    // 8. Full Messages Assembly (SPEC v2.0 - Honors role & depth across all message slots)
    let messages = this.buildAssembledMessages(
      taskType,
      items,
      expandedInstruction,
      input.targetLength,
      input.creativity,
      stage,
      promptSnapshot
    )

    const estimateMessages = () => messages.reduce((total, message) => total + estimateTokens(message.content, tokenEstimationRatio) + 4, 2)
    currentEstimatedTokens = estimateMessages()
    while (currentEstimatedTokens > availableInputTokens) {
      const trimIndex = items.reduce((selected, item, index) => {
        if (rawItems.find((raw) => raw.sourceType === item.sourceType && raw.sourceId === item.sourceId)?.isUncuttable) return selected
        return selected < 0 || item.authorityLevel > items[selected].authorityLevel ? index : selected
      }, -1)
      if (trimIndex < 0) throw new ProjectError('MODEL_CONTEXT_EXCEEDED', '固定任务协议、作者要求与目标正文超过输入预算，请缩短目标内容或调整连接预算')
      const [trimmed] = items.splice(trimIndex, 1)
      excludedItems.push({ sourceType: trimmed.sourceType, sourceId: trimmed.sourceId, title: trimmed.title,
        reason: 'budget_exceeded', estimatedTokens: trimmed.estimatedTokens, moduleId: trimmed.moduleId })
      messages = this.buildAssembledMessages(taskType, items, expandedInstruction, input.targetLength, input.creativity, stage, promptSnapshot)
      currentEstimatedTokens = estimateMessages()
    }
    if (excludedItems.length && !warnings.some((warning) => warning.includes('Token'))) warnings.push(`由于 Token 预算限制，已裁剪 ${excludedItems.length} 项可选内容`)

    // 汇总视图用于预览；模型发送下方冻结的 messages。
    const systemMessage = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const userMessage = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n\n')

    const materialsSnapshot = items.flatMap((item) => {
      const fingerprint = materialFingerprints.get(`${item.sourceType}:${item.sourceId}`)
      return fingerprint ? [{ sourceType: item.sourceType, sourceId: item.sourceId, fingerprint }] : []
    })
    if (materialsSnapshot.some((material) => this.materialFingerprint(sessionId, material.sourceType, material.sourceId) !== material.fingerprint)) {
      throw new ProjectError('STALE_CONTEXT_PACKAGE', '预览期间作品资料发生更新，请重新生成预览')
    }
    const configurationFingerprint = createHash('sha256').update(JSON.stringify({ optionsFingerprint, materialsSnapshot })).digest('hex')
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
          creativity: input.creativity ? { level: input.creativity } : null,
          connectionId,
          target: input.target || null,
          configurationFingerprint,
      promptSnapshot,
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
      const targetVersionsJson = JSON.stringify({ ...targetVersions, '_meta:promptSnapshot': promptSnapshot, '_meta:creativity': input.creativity ?? null, '_meta:optionsFingerprint': optionsFingerprint, '_meta:materials': materialsSnapshot })

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
        null,
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
          item.moduleId || null,
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
        role: AssembledMessage['role'] | null
        position_type: 'relative' | 'in_chat' | null
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
      const metadata = JSON.parse(row.target_versions_json) as Record<string, any>
      if (!PromptSnapshotSchema.safeParse(metadata['_meta:promptSnapshot']).success) {
        throw new ProjectError('STALE_CONTEXT_PACKAGE', '上下文包缺少有效的提示词快照，请重新生成预览')
      }
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
        moduleId: r.slot_id || undefined,
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
          if (k.startsWith('chapter:') && typeof v === 'number') {
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
        creativity: metadata['_meta:creativity'] ? { level: metadata['_meta:creativity'] } : null,
        promptSnapshot: PromptSnapshotSchema.parse(metadata['_meta:promptSnapshot']),
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

    if (!pkg.connectionId) throw new ProjectError('STALE_CONTEXT_PACKAGE', '上下文包缺少连接信息')
    assertPromptSnapshotFresh(this.promptStore, pkg.promptSnapshot, this.connectionStore.getInternal(pkg.connectionId).connection)

    // 1. Verify target chapter and outline versions and staleness
    this.store.read(sessionId, (db) => {
      const rawPkg = db
        .prepare('SELECT target_versions_json FROM context_package WHERE id = ?')
        .get(packageId) as { target_versions_json: string } | undefined
      if (rawPkg) {
        try {
          const targetVersions = JSON.parse(rawPkg.target_versions_json) as Record<string, any>
          const materials = targetVersions['_meta:materials'] as Array<{ sourceType: ContextItemSourceType; sourceId: string; fingerprint: string }>
          if (!Array.isArray(materials) || materials.some((material) => this.materialFingerprint(sessionId, material.sourceType, material.sourceId) !== material.fingerprint)) {
            throw new ProjectError('STALE_CONTEXT_PACKAGE', '作品资料已更新，请重新生成预览')
          }
          if (currentOptions && this.optionsFingerprint(currentOptions, pkg.promptSnapshot) !== targetVersions['_meta:optionsFingerprint']) {
            throw new ProjectError('STALE_CONTEXT_PACKAGE', '本次任务选项已变化，请重新生成预览')
          }
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

    return pkg
  }

  private materialFingerprint(sessionId: string, sourceType: ContextItemSourceType, sourceId: string): string | null {
    const tables: Partial<Record<ContextItemSourceType, string>> = {
      target_text: 'chapter', knowledge_entry: 'knowledge_entry', style_sample: 'style_sample',
      instruction_preset: 'instruction_preset', book_synopsis: 'book_synopsis', chapter_summary: 'chapter_summary',
      book_outline: 'book_outline', volume_outline: 'volume_outline', chapter_outline: 'chapter_outline',
      retrieved_chunk: 'content_chunk', ai_suggestion: 'ai_fact_suggestion'
    }
    return this.store.read(sessionId, (db) => {
      let row: Record<string, unknown> | undefined
      if (sourceType === 'creative_rules') {
        row = db.prepare('SELECT creative_rules AS content FROM project_meta LIMIT 1').get() as typeof row
      } else if (sourceType === 'chat_history') {
        row = (db.prepare('SELECT * FROM chat_message WHERE id = ?').get(sourceId) ?? db.prepare('SELECT * FROM chat_summary WHERE id = ?').get(sourceId)) as typeof row
      } else if (sourceType === 'pinned_source') {
        row = (db.prepare('SELECT * FROM content_chunk WHERE id = ?').get(sourceId) ?? db.prepare('SELECT * FROM knowledge_entry WHERE id = ?').get(sourceId)) as typeof row
      } else if (tables[sourceType]) {
        row = db.prepare(`SELECT * FROM ${tables[sourceType]} WHERE id = ?`).get(sourceId) as typeof row
      } else return null
      if (!row) return 'missing'
      return createHash('sha256').update(JSON.stringify({
        version: row.version ?? row.chapter_version, content: row.content ?? row.author_content ?? row.summary ?? row.display_text,
        state: row.state, role: row.role, deletedAt: row.deleted_at
      })).digest('hex')
    })
  }

  private optionsFingerprint(input: ContextPreviewInput, snapshot: PromptSnapshot): string {
    return createHash('sha256').update(JSON.stringify({
      promptFingerprint: snapshot.fingerprint, budget: snapshot.budget,
      connectionId: input.connectionId, taskType: input.taskType, stage: input.stage ?? null,
      workflowType: input.workflowType ?? null, outlineId: input.outlineId ?? null, outlineVersion: input.outlineVersion ?? null,
      target: input.target ? { chapterId: input.target.chapterId ?? null, startOffset: input.target.startOffset ?? null,
        endOffset: input.target.endOffset ?? null, chatId: input.target.chatId ?? null } : null,
      instruction: input.instruction.trim(), presetId: input.presetId ?? null,
      styleSampleIds: [...(input.styleSampleIds ?? [])].sort(), pinnedSourceIds: [...(input.pinnedSourceIds ?? [])].sort(),
      includeCreativeRules: input.includeCreativeRules !== false, targetLength: input.targetLength ?? null,
      creativity: input.creativity ?? null, scanDepth: input.scanDepth ?? null, enableQueryRewrite: input.enableQueryRewrite ?? false
    })).digest('hex')
  }

  private buildAssembledMessages(
    taskType: TaskType, items: ContextItem[], instruction: string,
    targetLength: number | undefined, creativity: 'low' | 'medium' | 'high' | undefined,
    stage: ChatWorkflowStage | undefined, snapshot: PromptSnapshot
  ): AssembledMessage[] {
    const markers: Partial<Record<ContextItemSourceType, PromptMarker>> = {
      creative_rules: 'project_rules', book_outline: 'outlines', volume_outline: 'outlines', chapter_outline: 'outlines',
      knowledge_entry: 'knowledge', book_synopsis: 'synopsis', chapter_summary: 'synopsis',
      style_sample: 'style_samples', pinned_source: 'references', retrieved_chunk: 'references',
      ai_suggestion: 'suggestions', instruction_preset: 'preset', target_text: 'target', chat_history: 'history'
    }
    const materials: Partial<Record<PromptMarker, AssembledMessage[]>> = {}
    for (const item of [...items].sort((a, b) => a.position - b.position)) {
      const marker = item.sourceType === 'chat_history' && !item.role ? 'synopsis' : markers[item.sourceType]
      if (!marker || !item.content) continue
      const content = marker === 'history' && item.role ? item.content : `【${item.title ?? item.sourceType}】\n${item.content}`
      ;(materials[marker] ??= []).push({ role: item.role ?? 'user', content })
    }
    return compilePromptMessages(promptTask(taskType, stage), {
      instruction, materials, targetLength, creativity,
      includedDefinitionIds: items.filter((item) => item.sourceType === 'system_template' || item.sourceType === 'prompt_module').map((item) => item.sourceId)
    }, snapshot)
  }
}
