import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { AiFactSuggestion, KnowledgeEntry, KnowledgeKind } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { knowledgeKindLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function AcceptancePreviewDialog({
  sessionId,
  suggestion,
  onClose,
  onAccepted
}: {
  sessionId: string
  suggestion: AiFactSuggestion
  onClose: () => void
  onAccepted: (entry: KnowledgeEntry) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [mode, setMode] = useState<'new' | 'merge'>('new')
  const [activeEntries, setActiveEntries] = useState<KnowledgeEntry[]>([])
  const [targetEntryId, setTargetEntryId] = useState<string>('')
  const [draftTitle, setDraftTitle] = useState(suggestion.normalizedSubject)
  const [draftKind, setDraftKind] = useState<KnowledgeKind>(suggestion.knowledgeKind)
  const [draftContent, setDraftContent] = useState(suggestion.displayText)
  const [targetExpectedVersion, setTargetExpectedVersion] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.novelAgent.knowledge
      .list({ sessionId, state: 'active' })
      .then((list) => {
        setActiveEntries(list)
        if (list.length > 0 && !targetEntryId) {
          setTargetEntryId(list[0].id)
        }
      })
      .catch(() => {})
  }, [sessionId, targetEntryId])

  const updatePreview = useCallback(async (currentMode: 'new' | 'merge', targetId?: string) => {
    try {
      setError('')
      const preview = await window.novelAgent.knowledge.previewSuggestionAcceptance({
        sessionId,
        suggestionId: suggestion.id,
        targetEntryId: currentMode === 'merge' ? (targetId || undefined) : undefined
      })
      setDraftTitle(preview.draft.title)
      setDraftKind(preview.draft.kind)
      setDraftContent(preview.draft.authorContent)
      setTargetExpectedVersion(preview.targetExpectedVersion)
    } catch (err) {
      setError(errorText(err, '生成预览失败'))
    }
  }, [sessionId, suggestion.id])

  const handleModeChange = (newMode: 'new' | 'merge') => {
    setMode(newMode)
    void updatePreview(newMode, newMode === 'merge' ? targetEntryId : undefined)
  }

  const handleTargetChange = (entryId: string) => {
    setTargetEntryId(entryId)
    if (mode === 'merge') {
      void updatePreview('merge', entryId)
    }
  }

  const handleConfirm = async () => {
    try {
      setSubmitting(true)
      setError('')
      const entry = await window.novelAgent.knowledge.acceptSuggestion({
        sessionId,
        suggestionId: suggestion.id,
        expectedSuggestionVersion: suggestion.version,
        targetEntryId: mode === 'merge' ? targetEntryId : undefined,
        targetExpectedVersion: mode === 'merge' ? (targetExpectedVersion ?? undefined) : undefined,
        draft: {
          title: draftTitle,
          kind: draftKind,
          authorContent: draftContent
        }
      })
      onAccepted(entry)
    } catch (err) {
      setError(errorText(err, '采纳失败，可能发生了版本冲突'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="accept-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="accept-dialog-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="accept-dialog-title">采纳 AI 事实建议</h2>
            <p>作者审核预览并确认后，将原子写入知识条目并更新建议状态。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        {error && <p className="inline-error dialog-error">{error}</p>}
        <div className="accept-body">
          <div className="mode-toggle">
            <label>
              <input type="radio" name="acceptMode" value="new" checked={mode === 'new'} onChange={() => handleModeChange('new')} />
              <span>新建独立知识条目</span>
            </label>
            <label>
              <input type="radio" name="acceptMode" value="merge" checked={mode === 'merge'} disabled={activeEntries.length === 0} onChange={() => handleModeChange('merge')} />
              <span>合并追加至现有条目 {activeEntries.length === 0 && '(暂无活跃条目)'}</span>
            </label>
          </div>

          {mode === 'merge' && (
            <div className="form-field">
              <label>目标知识条目</label>
              <select value={targetEntryId} onChange={(e) => handleTargetChange(e.target.value)}>
                {activeEntries.map((e) => (
                  <option key={e.id} value={e.id}>
                    [{knowledgeKindLabel[e.knowledgeKind]}] {e.title} (v{e.version})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-row">
            <div className="form-field">
              <label>条目标题</label>
              <input value={draftTitle} disabled={mode === 'merge'} onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div className="form-field">
              <label>知识类型</label>
              <select value={draftKind} disabled={mode === 'merge'} onChange={(e) => setDraftKind(e.target.value as KnowledgeKind)}>
                <option value="character">人物</option>
                <option value="world">世界观</option>
                <option value="timeline">时间线</option>
                <option value="foreshadow">伏笔</option>
              </select>
            </div>
          </div>

          <div className="form-field" style={{ flex: 1, minHeight: 180 }}>
            <label>最终写入作者正文 (可手工修订)</label>
            <textarea
              style={{ flex: 1, minHeight: 160 }}
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="正文内容..."
            />
          </div>
        </div>
        <footer className="dialog-footer">
          <button type="button" className="text-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={submitting || !draftTitle.trim()} onClick={() => void handleConfirm()}>
            <Check size={15} />{submitting ? '写入中...' : '确认采纳并写入'}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
