import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import { AlertCircle, AlertTriangle, Check, Clock, History, Pencil, RotateCcw, RotateCw, Save, Square, X } from 'lucide-react'
import { CandidateApplyResult, CandidateDetail, CandidateHunk, CandidateSummary, ChapterHeader, CandidateState } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { taskTypeLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'
import { useStreamThrottle } from '../../hooks/useStreamThrottle'
import { computeProportionalScroll, renderDeleteHunkPreview } from '../../utils/diffScrollSync'

export function CandidateReviewDialog({
  sessionId,
  chapters,
  initialCandidateId,
  isReadOnly,
  onClose,
  onApplied
}: {
  sessionId: string
  chapters: ChapterHeader[]
  initialCandidateId?: string
  isReadOnly: boolean
  onClose: () => void
  onApplied: (appliedResult: CandidateApplyResult) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [candidates, setCandidates] = useState<CandidateSummary[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(initialCandidateId || null)
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetail | null>(null)
  const [editingText, setEditingText] = useState('')
  const [isEditingDraft, setIsEditingDraft] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const streaming = useStreamThrottle('')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  const leftPanelRef = useRef<HTMLDivElement | null>(null)
  const rightPanelRef = useRef<HTMLDivElement | null>(null)
  const isSyncingScrollRef = useRef(false)

  const handleLeftScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return
    const left = leftPanelRef.current
    const right = rightPanelRef.current
    if (!left || !right) return

    const targetTop = computeProportionalScroll({
      sourceScrollTop: left.scrollTop,
      sourceScrollHeight: left.scrollHeight,
      sourceClientHeight: left.clientHeight,
      targetScrollHeight: right.scrollHeight,
      targetClientHeight: right.clientHeight
    })
    isSyncingScrollRef.current = true
    right.scrollTop = targetTop
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }, [])

  const handleRightScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return
    const left = leftPanelRef.current
    const right = rightPanelRef.current
    if (!left || !right) return

    const targetTop = computeProportionalScroll({
      sourceScrollTop: right.scrollTop,
      sourceScrollHeight: right.scrollHeight,
      sourceClientHeight: right.clientHeight,
      targetScrollHeight: left.scrollHeight,
      targetClientHeight: left.clientHeight
    })
    isSyncingScrollRef.current = true
    left.scrollTop = targetTop
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }, [])

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.novelAgent.candidate.list({ sessionId })
      setCandidates(list)
      if (list.length > 0 && !selectedCandidateId) {
        setSelectedCandidateId(list[0].id)
      }
    } catch (err) {
      setError(errorText(err, '加载候选列表失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId, selectedCandidateId])

  const loadCandidateDetail = useCallback(async (candidateId: string) => {
    try {
      const detail = await window.novelAgent.candidate.get({ sessionId, candidateId })
      setCandidateDetail(detail)
      setEditingText(detail.editedContent !== null && detail.editedContent !== undefined ? detail.editedContent : detail.rawOutput)
      if (detail.state === 'streaming') {
        setIsStreaming(true)
        streaming.update(detail.rawOutput)
      } else {
        setIsStreaming(false)
      }
    } catch (err) {
      setError(errorText(err, '获取候选详情失败'))
    }
  }, [sessionId])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  useEffect(() => {
    if (selectedCandidateId) {
      void loadCandidateDetail(selectedCandidateId)
    }
  }, [selectedCandidateId, loadCandidateDetail])

  // Streaming real-time updates
  useEffect(() => {
    const unsubDelta = window.novelAgent.candidate.onDelta?.((event) => {
      if (selectedCandidateId === event.candidateId || !selectedCandidateId) {
        if (!selectedCandidateId) setSelectedCandidateId(event.candidateId)
        setIsStreaming(true)
        streaming.update(event.fullText)
      }
    })
    const unsubDone = window.novelAgent.candidate.onDone?.((event) => {
      void loadCandidates()
      if (selectedCandidateId === event.candidateId || !selectedCandidateId) {
        streaming.flush()
        setIsStreaming(false)
        if (event.candidate) {
          setCandidateDetail(event.candidate)
          setEditingText(event.candidate.editedContent !== null && event.candidate.editedContent !== undefined ? event.candidate.editedContent : event.candidate.rawOutput)
        } else {
          void loadCandidateDetail(event.candidateId)
        }
      }
    })
    return () => {
      unsubDelta?.()
      unsubDone?.()
    }
  }, [selectedCandidateId, loadCandidates, loadCandidateDetail, streaming])

  const handleToggleHunk = async (hunk: CandidateHunk) => {
    if (!candidateDetail || isReadOnly || candidateDetail.state !== 'ready') return
    try {
      const updated = await window.novelAgent.candidate.stageHunk({
        sessionId,
        candidateId: candidateDetail.id,
        hunkPosition: hunk.position,
        selected: !hunk.selected,
        expectedVersion: candidateDetail.version
      })
      setCandidateDetail(updated)
    } catch (err) {
      setError(errorText(err, '切换差异块失败'))
    }
  }

  const handleUpdateText = async () => {
    if (!candidateDetail || isReadOnly) return
    setActionLoading(true)
    try {
      const updated = await window.novelAgent.candidate.updateText({
        sessionId,
        candidateId: candidateDetail.id,
        editedContent: editingText,
        expectedVersion: candidateDetail.version
      })
      setCandidateDetail(updated)
      setIsEditingDraft(false)
      void loadCandidates()
    } catch (err) {
      setError(errorText(err, '重算差异失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRetain = async () => {
    if (!candidateDetail) return
    setActionLoading(true)
    try {
      const updated = await window.novelAgent.candidate.retain({
        sessionId,
        candidateId: candidateDetail.id,
        expectedVersion: candidateDetail.version
      })
      setCandidateDetail(updated)
      void loadCandidates()
    } catch (err) {
      setError(errorText(err, '保留草稿失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!candidateDetail) return
    setActionLoading(true)
    try {
      const updated = await window.novelAgent.candidate.reject({
        sessionId,
        candidateId: candidateDetail.id,
        expectedVersion: candidateDetail.version
      })
      setCandidateDetail(updated)
      void loadCandidates()
    } catch (err) {
      setError(errorText(err, '放弃候选失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleApply = async () => {
    if (!candidateDetail || isReadOnly) return
    const targetChap = chapters.find((c) => c.id === candidateDetail.chapterId)
    if (!targetChap) {
      setError('目标章节不存在')
      return
    }
    setActionLoading(true)
    try {
      const res = await window.novelAgent.candidate.apply({
        sessionId,
        candidateId: candidateDetail.id,
        expectedCandidateVersion: candidateDetail.version,
        expectedChapterVersion: targetChap.version
      })
      onApplied(res)
      onClose()
    } catch (err) {
      setError(errorText(err, '写回正文失败'))
      if (selectedCandidateId) void loadCandidateDetail(selectedCandidateId)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelStreaming = async () => {
    if (!candidateDetail?.taskId) return
    try {
      await window.novelAgent.creation.cancel({
        sessionId,
        taskId: candidateDetail.taskId
      })
    } catch (err) {
      setError(errorText(err, '中止生成失败'))
    }
  }

  const targetChap = chapters.find((c) => c.id === candidateDetail?.chapterId)
  const isStale = candidateDetail?.state === 'stale' || (Boolean(targetChap) && targetChap?.version !== candidateDetail?.chapterVersion)

  const hunkStats = candidateDetail?.hunks
    ? {
        total: candidateDetail.hunks.filter((h) => h.hunkType !== 'equal').length,
        selected: candidateDetail.hunks.filter((h) => h.hunkType !== 'equal' && h.selected).length
      }
    : { total: 0, selected: 0 }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        ref={dialogRef}
        className="candidate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="差异审阅与写回"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4 }}
      >
        <header className="dialog-header">
          <div>
            <h2>差异审阅 (Candidate Diff Review)</h2>
            <p>
              逐块选择原文或 AI 候选文本，支持作者直接编辑与两级中文差异重算，单事务原子写回并创建永久快照
            </p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        {/* Status Warning Bar */}
        {isStale && (
          <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', color: '#c2410c', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500 }}>
            <AlertTriangle size={16} />
            <span>候选已过期 (Candidate Expired)：目标章节正文在生成后已被修改，禁止写回正文。请重新生成或比对。</span>
          </div>
        )}
        {candidateDetail?.state === 'failed' && (
          <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <AlertCircle size={16} />
            <span>生成失败 (Failed)：网络或协议异常，已保留已生成的文本内容（只读不可写回）。</span>
          </div>
        )}
        {candidateDetail?.state === 'cancelled' && (
          <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Clock size={16} />
            <span>生成已中止 (Cancelled)：点击下方「保留草稿」可恢复并进入审阅写回流程。</span>
          </div>
        )}

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="candidate-review-body">
          {/* Left History Sidebar */}
          <aside className="candidate-history-sidebar">
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              候选版本列表 ({candidates.length})
            </div>
            <div className="candidate-history-list">
              {candidates.length === 0 ? (
                <p className="empty-hint" style={{ padding: 12 }}>暂无候选版本</p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    className={`candidate-card ${c.id === selectedCandidateId ? 'active' : ''}`}
                    onClick={() => setSelectedCandidateId(c.id)}
                  >
                    <div className="candidate-card-header">
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {c.taskType ? taskTypeLabel[c.taskType] || c.taskType : '正文候选'}
                      </span>
                      <span className={`candidate-badge ${c.state}`}>{c.state}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.previewExcerpt || '无正文'}
                    </span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      {formatDate(c.createdAt)} · v{c.version}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* Main Diff & Review Area */}
          <main className="candidate-split-view">
            {isStreaming ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20 }}>
                <div className="streaming-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RotateCw className="spin" size={15} />
                    <span>AI 正在流式打字生成中... (已接收 {streaming.value.length} 字)</span>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    style={{ color: '#b91c1c', fontSize: 12 }}
                    onClick={() => void handleCancelStreaming()}
                  >
                    <Square size={13} />中止生成
                  </button>
                </div>
                <div className="streaming-typing-area" style={{ marginTop: 12, flex: 1 }}>
                  {streaming.value}
                  <span className="typewriter-cursor" />
                </div>
              </div>
            ) : !candidateDetail ? (
              <div className="empty-copy" style={{ textAlign: 'center', padding: '120px 0' }}>
                <p>请选择一个候选版本查看差异</p>
              </div>
            ) : isEditingDraft ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                    编辑 AI 候选草稿（编辑后将重新计算两级差异，清除旧勾选）:
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="text-button" onClick={() => setIsEditingDraft(false)}>取消</button>
                    <button type="button" className="primary-button" disabled={actionLoading || !editingText.trim()} onClick={() => void handleUpdateText()}>
                      <Check size={14} />重算差异
                    </button>
                  </div>
                </div>
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  style={{ flex: 1, width: '100%', padding: 14, fontFamily: '"Noto Serif SC", serif', fontSize: 15, lineHeight: 1.8, border: '1px solid #cbd5e1', borderRadius: 4 }}
                />
              </div>
            ) : (
              <>
                {/* Hunk stats & Edit action bar */}
                <div className="hunk-controls-bar">
                  <span>
                    差异块：共 <strong>{hunkStats.total}</strong> 处，已采纳 <strong>{hunkStats.selected}</strong> 处
                  </span>
                  <span style={{ color: '#94a3b8' }}>|</span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>
                    提示：点击右侧候选差异块可切换采纳/恢复原文
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {candidateDetail.state === 'ready' && (
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 12 }}
                        onClick={() => setIsEditingDraft(true)}
                      >
                        <Pencil size={13} />编辑草稿
                      </button>
                    )}
                  </div>
                </div>

                {/* Split Headers */}
                <div className="split-header">
                  <div className="split-col-header">
                    <span>原文 (ORIGINAL TEXT)</span>
                    <span style={{ fontWeight: 'normal', color: '#94a3b8' }}>
                      {targetChap?.title || '目标章节'} (第 {candidateDetail.chapterVersion} 版)
                    </span>
                  </div>
                  <div className="split-col-header">
                    <span>AI 候选 (AI CANDIDATE)</span>
                    <span style={{ fontWeight: 'normal', color: '#94a3b8' }}>
                      {candidateDetail.taskType ? taskTypeLabel[candidateDetail.taskType] : '生成内容'}
                    </span>
                  </div>
                </div>

                {/* Split Content Panels */}
                <div className="split-panels-container">
                  {/* Left: Original with red highlights */}
                  <div className="split-panel" ref={leftPanelRef} onScroll={handleLeftScroll}>
                    {candidateDetail.hunks.length === 0 ? (
                      <span>{candidateDetail.originalContent || '(原文为空)'}</span>
                    ) : (
                      candidateDetail.hunks.map((h) => {
                        if (h.hunkType === 'equal') {
                          return <span key={h.position}>{h.originalContent}</span>
                        }
                        if (h.hunkType === 'delete' || h.hunkType === 'replace') {
                          return (
                            <span
                              key={h.position}
                              className={h.selected ? 'diff-remove' : 'diff-unselected'}
                              title="原文内容"
                            >
                              {h.originalContent}
                            </span>
                          )
                        }
                        return null
                      })
                    )}
                  </div>

                  {/* Right: AI Candidate with green highlights and interactive toggling */}
                  <div className="split-panel" ref={rightPanelRef} onScroll={handleRightScroll}>
                    {candidateDetail.hunks.length === 0 ? (
                      <span>{candidateDetail.rawOutput}</span>
                    ) : (
                      candidateDetail.hunks.map((h) => {
                        if (h.hunkType === 'equal') {
                          return <span key={h.position}>{h.candidateContent}</span>
                        }
                        if (h.hunkType === 'insert' || h.hunkType === 'replace') {
                          return (
                            <span
                              key={h.position}
                              className={`hunk-interactive-item ${h.selected ? 'diff-add' : 'diff-unselected'}`}
                              onClick={() => void handleToggleHunk(h)}
                              title={h.selected ? '已采纳候选 (点击切回原文)' : '已保留原文 (点击采纳候选)'}
                            >
                              {h.selected ? h.candidateContent : h.originalContent}
                            </span>
                          )
                        }
                        if (h.hunkType === 'delete') {
                          const preview = renderDeleteHunkPreview(h)
                          return (
                            <span
                              key={h.position}
                              className={preview?.className || `hunk-interactive-item diff-remove ${h.selected ? 'diff-deleted-placeholder' : ''}`}
                              onClick={() => void handleToggleHunk(h)}
                              title={h.selected ? '已删除该段 (点击恢复原文)' : '已保留原文 (点击执行删除)'}
                            >
                              {preview?.isBadge ? (
                                <span className="diff-deleted-badge">
                                  <RotateCcw size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                  {preview.text || '[已删除段落 - 点击恢复]'}
                                </span>
                              ) : (
                                preview?.text || h.originalContent
                              )}
                            </span>
                          )
                        }
                        return null
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>

        {/* Bottom Actions Footer */}
        <footer className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
            <History size={15} />
            <span>写回正文前将自动在快照历史中创建永久 AI 快照 (ai_apply)</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {candidateDetail?.state === 'cancelled' && (
              <button
                type="button"
                className="text-button"
                style={{ color: '#2563eb' }}
                disabled={actionLoading}
                onClick={() => void handleRetain()}
              >
                <Check size={14} />保留草稿为待审阅
              </button>
            )}
            {candidateDetail?.state === 'ready' && (
              <button
                type="button"
                className="text-button"
                disabled={actionLoading}
                onClick={() => void handleReject()}
              >
                <X size={14} />放弃更改
              </button>
            )}
            <button type="button" className="text-button" onClick={onClose}>关闭</button>
            <button
              type="button"
              className="primary-button"
              disabled={
                isReadOnly ||
                actionLoading ||
                candidateDetail?.state !== 'ready' ||
                isStale
              }
              onClick={() => void handleApply()}
            >
              <Save size={14} />{actionLoading ? '写回中...' : '写回正文 (Apply & Snapshot)'}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
