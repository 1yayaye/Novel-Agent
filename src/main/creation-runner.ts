import { randomUUID } from 'node:crypto'
import {
  type CandidateDeltaEvent,
  type CandidateDoneEvent,
  type TaskProgressEvent,
  type TaskType
} from '../shared/project'
import { ProjectError, type ProjectStore } from './project-store'
import type { ModelGateway } from './model-gateway'
import type { ConnectionStore } from './connection-store'
import type { ContextAssembler } from './context-assembler'
import { computeDiffHunks, type CandidateService } from './candidate-service'
import { createStreamThrottler } from './stream-throttle'

export interface CreationCallbacks {
  onDelta?: (event: CandidateDeltaEvent) => void
  onDone?: (event: CandidateDoneEvent) => void
  onProgress?: (event: TaskProgressEvent) => void
}

import { parseCreationOutput, type ParsedCreationOutput } from './output-parser'
export { parseCreationOutput, type ParsedCreationOutput }

export class CreationRunner {
  private readonly activeControllers = new Map<string, AbortController>()
  private callbacks: CreationCallbacks = {}

  constructor(
    private readonly store: ProjectStore,
    private readonly modelGateway: ModelGateway,
    private readonly connectionStore: ConnectionStore,
    private readonly contextAssembler: ContextAssembler,
    private readonly candidateService: CandidateService
  ) {}

  setCallbacks(callbacks: CreationCallbacks): void {
    this.callbacks = callbacks
  }

  async startCreation(sessionId: string, contextPackageId: string): Promise<{ taskId: string; candidateId: string }> {
    // 1. Verify Context Package (SPEC 6.9, 7.2)
    const pkg = await this.contextAssembler.verifyContextPackage(sessionId, contextPackageId)
    if (!pkg.connectionId) {
      throw new ProjectError('CONNECTION_NOT_FOUND', '上下文包未记录有效的生成模型连接，请重新预览')
    }

    // 2. Read context items to locate target chapter and offsets
    const targetItem = pkg.items.find((i) => i.sourceType === 'target_text')
    let chapterId = pkg.target?.chapterId || ''
    let startOffset: number | null = pkg.target?.startOffset ?? null
    let endOffset: number | null = pkg.target?.endOffset ?? null

    this.store.read(sessionId, (db) => {
      // Find chapter by target_json if available
      const rawPkg = db.prepare('SELECT target_json FROM context_package WHERE id = ?').get(contextPackageId) as { target_json: string | null } | undefined
      if (rawPkg?.target_json) {
        try {
          const parsed = JSON.parse(rawPkg.target_json) as { chapterId?: string; startOffset?: number; endOffset?: number }
          if (parsed?.chapterId) {
            chapterId = parsed.chapterId
          }
          if (parsed?.startOffset !== undefined && startOffset === null) {
            startOffset = parsed.startOffset
          }
          if (parsed?.endOffset !== undefined && endOffset === null) {
            endOffset = parsed.endOffset
          }
        } catch {}
      }

      if (!chapterId && targetItem?.sourceId) {
        chapterId = targetItem.sourceId
      }
    })

    let originalContent = ''
    let chapterVersion = 1

    this.store.read(sessionId, (db) => {
      if (!chapterId) {
        const firstChap = db.prepare('SELECT id, version, content FROM chapter WHERE deleted_at IS NULL ORDER BY position LIMIT 1').get() as { id: string; version: number; content: string } | undefined
        if (firstChap) {
          chapterId = firstChap.id
          chapterVersion = firstChap.version
          originalContent = firstChap.content
        } else {
          throw new ProjectError('VALIDATION_ERROR', '作品中没有任何有效章节')
        }
      } else {
        const chap = db.prepare('SELECT id, version, content, deleted_at FROM chapter WHERE id = ?').get(chapterId) as { id: string; version: number; content: string; deleted_at: number | null } | undefined
        if (!chap || chap.deleted_at !== null) {
          throw new ProjectError('VALIDATION_ERROR', '目标章节不存在或已被删除')
        }
        chapterVersion = chap.version

        if (pkg.taskType === 'continue') {
          originalContent = ''
          startOffset = chap.content.length
          endOffset = chap.content.length
        } else {
          originalContent = targetItem?.content || chap.content
        }
      }
    })

    // 3. Outline Confirmation Gate & Stage Check (SPEC 6.9, T08)
    if (pkg.workflowType === 'creation_workflow' || pkg.stage) {
      if (pkg.stage && pkg.stage !== 'content') {
        throw new ProjectError(
          'INVALID_STATE_TRANSITION',
          `创作会话当前处于 [${pkg.stage}] 阶段，必须推进至 [content] 阶段并确认章大纲后方可生成正文候选`
        )
      }
    }

    this.store.read(sessionId, (db) => {
      if (pkg.outlineId) {
        const outlineRow = db
          .prepare('SELECT id, version, state FROM chapter_outline WHERE id = ?')
          .get(pkg.outlineId) as { id: string; version: number; state: string } | undefined
        if (!outlineRow) {
          throw new ProjectError('VALIDATION_ERROR', '关联的章大纲记录不存在')
        }
        if (outlineRow.state === 'draft') {
          throw new ProjectError('VALIDATION_ERROR', '目标章节的大纲尚未确认（处于草稿状态），禁止生成正文候选')
        }
        if (outlineRow.state === 'stale') {
          throw new ProjectError('STALE_CONTEXT_PACKAGE', '关联章大纲已过时，请重新确认章大纲后再生成正文候选')
        }
        if (outlineRow.state !== 'confirmed' && outlineRow.state !== 'current') {
          throw new ProjectError('VALIDATION_ERROR', '章大纲未确认，无法生成正文候选')
        }
      } else if (pkg.workflowType === 'creation_workflow') {
        const confirmedOutline = db
          .prepare(
            "SELECT id, version, state FROM chapter_outline WHERE chapter_id = ? AND state IN ('confirmed', 'current') ORDER BY version DESC LIMIT 1"
          )
          .get(chapterId) as { id: string; version: number; state: string } | undefined
        if (!confirmedOutline) {
          throw new ProjectError('VALIDATION_ERROR', '创作工作流中目标章节尚未确认章大纲，必须先完成章大纲确认方可生成正文候选')
        }
      } else {
        const draftOutline = db
          .prepare(
            "SELECT id, version, state FROM chapter_outline WHERE chapter_id = ? AND state = 'draft' ORDER BY version DESC LIMIT 1"
          )
          .get(chapterId) as { id: string; version: number; state: string } | undefined
        const confirmedOutline = db
          .prepare(
            "SELECT id, version, state FROM chapter_outline WHERE chapter_id = ? AND state IN ('confirmed', 'current') ORDER BY version DESC LIMIT 1"
          )
          .get(chapterId) as { id: string; version: number; state: string } | undefined
        if (draftOutline && !confirmedOutline) {
          throw new ProjectError('VALIDATION_ERROR', '目标章节存在未确认的草稿大纲，请先确认章大纲后方可生成正文候选')
        }
      }
    })

    // 4. Insert Task and Candidate in SQLite transaction
    const taskId = randomUUID()
    const candidateId = randomUUID()
    const now = Date.now()

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO task(id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, created_at, updated_at, started_at)
        VALUES (?, ?, ?, ?, 'running', 0, ?, NULL, ?, ?, ?)
      `).run(
        taskId,
        pkg.taskType,
        JSON.stringify({ chapterId, startOffset, endOffset }),
        pkg.connectionId,
        pkg.estimatedInputTokens,
        now,
        now,
        now
      )

      db.prepare(`
        INSERT INTO candidate(id, task_id, chapter_id, chapter_version, start_offset, end_offset, original_content, raw_output, edited_content, version, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, 1, 'streaming', ?, ?)
      `).run(
        candidateId,
        taskId,
        chapterId,
        chapterVersion,
        startOffset,
        endOffset,
        originalContent,
        now,
        now
      )
    })

    // 4. Launch background streaming process
    const controller = new AbortController()
    this.activeControllers.set(taskId, controller)

    void this.runStreamingGeneration({
      sessionId,
      taskId,
      candidateId,
      chapterId,
      chapterVersion,
      originalContent,
      pkg,
      signal: controller.signal
    })
      .catch((err) => {
        if (err instanceof ProjectError && err.code === 'PROJECT_NOT_OPEN') {
          return
        }
      })
      .finally(() => {
        this.activeControllers.delete(taskId)
      })

    return { taskId, candidateId }
  }

  async regenerateCreation(sessionId: string, candidateId: string, contextPackageId: string): Promise<{ taskId: string; candidateId: string }> {
    this.store.read(sessionId, (db) => {
      const candidate = db.prepare('SELECT id FROM candidate WHERE id = ?').get(candidateId)
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '历史候选不存在')
    })

    return this.startCreation(sessionId, contextPackageId)
  }

  async cancelCreation(sessionId: string, taskId: string): Promise<{ success: true }> {
    const controller = this.activeControllers.get(taskId)
    if (controller) {
      controller.abort()
    }

    this.store.transaction(sessionId, (db) => {
      db.prepare("UPDATE task SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(Date.now(), taskId)
    })

    return { success: true }
  }

  private async runStreamingGeneration(params: {
    sessionId: string
    taskId: string
    candidateId: string
    chapterId: string
    chapterVersion: number
    originalContent: string
    pkg: {
      id?: string
      taskType: TaskType
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      systemMessage: string
      userMessage: string
      connectionId?: string | null
      creativity?: { temperature?: number } | null
      configurationFingerprint: string
    }
    signal: AbortSignal
  }): Promise<void> {
    const { sessionId, taskId, candidateId, chapterId, chapterVersion, originalContent, pkg, signal } = params
    let bufferedText = ''
    let promptTokens = 0
    let completionTokens = 0
    let checkpointedText = ''
    let checkpointTimer: NodeJS.Timeout | undefined
    const throttler = createStreamThrottler<CandidateDeltaEvent>(60, (event) => this.callbacks.onDelta?.(event))

    const checkpoint = () => {
      if (bufferedText === checkpointedText) return
      try {
        this.store.transaction(sessionId, (db) => {
          db.prepare("UPDATE candidate SET raw_output = ?, updated_at = ? WHERE id = ? AND state = 'streaming'")
            .run(bufferedText, Date.now(), candidateId)
        })
        checkpointedText = bufferedText
      } catch {}
    }

    const startCheckpointing = () => {
      if (checkpointTimer) return
      checkpointTimer = setInterval(checkpoint, 1000)
      checkpointTimer.unref?.()
    }

    // Resolve Connection ID for Creation Task
    let connectionId = pkg.connectionId

    if (!connectionId) {
      throw new ProjectError('CONNECTION_NOT_FOUND', '上下文包未记录有效的生成模型连接')
    }

    try {
      const messagesToSend = pkg.messages && pkg.messages.length > 0 ? pkg.messages : [
        { role: 'system' as const, content: pkg.systemMessage },
        { role: 'user' as const, content: pkg.userMessage }
      ]

      const stream = this.modelGateway.chatCompletionStream({
        connectionId,
        taskType: pkg.taskType,
        priority: 'high',
        messages: messagesToSend,
        temperature: pkg.creativity?.temperature,
        signal,
        isContentRequest: true,
        taskId
      })

      for await (const chunk of stream) {
        if (chunk.text) {
          bufferedText += chunk.text
          startCheckpointing()
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens
          completionTokens = chunk.usage.completionTokens
        }
        throttler.push({
          candidateId,
          taskId,
          delta: chunk.text || '',
          fullText: bufferedText,
          state: 'streaming'
        })
      }

      throttler.flush()
      if (signal.aborted) {
        throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
      }

      const now = Date.now()

      // Stream Finished: Check if target chapter version or outline versions have changed during generation (SPEC 6.9, T08)
      let isStale = false
      this.store.read(sessionId, (db) => {
        const chap = db.prepare('SELECT version, deleted_at FROM chapter WHERE id = ?').get(chapterId) as { version: number; deleted_at: number | null } | undefined
        if (!chap || chap.deleted_at !== null || chap.version !== chapterVersion) {
          isStale = true
        }

        if (pkg.id) {
          const rawPkg = db.prepare('SELECT target_versions_json FROM context_package WHERE id = ?').get(pkg.id) as { target_versions_json: string } | undefined
          if (rawPkg) {
            try {
              const targetVersions = JSON.parse(rawPkg.target_versions_json) as Record<string, number>
              for (const [key, expectedVer] of Object.entries(targetVersions)) {
                if (key.startsWith('chapter_outline:')) {
                  const outlineIdKey = key.slice('chapter_outline:'.length)
                  const outline = db.prepare('SELECT version, state FROM chapter_outline WHERE id = ?').get(outlineIdKey) as { version: number; state: string } | undefined
                  if (!outline || outline.version !== expectedVer || outline.state === 'stale') {
                    isStale = true
                  }
                } else if (key.startsWith('book_outline:')) {
                  const bookIdKey = key.slice('book_outline:'.length)
                  const book = db.prepare('SELECT version, state FROM book_outline WHERE id = ?').get(bookIdKey) as { version: number; state: string } | undefined
                  if (!book || book.version !== expectedVer || book.state === 'stale') {
                    isStale = true
                  }
                }
              }
            } catch {}
          }
        }
      })

      const finalState = isStale ? 'stale' : 'ready'

      this.store.transaction(sessionId, (db) => {
        const parsed = parseCreationOutput(bufferedText)
        const cleanContent = parsed.content

        db.prepare(`
          UPDATE candidate
          SET raw_output = ?, state = ?, updated_at = ?
          WHERE id = ?
        `).run(bufferedText, finalState, now, candidateId)

        if (finalState === 'ready') {
          const hunks = computeDiffHunks(originalContent, cleanContent)
          db.prepare('DELETE FROM candidate_hunk WHERE candidate_id = ?').run(candidateId)
          const insertHunk = db.prepare(`
            INSERT INTO candidate_hunk(id, candidate_id, position, hunk_type, original_content, candidate_content, selected)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          for (const h of hunks) {
            insertHunk.run(randomUUID(), candidateId, h.position, h.hunkType, h.originalContent, h.candidateContent, h.selected ? 1 : 0)
          }
        }

        db.prepare(`
          UPDATE task
          SET state = 'completed', output_tokens = ?, updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(completionTokens || Math.ceil(bufferedText.length * 1.3), now, now, taskId)
      })

      const candidateDetail = this.candidateService.getCandidate(sessionId, candidateId)
      this.callbacks.onDone?.({
        candidateId,
        taskId,
        state: finalState,
        candidate: candidateDetail
      })
    } catch (error) {
      throttler.flush()
      if (error instanceof ProjectError && error.code === 'PROJECT_NOT_OPEN') {
        return
      }

      try {
        const now = Date.now()
        const isCancelled = signal.aborted || (error instanceof ProjectError && error.code === 'TASK_CANCELLED')

        if (isCancelled) {
          this.store.transaction(sessionId, (db) => {
            db.prepare(`
              UPDATE candidate
              SET raw_output = ?, state = 'cancelled', updated_at = ?
              WHERE id = ?
            `).run(bufferedText, now, candidateId)

            db.prepare(`
              UPDATE task
              SET state = 'cancelled', output_tokens = ?, updated_at = ?, completed_at = ?
              WHERE id = ?
            `).run(completionTokens || Math.ceil(bufferedText.length * 1.3), now, now, taskId)
          })

          const candidateDetail = this.candidateService.getCandidate(sessionId, candidateId)
          this.callbacks.onDone?.({
            candidateId,
            taskId,
            state: 'cancelled',
            candidate: candidateDetail
          })
        } else {
          const errCode = error instanceof ProjectError ? error.code : 'CONNECTION_FAILED'
          const errMsg = error instanceof Error ? error.message : String(error)

          this.store.transaction(sessionId, (db) => {
            db.prepare(`
              UPDATE candidate
              SET raw_output = ?, state = 'failed', updated_at = ?
              WHERE id = ?
            `).run(bufferedText, now, candidateId)

            db.prepare(`
              UPDATE task
              SET state = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
              WHERE id = ?
            `).run(errCode, errMsg, now, now, taskId)
          })

          const candidateDetail = this.candidateService.getCandidate(sessionId, candidateId)
          this.callbacks.onDone?.({
            candidateId,
            taskId,
            state: 'failed',
            candidate: candidateDetail
          })
        }
      } catch (innerError) {
        if (innerError instanceof ProjectError && innerError.code === 'PROJECT_NOT_OPEN') {
          return
        }
        throw innerError
      }
    } finally {
      if (checkpointTimer) clearInterval(checkpointTimer)
    }
  }
}
