import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, X } from 'lucide-react'
import { AiFactSuggestion, KnowledgeKind, SuggestionState } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { knowledgeKindLabel, suggestionStateLabel } from '../../utils/constants'
import { AcceptancePreviewDialog } from './AcceptancePreviewDialog'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function SuggestionReviewDialog({
  sessionId,
  isReadOnly,
  onClose
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [stateFilter, setStateFilter] = useState<SuggestionState>('pending')
  const [kindFilter, setKindFilter] = useState<'all' | KnowledgeKind>('all')
  const [suggestions, setSuggestions] = useState<AiFactSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [acceptingSuggestion, setAcceptingSuggestion] = useState<AiFactSuggestion | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const list = await window.novelAgent.knowledge.listSuggestions({
        sessionId,
        state: stateFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter
      })
      setSuggestions(list)
      setError('')
    } catch (err) {
      setError(errorText(err, '无法加载建议列表'))
    } finally {
      setLoading(false)
    }
  }, [sessionId, stateFilter, kindFilter])

  useEffect(() => {
    void load()
  }, [load])

  const handleReview = async (s: AiFactSuggestion, state: 'ignored' | 'conflict') => {
    try {
      await window.novelAgent.knowledge.reviewSuggestion({
        sessionId,
        suggestionId: s.id,
        state,
        expectedVersion: s.version
      })
      await load()
    } catch (err) {
      setError(errorText(err, '操作失败'))
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="suggestions-dialog" role="dialog" aria-modal="true" aria-labelledby="suggestions-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="suggestions-title">AI 事实建议审阅</h2>
            <p>审阅模型提炼的人物、设定与时间线事实，带章节证据追溯与可编辑采纳。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="tab-filter-bar">
          <div className="tab-chips">
            <button className={`tab-chip ${stateFilter === 'pending' ? 'active' : ''}`} onClick={() => setStateFilter('pending')}>
              待审阅
            </button>
            <button className={`tab-chip ${stateFilter === 'conflict' ? 'active' : ''}`} onClick={() => setStateFilter('conflict')}>
              存在冲突
            </button>
            <button className={`tab-chip ${stateFilter === 'accepted' ? 'active' : ''}`} onClick={() => setStateFilter('accepted')}>
              已采纳
            </button>
            <button className={`tab-chip ${stateFilter === 'ignored' ? 'active' : ''}`} onClick={() => setStateFilter('ignored')}>
              已忽略
            </button>
          </div>
          <div className="tab-chips">
            <button className={`tab-chip ${kindFilter === 'all' ? 'active' : ''}`} onClick={() => setKindFilter('all')}>
              全部类型
            </button>
            <button className={`tab-chip ${kindFilter === 'character' ? 'active' : ''}`} onClick={() => setKindFilter('character')}>
              人物
            </button>
            <button className={`tab-chip ${kindFilter === 'world' ? 'active' : ''}`} onClick={() => setKindFilter('world')}>
              世界观
            </button>
            <button className={`tab-chip ${kindFilter === 'timeline' ? 'active' : ''}`} onClick={() => setKindFilter('timeline')}>
              时间线
            </button>
            <button className={`tab-chip ${kindFilter === 'foreshadow' ? 'active' : ''}`} onClick={() => setKindFilter('foreshadow')}>
              伏笔
            </button>
          </div>
        </div>

        {error && <p className="inline-error dialog-error">{error}</p>}

        <div className="suggestions-body">
          {loading ? (
            <p className="empty-hint">加载建议列表中...</p>
          ) : suggestions.length === 0 ? (
            <p className="empty-hint">暂无符合条件的建议记录</p>
          ) : (
            suggestions.map((s) => (
              <div key={s.id} className="suggestion-card">
                <div className="suggestion-header">
                  <div className="suggestion-subject">
                    <span className={`source-tag ${s.knowledgeKind}`}>{knowledgeKindLabel[s.knowledgeKind]}</span>
                    <strong>{s.normalizedSubject}</strong>
                    <span className="suggestion-predicate">{s.predicate}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {s.confidence !== null && s.confidence !== undefined && (
                      <span style={{ fontSize: 11, color: '#6b7280' }}>置信度 {Math.round(s.confidence * 100)}%</span>
                    )}
                    <span className={`status-badge ${s.state}`}>{suggestionStateLabel[s.state] || s.state}</span>
                  </div>
                </div>

                <div className="suggestion-content">{s.displayText}</div>

                {s.evidences && s.evidences.length > 0 && (
                  <div className="evidence-box">
                    <span className="evidence-meta">
                      来源证据：{s.evidences[0].chapterTitle || `章节`} (v{s.evidences[0].chapterVersion}) · 字符范围 [{s.evidences[0].startOffset} - {s.evidences[0].endOffset}]
                    </span>
                    <span className="evidence-excerpt">“{s.evidences[0].excerpt}”</span>
                  </div>
                )}

                {!isReadOnly && (s.state === 'pending' || s.state === 'conflict') && (
                  <div className="suggestion-actions">
                    <button type="button" className="text-button" onClick={() => void handleReview(s, 'ignored')}>
                      忽略
                    </button>
                    {s.state !== 'conflict' && (
                      <button type="button" className="text-button" style={{ color: '#b91c1c' }} onClick={() => void handleReview(s, 'conflict')}>
                        标记冲突
                      </button>
                    )}
                    <button type="button" className="primary-button" onClick={() => setAcceptingSuggestion(s)}>
                      <Check size={14} />采纳建议
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <footer className="dialog-footer">
          <span>共 {suggestions.length} 条建议记录</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>

      <AnimatePresence>
        {acceptingSuggestion && (
          <AcceptancePreviewDialog
            sessionId={sessionId}
            suggestion={acceptingSuggestion}
            onClose={() => setAcceptingSuggestion(null)}
            onAccepted={() => {
              setAcceptingSuggestion(null)
              void load()
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
