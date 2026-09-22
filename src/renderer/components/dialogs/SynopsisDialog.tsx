import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Compass, Sparkles, X } from 'lucide-react'
import { BookSynopsis, ChapterHeader, ChapterSummary } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function SynopsisDialog({
  sessionId,
  chapters,
  isReadOnly,
  onClose,
  onLaunchNew,
  onLaunchAnalysis
}: {
  sessionId: string
  chapters: ChapterHeader[]
  isReadOnly: boolean
  onClose: () => void
  onLaunchNew: () => void
  onLaunchAnalysis?: (type: 'knowledge' | 'report' | 'synopsis') => void
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
            <button
              className="primary-button"
              disabled={isReadOnly}
              onClick={() => {
                if (summaries.length === 0 && onLaunchAnalysis) {
                  onLaunchAnalysis('knowledge')
                } else {
                  onLaunchNew()
                }
              }}
              title={summaries.length === 0 ? '尚未生成章节摘要，将先启动全书章节分析' : '基于最新章节摘要重新生成全书宏观故事脉络'}
            >
              <Sparkles size={14} />
              {summaries.length === 0 ? '一键提取剧情并生成大纲' : '重新生成故事脉络'}
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
              <div className="empty-copy" style={{ padding: '24px 0', textAlign: 'center' }}>
                <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
                  {summaries.length === 0
                    ? '暂无全书宏观脉络。需先提取章节剧情与摘要，AI 将自动串联生成全书故事走向。'
                    : '已提取章节摘要，可点击右上角「重新生成故事脉络」自动提炼全书大纲。'}
                </p>
                {summaries.length === 0 && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 auto', fontSize: 12.5 }}
                    disabled={isReadOnly}
                    onClick={() => {
                      if (onLaunchAnalysis) onLaunchAnalysis('knowledge')
                      else onLaunchNew()
                    }}
                  >
                    <Sparkles size={13} />
                    <span>立即开始全书章节剧情分析</span>
                  </button>
                )}
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
                <div style={{ padding: '24px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                  <p className="empty-hint" style={{ marginBottom: 12 }}>
                    暂无章节摘要，请先通过剧情分析提取各章事实与摘要
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    style={{ fontSize: 12, color: '#2d5a27', padding: '6px 12px', border: '1px solid #c0d4be', borderRadius: 4 }}
                    disabled={isReadOnly}
                    onClick={() => {
                      if (onLaunchAnalysis) onLaunchAnalysis('knowledge')
                      else onLaunchNew()
                    }}
                  >
                    <Sparkles size={13} />
                    <span>启动章节剧情与知识分析</span>
                  </button>
                </div>
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
