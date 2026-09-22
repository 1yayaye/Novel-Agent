import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  FileEdit,
  GitCompare,
  Layers,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  StopCircle,
  Trash2,
  User,
  X
} from 'lucide-react'
import type {
  Chapter,
  ChapterHeader,
  ChapterOutline,
  ChatMessage,
  ChatMessageCitation,
  ChatSession,
  ChatSummary,
  ChatWorkflowStage,
  ChatWorkflowType,
  TaskType
} from '../../../shared/project'
import { toChapterHeader } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'
import { useStreamThrottle } from '../../hooks/useStreamThrottle'
import { useToast } from '../common/Toast'
import { isNearBottom, decideScrollBehavior, type ScrollActionType } from '../../utils/chatScroll'

const NEW_CHAPTER_OPTION = '__new_chapter__'

export function ChatWorkbenchDialog({
  sessionId,
  chapters = [],
  activeChapterId,
  isReadOnly,
  onClose,
  onNavigateChapter,
  onInspectContext,
  onOpenOutlineEditor,
  onOpenCandidateReview,
  onOpenContextPreview,
  onChapterCreated
}: {
  sessionId: string
  chapters?: ChapterHeader[]
  activeChapterId?: string
  isReadOnly: boolean
  onClose: () => void
  onNavigateChapter?: (chapterId: string, offset?: number) => void
  onInspectContext?: (contextPackageId: string) => void
  onOpenOutlineEditor?: (chapterId?: string) => void
  onOpenCandidateReview?: (candidateId?: string) => void
  onOpenContextPreview?: (
    taskType?: TaskType,
    chapterId?: string,
    stage?: ChatWorkflowStage,
    outlineId?: string,
    outlineVersion?: number,
    chatSessionId?: string
  ) => void
  onChapterCreated?: (chapter: Chapter) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [summary, setSummary] = useState<ChatSummary | null>(null)
  const [inputContent, setInputContent] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const streaming = useStreamThrottle('')
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [isEditingSummary, setIsEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [newSessionWorkflowType, setNewSessionWorkflowType] = useState<ChatWorkflowType>('creation_workflow')
  const [newSessionChapterId, setNewSessionChapterId] = useState<string>(activeChapterId || chapters[0]?.id || '')
  const [isCreatingNewChapter, setIsCreatingNewChapter] = useState(chapters.length === 0)
  const [newChapterTitleDraft, setNewChapterTitleDraft] = useState(chapters.length === 0 ? '第一章' : '')
  const [localChapters, setLocalChapters] = useState<ChapterHeader[]>(chapters)
  const [hasCustomSessionTitle, setHasCustomSessionTitle] = useState(false)
  const [latestChapterOutline, setLatestChapterOutline] = useState<ChapterOutline | null>(null)
  const [showSummaryBox, setShowSummaryBox] = useState(true)
  const [error, setError] = useState('')
  const { showToast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = useRef(true)

  const checkIsNearBottom = useCallback(() => {
    return isNearBottom(messagesContainerRef.current)
  }, [])

  const handleScroll = useCallback(() => {
    isNearBottomRef.current = checkIsNearBottom()
  }, [checkIsNearBottom])

  const triggerScroll = useCallback((action: ScrollActionType) => {
    const decision = decideScrollBehavior(action, isNearBottomRef.current)
    if (decision.shouldScroll) {
      const container = messagesContainerRef.current
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: decision.behavior })
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: decision.behavior })
      }
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    setError('')
    try {
      const list = await window.novelAgent.chat.list({ sessionId })
      setSessions(list)
      if (list.length > 0) {
        setSelectedSessionId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0].id))
      } else {
        setSelectedSessionId(null)
      }
    } catch (err) {
      setError(errorText(err, '加载问答会话失败'))
    } finally {
      setLoadingSessions(false)
    }
  }, [sessionId])

  const loadSessionDetails = useCallback(async (chatSessionId: string) => {
    setLoadingMessages(true)
    try {
      const [msgList, sum] = await Promise.all([
        window.novelAgent.chat.listMessages({ sessionId, chatSessionId }),
        window.novelAgent.chat.getSummary({ sessionId, chatSessionId })
      ])
      setMessages(msgList)
      setSummary(sum)
      if (sum) {
        setSummaryDraft(sum.content)
      }
      isNearBottomRef.current = true
      window.setTimeout(() => triggerScroll('session_switch'), 0)
    } catch (err) {
      setError(errorText(err, '加载消息记录失败'))
    } finally {
      setLoadingMessages(false)
    }
  }, [sessionId, triggerScroll])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (selectedSessionId) {
      void loadSessionDetails(selectedSessionId)
    } else {
      setMessages([])
      setSummary(null)
    }
  }, [selectedSessionId, loadSessionDetails])

  useEffect(() => {
    if (isStreaming || streaming.value) {
      triggerScroll('stream_delta')
    }
  }, [streaming.value, isStreaming, triggerScroll])

  useEffect(() => {
    const unsubDelta = window.novelAgent.chat.onDelta?.((event) => {
      if (selectedSessionId === event.chatSessionId) {
        setIsStreaming(true)
        setStreamingMessageId(event.messageId)
        streaming.update(event.fullText)
      }
    })

    const unsubDone = window.novelAgent.chat.onDone?.((event) => {
      if (selectedSessionId === event.chatSessionId) {
        streaming.flush()
        setIsStreaming(false)
        setStreamingMessageId(null)
        void loadSessionDetails(selectedSessionId)
      }
    })

    return () => {
      unsubDelta?.()
      unsubDone?.()
    }
  }, [selectedSessionId, loadSessionDetails, streaming])

  // Load latest chapter outline when viewing a creation workflow session
  const loadOutlineForSession = useCallback(async (chapId: string) => {
    try {
      const outline = await window.novelAgent.outline.getLatestChapterOutline({ sessionId, chapterId: chapId })
      setLatestChapterOutline(outline)
    } catch {
      setLatestChapterOutline(null)
    }
  }, [sessionId])

  useEffect(() => {
    const currentSession = sessions.find((s) => s.id === selectedSessionId)
    if (currentSession?.workflowType === 'creation_workflow' && currentSession.targetChapterId) {
      void loadOutlineForSession(currentSession.targetChapterId)
    } else {
      setLatestChapterOutline(null)
    }
  }, [selectedSessionId, sessions, loadOutlineForSession])

  const lastChapterNumber = localChapters.length > 0 ? getChapterNumber(localChapters, localChapters.length - 1) : undefined
  const defaultNewChapterTitle = lastChapterNumber === undefined ? '第一章' : `第 ${lastChapterNumber + 1} 章`

  const enterNewChapterMode = () => {
    setIsCreatingNewChapter(true)
    setNewSessionChapterId('')
    setNewChapterTitleDraft(defaultNewChapterTitle)
    if (!hasCustomSessionTitle) setNewSessionTitle(`创作：${defaultNewChapterTitle}`)
  }

  const handleCreateSession = async () => {
    if (actionLoading) return
    setActionLoading(true)
    setError('')
    try {
      let targetChapId = newSessionChapterId
      let targetChapterTitle = localChapters.find((c) => c.id === targetChapId)?.title

      if (newSessionWorkflowType === 'creation_workflow' && isCreatingNewChapter) {
        const finalChapTitle = newChapterTitleDraft.trim() || defaultNewChapterTitle
        const createdChapter = await window.novelAgent.chapter.create({
          sessionId,
          title: finalChapTitle,
          content: ''
        })
        targetChapId = createdChapter.id
        targetChapterTitle = createdChapter.title
        setLocalChapters((prev) => [...prev, toChapterHeader(createdChapter)])
        setNewSessionChapterId(createdChapter.id)
        setIsCreatingNewChapter(false)
        onChapterCreated?.(createdChapter)
      }

      if (newSessionWorkflowType === 'creation_workflow' && !targetChapId) {
        throw new Error('请选择目标章节')
      }

      const title = newSessionTitle.trim() || (
        newSessionWorkflowType === 'creation_workflow'
          ? `创作：${targetChapterTitle || newChapterTitleDraft.trim() || defaultNewChapterTitle}`
          : '普通问答'
      )
      const created = await window.novelAgent.chat.create({
        sessionId,
        title,
        workflowType: newSessionWorkflowType,
        targetChapterId: newSessionWorkflowType === 'creation_workflow' ? targetChapId : undefined,
        stage: newSessionWorkflowType === 'creation_workflow' ? 'direction' : undefined
      })
      setIsCreatingSession(false)
      setIsCreatingNewChapter(false)
      setNewSessionTitle('')
      setNewChapterTitleDraft('')
      setHasCustomSessionTitle(false)
      await loadSessions()
      setSelectedSessionId(created.id)
    } catch (err) {
      setError(errorText(err, '创建会话失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleUpdateStage = async (
    nextStage: ChatWorkflowStage,
    outlineId?: string,
    outlineVersion?: number
  ) => {
    if (!selectedSessionId || isReadOnly) return
    const currentSession = sessions.find((s) => s.id === selectedSessionId)
    if (!currentSession) return

    setActionLoading(true)
    setError('')
    try {
      const updated = await window.novelAgent.chat.updateStage({
        sessionId,
        chatSessionId: selectedSessionId,
        stage: nextStage,
        targetChapterId: currentSession.targetChapterId || undefined,
        outlineId: outlineId !== undefined ? outlineId : (currentSession.outlineId || undefined),
        outlineVersion: outlineVersion !== undefined ? outlineVersion : (currentSession.outlineVersion || undefined),
        expectedVersion: currentSession.version
      })
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      if (updated.targetChapterId) {
        await loadOutlineForSession(updated.targetChapterId)
      }
    } catch (err) {
      setError(errorText(err, '切换阶段失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteSession = async (chatSessionId: string, expectedVersion: number) => {
    try {
      await window.novelAgent.chat.delete({ sessionId, chatSessionId, expectedVersion })
      await loadSessions()
    } catch (err) {
      setError(errorText(err, '删除会话失败'))
    }
  }

  const handleSendMessage = async () => {
    const text = inputContent.trim()
    if (!text || !selectedSessionId || isStreaming || isReadOnly) return

    setInputContent('')
    setIsStreaming(true)
    streaming.flush()
    isNearBottomRef.current = true
    triggerScroll('user_send')

    try {
      await window.novelAgent.chat.send({
        sessionId,
        chatSessionId: selectedSessionId,
        content: text
      })
    } catch (err) {
      setIsStreaming(false)
      setError(errorText(err, '发送消息失败'))
    }
  }

  const handleCancelChat = async () => {
    if (!selectedSessionId) return
    try {
      await window.novelAgent.chat.cancel({ sessionId, chatSessionId: selectedSessionId })
      setIsStreaming(false)
      streaming.flush()
      await loadSessionDetails(selectedSessionId)
    } catch (err) {
      setError(errorText(err, '取消生成失败'))
    }
  }

  const handleCompactSession = async () => {
    if (!selectedSessionId || actionLoading) return
    setActionLoading(true)
    setError('')
    try {
      const compacted = await window.novelAgent.chat.compact({ sessionId, chatSessionId: selectedSessionId })
      setSummary(compacted)
      setSummaryDraft(compacted.content)
      setShowSummaryBox(true)
    } catch (err) {
      setError(errorText(err, '压缩会话历史失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveSummary = async () => {
    if (!summary || !selectedSessionId) return
    setActionLoading(true)
    setError('')
    try {
      const updated = await window.novelAgent.chat.updateSummary({
        sessionId,
        summaryId: summary.id,
        content: summaryDraft,
        expectedVersion: summary.version
      })
      setSummary(updated)
      setIsEditingSummary(false)
    } catch (err) {
      setError(errorText(err, '更新摘要备忘失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const currentSession = sessions.find((s) => s.id === selectedSessionId)
  const targetChapter = localChapters.find((c) => c.id === currentSession?.targetChapterId)
  const targetChapterIndex = targetChapter ? localChapters.indexOf(targetChapter) : -1
  const targetChapterNumber = targetChapterIndex >= 0 ? getChapterNumber(localChapters, targetChapterIndex) : undefined

  const STAGES: Array<{ id: ChatWorkflowStage; label: string; index: number }> = [
    { id: 'direction', label: '1. 方向确认', index: 1 },
    { id: 'chapter_outline', label: '2. 章大纲规划', index: 2 },
    { id: 'content', label: '3. 正文生成', index: 3 },
    { id: 'reviewed', label: '4. 审阅完成', index: 4 }
  ]

  const currentStageIndex = currentSession?.stage
    ? STAGES.findIndex((s) => s.id === currentSession.stage) + 1
    : 0

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div
        ref={dialogRef}
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-dialog-title"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
      >
        <div className="chat-layout">
          {/* Left Session Sidebar */}
          <aside className="chat-sidebar">
            <div className="chat-sidebar-header">
              <span id="chat-dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageSquare size={16} />项目问答与创作
              </span>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: 12 }}
                disabled={isReadOnly}
                onClick={() => {
                  const empty = localChapters.length === 0
                  const chapterId = activeChapterId && localChapters.some((chapter) => chapter.id === activeChapterId)
                    ? activeChapterId
                    : localChapters[0]?.id || ''
                  const chapter = localChapters.find((item) => item.id === chapterId)
                  setIsCreatingSession(true)
                  setHasCustomSessionTitle(false)
                  setNewSessionChapterId(chapterId)
                  setIsCreatingNewChapter(newSessionWorkflowType === 'creation_workflow' && empty)
                  setNewChapterTitleDraft(empty ? defaultNewChapterTitle : '')
                  setNewSessionTitle(
                    newSessionWorkflowType === 'creation_workflow'
                      ? `创作：${empty ? defaultNewChapterTitle : chapter?.title || '章节'}`
                      : ''
                  )
                }}
              >
                <Plus size={14} />新建
              </button>
            </div>

            {isCreatingSession && (
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`tab-chip ${newSessionWorkflowType === 'creation_workflow' ? 'active' : ''}`}
                    style={{ flex: 1, justifyContent: 'center', padding: '4px 6px', fontSize: 11 }}
                    onClick={() => {
                      setNewSessionWorkflowType('creation_workflow')
                      if (localChapters.length === 0) {
                        enterNewChapterMode()
                      } else if (!hasCustomSessionTitle) {
                        const chapter = localChapters.find((item) => item.id === newSessionChapterId)
                        if (chapter) setNewSessionTitle(`创作：${chapter.title}`)
                      }
                    }}
                  >
                    创作工作流
                  </button>
                  <button
                    type="button"
                    className={`tab-chip ${newSessionWorkflowType === 'free_chat' ? 'active' : ''}`}
                    style={{ flex: 1, justifyContent: 'center', padding: '4px 6px', fontSize: 11 }}
                    onClick={() => {
                      setNewSessionWorkflowType('free_chat')
                      if (!hasCustomSessionTitle) setNewSessionTitle('')
                    }}
                  >
                    普通问答
                  </button>
                </div>

                {newSessionWorkflowType === 'creation_workflow' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <label style={{ fontSize: 11, color: '#64748b' }}>目标章节{isCreatingNewChapter ? ' (新建)' : ''}</label>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11 }}
                        disabled={localChapters.length === 0}
                        onClick={() => {
                          if (isCreatingNewChapter) {
                            const chapterId = newSessionChapterId || localChapters[0]?.id || ''
                            const chapter = localChapters.find((item) => item.id === chapterId)
                            setIsCreatingNewChapter(false)
                            setNewSessionChapterId(chapterId)
                            if (!hasCustomSessionTitle) setNewSessionTitle(chapter ? `创作：${chapter.title}` : '')
                          } else {
                            enterNewChapterMode()
                          }
                        }}
                      >
                        {isCreatingNewChapter ? '选择已有章节' : '+ 新建新一章'}
                      </button>
                    </div>
                    {isCreatingNewChapter ? (
                      <input
                        value={newChapterTitleDraft}
                        placeholder={defaultNewChapterTitle}
                        onChange={(e) => {
                          const value = e.target.value
                          setNewChapterTitleDraft(value)
                          if (!hasCustomSessionTitle) setNewSessionTitle(`创作：${value.trim() || defaultNewChapterTitle}`)
                        }}
                        style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, background: '#fff' }}
                      />
                    ) : (
                      <select
                        value={newSessionChapterId}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value === NEW_CHAPTER_OPTION) {
                            enterNewChapterMode()
                            return
                          }
                          setNewSessionChapterId(value)
                          if (!hasCustomSessionTitle) {
                            const chapter = localChapters.find((item) => item.id === value)
                            if (chapter) setNewSessionTitle(`创作：${chapter.title}`)
                          }
                        }}
                        style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, background: '#fff' }}
                      >
                        {localChapters.map((c, index) => {
                          const chapterNumber = getChapterNumber(localChapters, index)
                          return (
                            <option key={c.id} value={c.id}>
                              {chapterNumber === undefined ? '' : `第 ${chapterNumber} 章: `}{c.title}
                            </option>
                          )
                        })}
                        <option value={NEW_CHAPTER_OPTION}>➕ 新建新一章...</option>
                      </select>
                    )}
                  </div>
                )}

                <input
                  autoFocus
                  placeholder={newSessionWorkflowType === 'creation_workflow' ? '会话标题（默认：章节创作）' : '输入会话主题...'}
                  value={newSessionTitle}
                  onChange={(e) => {
                    const value = e.target.value
                    setNewSessionTitle(value)
                    setHasCustomSessionTitle(value.trim().length > 0)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateSession()
                    if (e.key === 'Escape') setIsCreatingSession(false)
                  }}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button type="button" className="text-button" style={{ fontSize: 11 }} onClick={() => setIsCreatingSession(false)}>取消</button>
                  <button type="button" className="primary-button" style={{ fontSize: 11, padding: '3px 10px' }} disabled={actionLoading} onClick={() => void handleCreateSession()}>{actionLoading ? '创建中...' : '创建'}</button>
                </div>
              </div>
            )}

            <div className="chat-sidebar-list">
              {loadingSessions ? (
                <div style={{ padding: 16, fontSize: 12, color: '#94a3b8' }}>正在加载会话...</div>
              ) : sessions.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  暂无问答会话<br />点击上方新建开始创作
                </div>
              ) : (
                sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className={`chat-session-item ${sess.id === selectedSessionId ? 'active' : ''}`}
                    onClick={() => {
                      if (!isStreaming) setSelectedSessionId(sess.id)
                    }}
                  >
                    <div className="chat-session-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {sess.workflowType === 'creation_workflow' ? (
                          <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>
                            创作
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, background: '#f1f5f9', color: '#475569', padding: '1px 4px', borderRadius: 3 }}>
                            问答
                          </span>
                        )}
                        <span className="chat-session-title">{sess.title}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                        <span className="chat-session-date">{formatDate(sess.updatedAt)}</span>
                        {sess.stage && (
                          <span style={{ fontSize: 10, color: '#059669', fontWeight: 500 }}>
                            {sess.stage === 'direction' && '1.方向'}
                            {sess.stage === 'chapter_outline' && '2.大纲'}
                            {sess.stage === 'content' && '3.正文'}
                            {sess.stage === 'reviewed' && '4.完成'}
                          </span>
                        )}
                      </div>
                    </div>
                    <IconButton
                      label="删除会话"
                      onClick={() => void handleDeleteSession(sess.id, sess.version)}
                      disabled={isReadOnly || isStreaming}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Right Main Chat Area */}
          <main className="chat-main">
            <header className="chat-header-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontSize: 15, color: '#1e293b' }}>
                  {currentSession ? currentSession.title : '请选择或创建会话'}
                </strong>
                {currentSession && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    v{currentSession.version} · {messages.length} 条对话
                    {targetChapter && ` · 目标: ${targetChapterNumber === undefined ? targetChapter.title : `第${targetChapterNumber}章「${targetChapter.title}」`}`}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {currentSession && messages.length >= 6 && (
                  <button
                    type="button"
                    className="text-button"
                    style={{ fontSize: 12, color: '#b45309' }}
                    disabled={actionLoading || isStreaming}
                    onClick={() => void handleCompactSession()}
                    title="压缩较早的历史对话生成滚动事实摘要"
                  >
                    <Sparkles size={13} />{actionLoading ? '压缩中...' : '压缩前期历史'}
                  </button>
                )}
                <IconButton label="关闭问答" onClick={onClose}><X size={18} /></IconButton>
              </div>
            </header>

            {/* Creation Workflow Stage Stepper Bar */}
            {currentSession?.workflowType === 'creation_workflow' && (
              <div className="workflow-stepper-bar" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
                  {STAGES.map((st, idx) => {
                    const isActive = currentSession.stage === st.id
                    const isPassed = currentStageIndex > st.index
                    return (
                      <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '3px 10px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: isActive ? 700 : 500,
                            background: isActive ? '#2d5a27' : isPassed ? '#e8efe5' : '#f1f5f9',
                            color: isActive ? '#ffffff' : isPassed ? '#2d5a27' : '#94a3b8',
                            border: isActive ? '1px solid #2d5a27' : '1px solid transparent'
                          }}
                        >
                          {isPassed ? <Check size={12} /> : <span>{st.index}</span>}
                          <span>{st.label.replace(/^\d+\.\s*/, '')}</span>
                        </div>
                        {idx < STAGES.length - 1 && (
                          <ChevronRight size={12} style={{ color: '#cbd5e1' }} />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Stage Action Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {currentSession.stage === 'direction' && (
                    <button
                      type="button"
                      className="primary-button"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      disabled={actionLoading || isStreaming || isReadOnly}
                      onClick={() => void handleUpdateStage('chapter_outline')}
                      title="方向确认完毕，推进至章大纲规划阶段"
                    >
                      <span>推进至章大纲</span>
                      <ArrowRight size={13} />
                    </button>
                  )}

                  {currentSession.stage === 'chapter_outline' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, color: '#4b5563', padding: '4px 8px' }}
                        disabled={actionLoading || isStreaming || isReadOnly}
                        onClick={() => void handleUpdateStage('direction')}
                      >
                        <RotateCcw size={12} />返回方向
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 12, color: '#059669', padding: '4px 8px' }}
                        onClick={() => onOpenOutlineEditor?.(currentSession.targetChapterId || undefined)}
                        title="打开三层大纲编辑器"
                      >
                        <Compass size={13} />编辑大纲
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        disabled={actionLoading || isStreaming || isReadOnly}
                        onClick={async () => {
                          // If outline is confirmed, pass its id and version
                          if (latestChapterOutline && (latestChapterOutline.state === 'confirmed' || latestChapterOutline.state === 'current')) {
                            await handleUpdateStage('content', latestChapterOutline.id, latestChapterOutline.version)
                          } else if (latestChapterOutline && latestChapterOutline.state === 'draft') {
                            // Confirm then update stage
                            const confirmed = await window.novelAgent.outline.confirmChapterOutline({
                              sessionId,
                              outlineId: latestChapterOutline.id,
                              expectedVersion: latestChapterOutline.version
                            })
                            await handleUpdateStage('content', confirmed.id, confirmed.version)
                          } else {
                            // Prompt user to write/save outline first
                            showToast('请先在右侧对话中生成并保存章大纲，或点击「编辑大纲」完成大纲确认。', 'warning')
                          }
                        }}
                      >
                        <Check size={13} />锁定大纲并进入正文
                      </button>
                    </div>
                  )}

                  {currentSession.stage === 'content' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, color: '#4b5563', padding: '4px 8px' }}
                        disabled={actionLoading || isStreaming || isReadOnly}
                        onClick={() => void handleUpdateStage('chapter_outline')}
                      >
                        <RotateCcw size={12} />重修大纲
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 12, color: '#2563eb', padding: '4px 8px' }}
                        onClick={() => onOpenCandidateReview?.()}
                      >
                        <GitCompare size={13} />差异审阅
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          onOpenContextPreview?.(
                            'continue',
                            currentSession.targetChapterId || undefined,
                            'content',
                            currentSession.outlineId || undefined,
                            currentSession.outlineVersion || undefined,
                            currentSession.id
                          )
                        }}
                      >
                        <Sparkles size={13} />生成正文候选
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, color: '#166534', padding: '4px 8px' }}
                        disabled={actionLoading || isStreaming || isReadOnly}
                        onClick={() => void handleUpdateStage('reviewed')}
                      >
                        <Check size={12} />标记完成
                      </button>
                    </div>
                  )}

                  {currentSession.stage === 'reviewed' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                        ✓ 本章已审阅完成
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, color: '#2563eb', padding: '4px 8px' }}
                        disabled={actionLoading || isStreaming || isReadOnly}
                        onClick={() => void handleUpdateStage('content')}
                      >
                        重新生成
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rolling Summary Strip */}
            {summary && summary.content && (
              <div className="chat-summary-strip">
                <div className="chat-summary-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => setShowSummaryBox((prev) => !prev)}>
                    {showSummaryBox ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span>会话滚动记忆与摘要 (v{summary.version})</span>
                    {summary.authorEdited && (
                      <span style={{ fontSize: 11, background: '#fef3c7', padding: '1px 6px', borderRadius: 4, color: '#b45309', border: '1px solid #fde68a' }}>
                        作者已修订保护
                      </span>
                    )}
                  </div>
                  {!isEditingSummary ? (
                    <button
                      type="button"
                      className="text-button"
                      style={{ fontSize: 11, color: '#92400e' }}
                      disabled={isReadOnly}
                      onClick={() => {
                        setSummaryDraft(summary.content)
                        setIsEditingSummary(true)
                      }}
                    >
                      <Pencil size={12} />编辑备忘
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="text-button" style={{ fontSize: 11 }} onClick={() => setIsEditingSummary(false)}>取消</button>
                      <button type="button" className="primary-button" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void handleSaveSummary()}>保存修订</button>
                    </div>
                  )}
                </div>

                {showSummaryBox && (
                  isEditingSummary ? (
                    <textarea
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                      style={{ width: '100%', minHeight: 80, padding: 8, borderRadius: 4, border: '1px solid #fde68a', fontSize: 12, fontFamily: 'monospace' }}
                    />
                  ) : (
                    <div className="chat-summary-content">
                      {summary.content}
                    </div>
                  )
                )}
              </div>
            )}

            {error && (
              <div style={{ padding: '6px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                {error}
              </div>
            )}

            {/* Message List */}
            <div className="chat-messages-container" ref={messagesContainerRef} onScroll={handleScroll}>
              {loadingMessages ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  正在加载对话记录...
                </div>
              ) : !selectedSessionId ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                  <MessageSquare size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <p>请在左侧选择一个会话或新建会话开始提问</p>
                </div>
              ) : messages.length === 0 && !isStreaming ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                  <Bot size={36} style={{ margin: '0 auto 12px', opacity: 0.4, color: '#059669' }} />
                  <h3>向 AI 助手提问小说内容</h3>
                  <p style={{ fontSize: 13, marginTop: 4 }}>
                    系统会自动装配正文片段、设定库与规则作为检索证据，并在回答中提供引用溯源。
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <div key={msg.id} className={`chat-message-row ${msg.role}`}>
                      <div className={`chat-avatar ${msg.role}`}>
                        {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                      </div>
                      <div className={`chat-bubble ${msg.role}`}>
                        <div className="chat-message-text">
                          {msg.content}
                          {msg.state === 'streaming' && msg.id === streamingMessageId && (
                            <>
                              {streaming.value.slice(msg.content.length)}
                              <span className="typewriter-cursor" />
                            </>
                          )}
                        </div>

                        {/* Citations list */}
                        {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                          <div className="chat-citations-list">
                            <span style={{ fontSize: 11, color: '#64748b', marginRight: 2 }}>参考来源:</span>
                            {msg.citations.map((c) => (
                              <span
                                key={`${c.citationNumber}-${c.sourceId}`}
                                className="citation-chip"
                                title={c.excerpt ? `「${c.excerpt}」` : c.title}
                                onClick={() => {
                                  if (c.sourceType === 'chapter_chunk' || c.sourceType === 'retrieved_chunk') {
                                    onNavigateChapter?.(c.sourceId)
                                  }
                                }}
                              >
                                <span>[{c.citationNumber}] {c.title}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="chat-message-meta">
                          <span>{formatDate(msg.createdAt)}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {msg.tokenCount && (
                              <span>~{msg.tokenCount} tokens</span>
                            )}
                            {msg.contextPackageId && (
                              <button
                                type="button"
                                className="text-button"
                                style={{ fontSize: 11, color: '#2563eb', padding: 0 }}
                                onClick={() => onInspectContext?.(msg.contextPackageId!)}
                                title="查看本次问答装配的不可变上下文证据包"
                              >
                                <Layers size={11} />装配证据
                              </button>
                            )}
                            {msg.state === 'cancelled' && (
                              <span style={{ color: '#94a3b8' }}>[已取消]</span>
                            )}
                            {msg.state === 'failed' && (
                              <span style={{ color: '#ef4444' }}>[生成失败]</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Temporary Streaming Bubble if not in list yet */}
                  {isStreaming && !messages.some((m) => m.state === 'streaming') && (
                    <div className="chat-message-row assistant">
                      <div className="chat-avatar assistant">
                        <Bot size={16} />
                      </div>
                      <div className="chat-bubble assistant">
                        <div className="chat-message-text">
                          {streaming.value}
                          <span className="typewriter-cursor" />
                        </div>
                        <div className="chat-message-meta">
                          <span>正在思考与生成...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Footer */}
            <footer className="chat-input-area">
              <div className="chat-input-box">
                <textarea
                  className="chat-input-textarea"
                  placeholder={
                    isReadOnly
                      ? '项目处于只读模式'
                      : !selectedSessionId
                      ? '请先选择或新建一个会话'
                      : '输入问题，如剧情逻辑、角色设定、前文细节... (Enter 发送，Shift+Enter 换行)'
                  }
                  value={inputContent}
                  disabled={isReadOnly || !selectedSessionId || isStreaming}
                  onChange={(e) => setInputContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleSendMessage()
                    }
                  }}
                />
                {isStreaming ? (
                  <button
                    type="button"
                    className="danger-button"
                    style={{ height: 42, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => void handleCancelChat()}
                  >
                    <StopCircle size={15} />停止生成
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ height: 42, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                    disabled={isReadOnly || !selectedSessionId || !inputContent.trim()}
                    onClick={() => void handleSendMessage()}
                  >
                    <Send size={15} />发送
                  </button>
                )}
              </div>
            </footer>
          </main>
        </div>
      </motion.div>
    </motion.div>
  )
}
