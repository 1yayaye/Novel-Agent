import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Compass, Sparkles, X } from 'lucide-react'
import { BookSynopsis, Chapter, ChapterSummary } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function SynopsisDialog({
  sessionId,
  chapters,
  isReadOnly,
  onClose,
  onLaunchNew
}: {
  sessionId: string
  chapters: Chapter[]
  isReadOnly: boolean
  onClose: () => void
  onLaunchNew: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [synopsis, setSynopsis] = useState<BookSynopsis | null>(null)
  const [summaries, setSummaries] = useState<ChapterSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [syn, sums] = await Promise.all([
        window.novelAgent.synopsis.get({ sessionId }),
        window.novelAgent.chapterSummary.list({ sessionId })
      ])
      setSynopsis(syn)
      setSummaries(sums)
    } catch (err) {
      setError(errorText(err, '加载故事梗概失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="synopsis-dialog" role="dialog" aria-modal="true" aria-label="全书大纲与故事梗概" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>全书故事梗概与章节摘要</h2>
            <p>基于各章节摘要自动滚动的全书宏观故事脉络与细分梗概</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="primary-button" disabled={isReadOnly} onClick={onLaunchNew}>
              <Sparkles size={14} />重新生成大纲
            </button>
            <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </header>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="synopsis-body">
          <div className="global-synopsis-card">
            <div className="global-synopsis-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Compass size={18} style={{ color: '#2d5a27' }} />
                <h3>全书宏观故事脉络</h3>
              </div>
              {synopsis && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge-tag ${synopsis.state === 'current' ? 'confirmed' : 'unconfirmed'}`}>
                    {synopsis.state === 'current' ? '最新有效' : '已过时 (有章节变动)'}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(synopsis.createdAt)}</span>
                </div>
              )}
            </div>

            {loading ? (
              <p className="empty-hint">加载中...</p>
            ) : !synopsis ? (
              <div className="empty-copy" style={{ padding: '20px 0', textAlign: 'center' }}>
                <p>暂无全书大纲。可在完成章节知识分析后自动生成，或点击右上角直接生成。</p>
              </div>
            ) : (
              <div className="synopsis-text-content">
                {synopsis.summary}
              </div>
            )}
          </div>

          <div className="chapter-summaries-section">
            <h3>各章节摘要明细 ({summaries.length})</h3>
            <div className="chapter-summaries-grid">
              {summaries.length === 0 ? (
                <p className="empty-hint">暂无章节摘要，请先在知识分析中分析章节</p>
              ) : (
                summaries.map((sum) => (
                  <div key={sum.id} className="chapter-summary-card">
                    <div className="chapter-summary-header">
                      <strong>{sum.chapterTitle ?? '章节'}</strong>
                      <span className={`badge-tag ${sum.state === 'current' ? 'confirmed' : 'unconfirmed'}`}>
                        {sum.state === 'current' ? `v${sum.chapterVersion}` : '已过时'}
                      </span>
                    </div>
                    <p className="chapter-summary-text">{sum.summary}</p>
                    <span className="chapter-summary-time">{formatDate(sum.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <footer className="dialog-footer">
          <span>章节正文修改后，对应章节摘要及全书大纲将自动标记为过时状态</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
