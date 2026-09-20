import { randomUUID } from 'node:crypto'
import {
  type ChatDeltaEvent,
  type ChatDoneEvent,
  type ChatMessage,
  type ChatMessageCitation,
  type ChatSession,
  type ChatSummary,
  type ChatWorkflowStage,
  type ChatWorkflowType,
  type ContextPackage,
  type CreateChatSessionInput,
  type DeleteChatSessionInput,
  type GetChatSessionInput,
  type GetChatSummaryInput,
  type ListChatMessagesInput,
  type ListChatSessionsInput,
  type SendChatMessageInput,
  type UpdateChatSummaryInput,
  type UpdateChatWorkflowStageInput
} from '../shared/project'
import { ProjectError, type ProjectStore } from './project-store'
import type { ModelGateway } from './model-gateway'
import type { ConnectionStore } from './connection-store'
import type { ContextAssembler } from './context-assembler'
import type { SearchIndex } from './search-index'

export interface ChatCallbacks {
  onDelta?: (event: ChatDeltaEvent) => void
  onDone?: (event: ChatDoneEvent) => void
}

const ALLOWED_STAGE_TRANSITIONS: Record<ChatWorkflowStage, ChatWorkflowStage[]> = {
  direction: ['direction', 'chapter_outline'],
  chapter_outline: ['chapter_outline', 'direction', 'content'],
  content: ['content', 'chapter_outline', 'reviewed', 'direction'],
  reviewed: ['reviewed', 'content', 'chapter_outline', 'direction']
}

export class ChatService {
  private readonly activeControllers = new Map<string, AbortController>()
  private callbacks: ChatCallbacks = {}

  constructor(
    private readonly store: ProjectStore,
    private readonly modelGateway: ModelGateway,
    private readonly connectionStore: ConnectionStore,
    private readonly contextAssembler: ContextAssembler,
    private readonly searchIndex: SearchIndex
  ) {}

  setCallbacks(callbacks: ChatCallbacks): void {
    this.callbacks = callbacks
  }

  createSession(input: CreateChatSessionInput): ChatSession {
    const { sessionId, title, connectionId, workflowType, targetChapterId, stage, outlineId, outlineVersion } = input
    const now = Date.now()
    const id = randomUUID()
    const sessionTitle = (title || '').trim() || (workflowType === 'creation_workflow' ? '创作工作流会话' : '新对话')
    const effectiveWorkflowType: ChatWorkflowType = workflowType || 'free_chat'
    const effectiveStage: ChatWorkflowStage | null =
      effectiveWorkflowType === 'creation_workflow' ? (stage || 'direction') : null

    return this.store.transaction(sessionId, (db) => {
      if (targetChapterId) {
        const chap = db.prepare('SELECT id FROM chapter WHERE id = ? AND deleted_at IS NULL').get(targetChapterId)
        if (!chap) {
          throw new ProjectError('VALIDATION_ERROR', '目标章节不存在')
        }
      }

      db.prepare(`
        INSERT INTO chat_session(
          id, title, connection_id, workflow_type, target_chapter_id, stage, outline_id, outline_version, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        sessionTitle,
        connectionId || null,
        effectiveWorkflowType,
        targetChapterId || null,
        effectiveStage,
        outlineId || null,
        outlineVersion || null,
        now,
        now
      )

      return {
        id,
        title: sessionTitle,
        connectionId: connectionId || null,
        workflowType: effectiveWorkflowType,
        targetChapterId: targetChapterId || null,
        stage: effectiveStage,
        outlineId: outlineId || null,
        outlineVersion: outlineVersion || null,
        version: 1,
        createdAt: now,
        updatedAt: now
      }
    })
  }

  listSessions(input: ListChatSessionsInput): ChatSession[] {
    return this.store.read(input.sessionId, (db) => {
      const rows = db.prepare(`
        SELECT id, title, connection_id, workflow_type, target_chapter_id, stage, outline_id, outline_version, version, created_at, updated_at
        FROM chat_session
        ORDER BY updated_at DESC
      `).all() as Array<{
        id: string
        title: string
        connection_id: string | null
        workflow_type: ChatWorkflowType | null
        target_chapter_id: string | null
        stage: ChatWorkflowStage | null
        outline_id: string | null
        outline_version: number | null
        version: number
        created_at: number
        updated_at: number
      }>

      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        connectionId: r.connection_id,
        workflowType: r.workflow_type || 'free_chat',
        targetChapterId: r.target_chapter_id,
        stage: r.stage,
        outlineId: r.outline_id,
        outlineVersion: r.outline_version,
        version: r.version,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    })
  }

  getSession(input: GetChatSessionInput): ChatSession {
    return this.store.read(input.sessionId, (db) => {
      const row = db.prepare(`
        SELECT id, title, connection_id, workflow_type, target_chapter_id, stage, outline_id, outline_version, version, created_at, updated_at
        FROM chat_session
        WHERE id = ?
      `).get(input.chatSessionId) as {
        id: string
        title: string
        connection_id: string | null
        workflow_type: ChatWorkflowType | null
        target_chapter_id: string | null
        stage: ChatWorkflowStage | null
        outline_id: string | null
        outline_version: number | null
        version: number
        created_at: number
        updated_at: number
      } | undefined

      if (!row) {
        throw new ProjectError('VALIDATION_ERROR', '对话会话不存在')
      }

      return {
        id: row.id,
        title: row.title,
        connectionId: row.connection_id,
        workflowType: row.workflow_type || 'free_chat',
        targetChapterId: row.target_chapter_id,
        stage: row.stage,
        outlineId: row.outline_id,
        outlineVersion: row.outline_version,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    })
  }

  updateStage(input: UpdateChatWorkflowStageInput): ChatSession {
    const { sessionId, chatSessionId, stage: nextStage, expectedVersion, targetChapterId, outlineId, outlineVersion } = input
    const now = Date.now()

    return this.store.transaction(sessionId, (db) => {
      const current = db.prepare(`
        SELECT id, title, connection_id, workflow_type, target_chapter_id, stage, outline_id, outline_version, version, created_at
        FROM chat_session
        WHERE id = ?
      `).get(chatSessionId) as {
        id: string
        title: string
        connection_id: string | null
        workflow_type: ChatWorkflowType | null
        target_chapter_id: string | null
        stage: ChatWorkflowStage | null
        outline_id: string | null
        outline_version: number | null
        version: number
        created_at: number
      } | undefined

      if (!current) {
        throw new ProjectError('VALIDATION_ERROR', '对话会话不存在')
      }
      if (current.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '会话已被修改，请刷新后重试')
      }

      const workflowType = current.workflow_type || 'free_chat'
      if (workflowType === 'free_chat') {
        throw new ProjectError('INVALID_STATE_TRANSITION', '普通问答会话无法转换创作阶段')
      }

      const currentStage = current.stage || 'direction'
      const allowedNext = ALLOWED_STAGE_TRANSITIONS[currentStage] || []
      if (!allowedNext.includes(nextStage)) {
        throw new ProjectError(
          'INVALID_STATE_TRANSITION',
          `非法的创作阶段转换：不允许从 [${currentStage}] 直接跳转至 [${nextStage}]`
        )
      }

      const finalChapterId = targetChapterId !== undefined ? targetChapterId : current.target_chapter_id
      if (finalChapterId) {
        const chap = db.prepare('SELECT id FROM chapter WHERE id = ? AND deleted_at IS NULL').get(finalChapterId)
        if (!chap) {
          throw new ProjectError('VALIDATION_ERROR', '目标章节不存在')
        }
      }

      const finalOutlineId = outlineId !== undefined ? outlineId : current.outline_id
      const finalOutlineVersion = outlineVersion !== undefined ? outlineVersion : current.outline_version
      const nextVersion = current.version + 1

      db.prepare(`
        UPDATE chat_session
        SET stage = ?, target_chapter_id = ?, outline_id = ?, outline_version = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextStage,
        finalChapterId || null,
        finalOutlineId || null,
        finalOutlineVersion || null,
        nextVersion,
        now,
        chatSessionId
      )

      return {
        id: current.id,
        title: current.title,
        connectionId: current.connection_id,
        workflowType,
        targetChapterId: finalChapterId || null,
        stage: nextStage,
        outlineId: finalOutlineId || null,
        outlineVersion: finalOutlineVersion || null,
        version: nextVersion,
        createdAt: current.created_at,
        updatedAt: now
      }
    })
  }

  deleteSession(input: DeleteChatSessionInput): { success: true } {
    const { sessionId, chatSessionId, expectedVersion } = input

    return this.store.transaction(sessionId, (db) => {
      const session = db.prepare('SELECT id, version FROM chat_session WHERE id = ?').get(chatSessionId) as { id: string; version: number } | undefined
      if (!session) {
        throw new ProjectError('VALIDATION_ERROR', '对话会话不存在')
      }
      if (session.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '会话已被修改，请刷新后重试')
      }

      db.prepare('DELETE FROM chat_session WHERE id = ?').run(chatSessionId)
      return { success: true }
    })
  }

  listMessages(input: ListChatMessagesInput): ChatMessage[] {
    return this.store.read(input.sessionId, (db) => {
      const rows = db.prepare(`
        SELECT id, chat_session_id, role, content, context_package_id, token_count, state, created_at
        FROM chat_message
        WHERE chat_session_id = ?
        ORDER BY created_at ASC
      `).all(input.chatSessionId) as Array<{
        id: string
        chat_session_id: string
        role: 'system' | 'user' | 'assistant'
        content: string
        context_package_id: string | null
        token_count: number | null
        state: 'streaming' | 'completed' | 'failed' | 'cancelled'
        created_at: number
      }>

      return rows.map((r) => {
        let citations: ChatMessageCitation[] | undefined
        if (r.role === 'assistant' && r.context_package_id) {
          try {
            const pkg = this.contextAssembler.getContextPackage({
              sessionId: input.sessionId,
              contextPackageId: r.context_package_id
            })
            citations = this.extractCitations(r.content, pkg)
          } catch {}
        }

        return {
          id: r.id,
          chatSessionId: r.chat_session_id,
          role: r.role,
          content: r.content,
          contextPackageId: r.context_package_id,
          tokenCount: r.token_count,
          state: r.state,
          citations,
          createdAt: r.created_at
        }
      })
    })
  }

  getSummary(input: GetChatSummaryInput): ChatSummary | null {
    return this.store.read(input.sessionId, (db) => {
      const row = db.prepare(`
        SELECT id, chat_session_id, start_message_id, end_message_id, content, author_edited, version, created_at, updated_at
        FROM chat_summary
        WHERE chat_session_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(input.chatSessionId) as {
        id: string
        chat_session_id: string
        start_message_id: string | null
        end_message_id: string | null
        content: string
        author_edited: number
        version: number
        created_at: number
        updated_at: number
      } | undefined

      if (!row) return null

      return {
        id: row.id,
        chatSessionId: row.chat_session_id,
        startMessageId: row.start_message_id,
        endMessageId: row.end_message_id,
        content: row.content,
        authorEdited: row.author_edited === 1,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    })
  }

  updateSummary(input: UpdateChatSummaryInput): ChatSummary {
    const { sessionId, summaryId, content, expectedVersion } = input
    const now = Date.now()

    return this.store.transaction(sessionId, (db) => {
      const current = db.prepare('SELECT id, chat_session_id, start_message_id, end_message_id, version, created_at FROM chat_summary WHERE id = ?').get(summaryId) as {
        id: string
        chat_session_id: string
        start_message_id: string | null
        end_message_id: string | null
        version: number
        created_at: number
      } | undefined

      if (!current) {
        throw new ProjectError('VALIDATION_ERROR', '会话摘要不存在')
      }
      if (current.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '摘要已被更新，请重新加载后再试')
      }

      const nextVersion = current.version + 1
      db.prepare(`
        UPDATE chat_summary
        SET content = ?, author_edited = 1, version = ?, updated_at = ?
        WHERE id = ?
      `).run(content.trim(), nextVersion, now, summaryId)

      return {
        id: summaryId,
        chatSessionId: current.chat_session_id,
        startMessageId: current.start_message_id,
        endMessageId: current.end_message_id,
        content: content.trim(),
        authorEdited: true,
        version: nextVersion,
        createdAt: current.created_at,
        updatedAt: now
      }
    })
  }

  async compactSession(sessionId: string, chatSessionId: string, connectionId?: string): Promise<ChatSummary> {
    const messages = this.listMessages({ sessionId, chatSessionId })
    if (messages.length <= 12) {
      const existing = this.getSummary({ sessionId, chatSessionId })
      if (existing) return existing

      const now = Date.now()
      const summaryId = randomUUID()
      return this.store.transaction(sessionId, (db) => {
        db.prepare(`
          INSERT INTO chat_summary(id, chat_session_id, start_message_id, end_message_id, content, author_edited, version, created_at, updated_at)
          VALUES (?, ?, NULL, NULL, '', 0, 1, ?, ?)
        `).run(summaryId, chatSessionId, now, now)

        return {
          id: summaryId,
          chatSessionId,
          startMessageId: null,
          endMessageId: null,
          content: '',
          authorEdited: false,
          version: 1,
          createdAt: now,
          updatedAt: now
        }
      })
    }

    const messagesToSummarize = messages.slice(0, messages.length - 12)
    const existingSummary = this.getSummary({ sessionId, chatSessionId })

    const connId = connectionId || this.resolveConnectionId(sessionId, chatSessionId)
    const formattedTranscript = messagesToSummarize
      .map((m) => `${m.role === 'user' ? '作者' : '助手'}: ${m.content}`)
      .join('\n\n')

    const prompt = `请为以下小说创作会话的前期对话提取精炼的核心事实与上下文摘要。重点保留讨论过的剧情事实、设定改动、人物关系和待办事宜：\n\n${formattedTranscript}`

    let newSummaryContent = ''
    try {
      const stream = this.modelGateway.chatCompletionStream({
        connectionId: connId,
        taskType: 'chat',
        priority: 'low',
        messages: [
          { role: 'system', content: '你是一位小说创作助手的会话摘要整理专家。请用简明精炼的中文分条列出会话讨论的核心要点。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        isContentRequest: true
      })

      for await (const chunk of stream) {
        if (chunk.text) {
          newSummaryContent += chunk.text
        }
      }
      newSummaryContent = newSummaryContent.trim()
    } catch (error) {
      throw new ProjectError('CONNECTION_FAILED', `生成会话滚动摘要失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    const now = Date.now()
    return this.store.transaction(sessionId, (db) => {
      if (existingSummary) {
        let finalContent = newSummaryContent
        if (existingSummary.authorEdited && existingSummary.content.trim().length > 0) {
          // Preserve author-edited content against automatic overwrites (SPEC 6.8)
          finalContent = `【作者修订备忘】\n${existingSummary.content.trim()}\n\n【最新滚动摘要】\n${newSummaryContent}`
        }

        const nextVersion = existingSummary.version + 1
        db.prepare(`
          UPDATE chat_summary
          SET start_message_id = ?, end_message_id = ?, content = ?, version = ?, updated_at = ?
          WHERE id = ?
        `).run(
          messagesToSummarize[0].id,
          messagesToSummarize[messagesToSummarize.length - 1].id,
          finalContent,
          nextVersion,
          now,
          existingSummary.id
        )

        return {
          id: existingSummary.id,
          chatSessionId,
          startMessageId: messagesToSummarize[0].id,
          endMessageId: messagesToSummarize[messagesToSummarize.length - 1].id,
          content: finalContent,
          authorEdited: existingSummary.authorEdited,
          version: nextVersion,
          createdAt: existingSummary.createdAt,
          updatedAt: now
        }
      } else {
        const newId = randomUUID()
        db.prepare(`
          INSERT INTO chat_summary(id, chat_session_id, start_message_id, end_message_id, content, author_edited, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
        `).run(
          newId,
          chatSessionId,
          messagesToSummarize[0].id,
          messagesToSummarize[messagesToSummarize.length - 1].id,
          newSummaryContent,
          now,
          now
        )

        return {
          id: newId,
          chatSessionId,
          startMessageId: messagesToSummarize[0].id,
          endMessageId: messagesToSummarize[messagesToSummarize.length - 1].id,
          content: newSummaryContent,
          authorEdited: false,
          version: 1,
          createdAt: now,
          updatedAt: now
        }
      }
    })
  }

  cancelChat(sessionId: string, chatSessionId: string): { success: true } {
    const controller = this.activeControllers.get(chatSessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(chatSessionId)
    }
    return { success: true }
  }

  async sendMessage(
    input: SendChatMessageInput
  ): Promise<{ messageId: string; userMessageId: string; contextPackageId: string }> {
    const { sessionId, chatSessionId, content } = input
    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()
    const now = Date.now()

    // 1. Resolve model connection
    const connId = input.connectionId || this.resolveConnectionId(sessionId, chatSessionId)

    // 2. Insert User Message
    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO chat_message(id, chat_session_id, role, content, context_package_id, token_count, state, created_at)
        VALUES (?, ?, 'user', ?, NULL, NULL, 'completed', ?)
      `).run(userMessageId, chatSessionId, content, now)

      db.prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?').run(now, chatSessionId)
    })

    // 3. Auto-compaction check (if historical messages exceed 16, try rolling compaction in background/safe mode)
    const existingMessages = this.listMessages({ sessionId, chatSessionId })
    if (existingMessages.length > 16) {
      try {
        await this.compactSession(sessionId, chatSessionId, connId)
      } catch {
        // Fallback (SPEC 6.8): summary failure trims older messages without blocking current question
      }
    }

    // 4. Auto-assemble and persist immutable ContextPackage (SPEC 6.8, 7.2)
    const currentSession = this.getSession({ sessionId, chatSessionId })
    const contextPackage = await this.contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: currentSession.stage || undefined,
      workflowType: currentSession.workflowType || undefined,
      outlineId: currentSession.outlineId || undefined,
      outlineVersion: currentSession.outlineVersion || undefined,
      instruction: content,
      target: {
        chatId: chatSessionId,
        chapterId: currentSession.targetChapterId || undefined
      },
      includeCreativeRules: true
    })

    // 5. Insert Assistant Message in streaming state
    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO chat_message(id, chat_session_id, role, content, context_package_id, token_count, state, created_at)
        VALUES (?, ?, 'assistant', '', ?, NULL, 'streaming', ?)
      `).run(assistantMessageId, chatSessionId, contextPackage.id, Date.now())
    })

    // 6. Start Streaming pipeline
    const controller = new AbortController()
    this.activeControllers.set(chatSessionId, controller)

    // Run streaming in background execution
    void this.executeChatStream(
      sessionId,
      chatSessionId,
      assistantMessageId,
      connId,
      contextPackage,
      controller
    ).catch((err) => {
      if (err instanceof ProjectError && err.code === 'PROJECT_NOT_OPEN') {
        return
      }
    })

    return {
      messageId: assistantMessageId,
      userMessageId,
      contextPackageId: contextPackage.id
    }
  }

  private async executeChatStream(
    sessionId: string,
    chatSessionId: string,
    messageId: string,
    connectionId: string,
    contextPackage: ContextPackage,
    controller: AbortController
  ): Promise<void> {
    let fullText = ''
    let totalTokens = 0
    let checkpointedText = ''
    let checkpointTimer: NodeJS.Timeout | undefined

    const checkpoint = () => {
      if (fullText === checkpointedText) return
      try {
        this.store.transaction(sessionId, (db) => {
          db.prepare("UPDATE chat_message SET content = ?, token_count = ? WHERE id = ? AND state = 'streaming'")
            .run(fullText, totalTokens > 0 ? totalTokens : null, messageId)
        })
        checkpointedText = fullText
      } catch {}
    }

    const startCheckpointing = () => {
      if (checkpointTimer) return
      checkpointTimer = setInterval(checkpoint, 1000)
      checkpointTimer.unref?.()
    }

    try {
      const messages =
        contextPackage.messages && contextPackage.messages.length > 0
          ? contextPackage.messages
          : [
              { role: 'system' as const, content: contextPackage.systemMessage },
              { role: 'user' as const, content: contextPackage.userMessage }
            ]

      const stream = this.modelGateway.chatCompletionStream({
        connectionId,
        taskType: 'chat',
        priority: 'high',
        messages,
        temperature: contextPackage.creativity?.temperature ?? 0.7,
        signal: controller.signal,
        isContentRequest: true
      })

      for await (const chunk of stream) {
        if (controller.signal.aborted) return
        if (chunk.text) {
          fullText += chunk.text
          startCheckpointing()
        }
        if (chunk.usage?.totalTokens) {
          totalTokens = chunk.usage.totalTokens
        }

        this.callbacks.onDelta?.({
          chatSessionId,
          messageId,
          delta: chunk.text || '',
          fullText,
          state: 'streaming'
        })
      }

      if (controller.signal.aborted) {
        this.finishMessage(sessionId, chatSessionId, messageId, fullText, totalTokens, 'cancelled', contextPackage)
        return
      }

      this.finishMessage(sessionId, chatSessionId, messageId, fullText, totalTokens, 'completed', contextPackage)
    } catch (error) {
      if (error instanceof ProjectError && error.code === 'PROJECT_NOT_OPEN') {
        return
      }
      if (controller.signal.aborted) {
        this.finishMessage(sessionId, chatSessionId, messageId, fullText, totalTokens, 'cancelled', contextPackage)
      } else {
        this.finishMessage(sessionId, chatSessionId, messageId, fullText, totalTokens, 'failed', contextPackage)
      }
    } finally {
      if (checkpointTimer) clearInterval(checkpointTimer)
      this.activeControllers.delete(chatSessionId)
    }
  }

  private finishMessage(
    sessionId: string,
    chatSessionId: string,
    messageId: string,
    fullText: string,
    totalTokens: number,
    state: 'completed' | 'failed' | 'cancelled',
    contextPackage: ContextPackage
  ): void {
    const now = Date.now()

    try {
      this.store.transaction(sessionId, (db) => {
        db.prepare(`
          UPDATE chat_message
          SET content = ?, token_count = ?, state = ?
          WHERE id = ?
        `).run(fullText, totalTokens > 0 ? totalTokens : null, state, messageId)

        db.prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?').run(now, chatSessionId)
      })
    } catch (err) {
      if (err instanceof ProjectError && err.code === 'PROJECT_NOT_OPEN') {
        return
      }
      throw err
    }

    const citations = state === 'completed' ? this.extractCitations(fullText, contextPackage) : []

    const finalMessage: ChatMessage = {
      id: messageId,
      chatSessionId,
      role: 'assistant',
      content: fullText,
      contextPackageId: contextPackage.id,
      tokenCount: totalTokens > 0 ? totalTokens : undefined,
      state,
      citations,
      createdAt: now
    }

    this.callbacks.onDone?.({
      chatSessionId,
      messageId,
      state,
      message: finalMessage,
      contextPackage
    })
  }

  private resolveConnectionId(sessionId: string, chatSessionId: string): string {
    return this.store.read(sessionId, (db) => {
      // 1. Check session connection_id
      const session = db.prepare('SELECT connection_id FROM chat_session WHERE id = ?').get(chatSessionId) as { connection_id: string | null } | undefined
      if (session?.connection_id) {
        try {
          this.connectionStore.get(session.connection_id)
          return session.connection_id
        } catch {}
      }

      // 2. Check task_route for 'chat'
      const route = db.prepare("SELECT connection_id FROM task_route WHERE task_type = 'chat'").get() as { connection_id: string } | undefined
      if (route?.connection_id) {
        try {
          this.connectionStore.get(route.connection_id)
          return route.connection_id
        } catch {}
      }

      // 3. Fallback to first available generation connection
      const allConns = this.connectionStore.list()
      const genConn = allConns.find((c) => c.kind === 'generation')
      if (genConn) return genConn.id

      throw new ProjectError('CONNECTION_NOT_FOUND', '未找到可用的模型连接，请先在连接设置中配置生成模型')
    })
  }

  /**
   * Citation Verification (SPEC 6.8):
   * Maps reference annotations in model output (e.g. [来源1], [1], [设定:xxx]) to valid items in the ContextPackage.
   */
  private extractCitations(text: string, contextPackage: ContextPackage): ChatMessageCitation[] {
    const citations: ChatMessageCitation[] = []
    const retrievedItems = contextPackage.items.filter(
      (i) => i.sourceType === 'retrieved_chunk' || (i.sourceType === 'pinned_source' && i.title?.includes('片段'))
    )
    const knowledgeItems = contextPackage.items.filter(
      (i) => i.sourceType === 'knowledge_entry' || (i.sourceType === 'pinned_source' && i.title?.includes('设定'))
    )

    // Match [来源X] or [X]
    const numberedRegex = /\[来源\s*(\d+)\]|\[(\d+)\]/g
    let match: RegExpExecArray | null
    while ((match = numberedRegex.exec(text)) !== null) {
      const num = parseInt(match[1] || match[2], 10)
      if (num >= 1 && num <= retrievedItems.length) {
        const item = retrievedItems[num - 1]
        if (!citations.some((c) => c.citationNumber === num && c.sourceId === item.sourceId)) {
          citations.push({
            citationNumber: num,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            title: item.title || `正文片段 ${num}`,
            excerpt: item.content ? item.content.slice(0, 150) : ''
          })
        }
      }
    }

    // Match [设定:条目名] or [人物:条目名]
    const namedRegex = /\[(设定|人物|世界观|时间线|伏笔)[:：]([^\]]+)\]/g
    let namedMatch: RegExpExecArray | null
    let extraIndex = retrievedItems.length + 1
    while ((namedMatch = namedRegex.exec(text)) !== null) {
      const name = namedMatch[2].trim()
      const found = knowledgeItems.find((k) => k.title?.includes(name))
      if (found && !citations.some((c) => c.sourceId === found.sourceId)) {
        citations.push({
          citationNumber: extraIndex++,
          sourceType: found.sourceType,
          sourceId: found.sourceId,
          title: found.title || name,
          excerpt: found.content ? found.content.slice(0, 150) : ''
        })
      }
    }

    return citations
  }
}
