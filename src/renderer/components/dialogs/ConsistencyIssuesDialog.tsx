import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Bookmark, Check, CheckCircle2, Eye, X } from 'lucide-react'
import { ChapterHeader, ConsistencyIssue, ConsistencyIssueSeverity, ConsistencyIssueState } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { consistencySeverityLabel, consistencyIssueTypeLabel, consistencyStateLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function ConsistencyIssuesDialog({
  sessionId,
  chapters,
  isReadOnly,
  onClose,
  onNavigateChapter
}: {
  sessionId: string
  chapters: ChapterHeader[]
  isReadOnly: boolean
  onClose: () => void
  onNavigateChapter: (chapterId: string, startOffset?: number, length?: number) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [issues, setIssues] = useState<ConsistencyIssue[]>([])
  const [stateFilter, setStateFilter] = useState<'all' | ConsistencyIssueState>('open')
  const [severityFilter, setSeverityFilter] = useState<'all' | ConsistencyIssueSeverity>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadIssues = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.novelAgent.consistencyIssue.list({
        sessionId,
        state: stateFilter === 'all' ? undefined : stateFilter,
        severity: severityFilter === 'all' ? undefined : severityFilter
      })
      setIssues(list)
      setError('')
    } catch (err) {
      setError(errorText(err, '加载一致性问题失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId, stateFilter, severityFilter])

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  const handleReview = async (issue: ConsistencyIssue, nextState: 'acknowledged' | 'dismissed') => {
    try {
      await window.novelAgent.consistencyIssue.review({
        sessionId,
        issueId: issue.id,
        state: nextState,
        expectedVersion: issue.version
      })
      await loadIssues()
    } catch (err) {
      setError(errorText(err, '审阅问题状态失败'))
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="consistency-dialog" role="dialog" aria-modal="true" aria-label="一致性问题审阅" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>故事一致性与矛盾检测</h2>
            <p>审阅 AI 知识分析发现的剧情漏洞、人设偏差、时间线错位与设定冲突</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="search-filter-bar" style={{ justifyContent: 'space-between' }}>
          <div className="source-filter-chips">
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', marginRight: 4 }}>状态:</span>
            <button className={stateFilter === 'all' ? 'filter-chip active' : 'filter-chip'} onClick={() => setStateFilter('all')}>全部</button>
            <button className={stateFilter === 'open' ? 'filter-chip active' : 'filter-chip'} onClick={() => setStateFilter('open')}>待处理</button>
            <button className={stateFilter === 'acknowledged' ? 'filter-chip active' : 'filter-chip'} onClick={() => setStateFilter('acknowledged')}>已确认</button>
            <button className={stateFilter === 'dismissed' ? 'filter-chip active' : 'filter-chip'} onClick={() => setStateFilter('dismissed')}>已忽略</button>
            <button className={stateFilter === 'stale' ? 'filter-chip active' : 'filter-chip'} onClick={() => setStateFilter('stale')}>已过时</button>
          </div>

          <div className="source-filter-chips">
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', marginRight: 4 }}>严重程度:</span>
            <button className={severityFilter === 'all' ? 'filter-chip active' : 'filter-chip'} onClick={() => setSeverityFilter('all')}>全部</button>
            <button className={severityFilter === 'high' ? 'filter-chip active' : 'filter-chip'} onClick={() => setSeverityFilter('high')}>严重</button>
            <button className={severityFilter === 'medium' ? 'filter-chip active' : 'filter-chip'} onClick={() => setSeverityFilter('medium')}>中等</button>
            <button className={severityFilter === 'low' ? 'filter-chip active' : 'filter-chip'} onClick={() => setSeverityFilter('low')}>轻微</button>
          </div>
        </div>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="consistency-body">
          {loading ? (
            <p className="empty-hint">加载中...</p>
          ) : issues.length === 0 ? (
            <div className="empty-copy" style={{ textAlign: 'center', padding: '60px 0' }}>
              <CheckCircle2 size={32} style={{ color: '#2d5a27', marginBottom: 12 }} />
              <h3>暂无匹配的一致性问题</h3>
              <p>当前筛选条件下未发现叙事矛盾或一致性缺陷。</p>
            </div>
          ) : (
            <div className="consistency-list">
              {issues.map((issue) => {
                const chap = chapters.find((c) => c.id === issue.chapterId)
                const evidence = issue.evidences[0]
                return (
                  <div key={issue.id} className={`issue-card ${issue.severity}`}>
                    <div className="issue-card-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`severity-tag ${issue.severity}`}>{consistencySeverityLabel[issue.severity]}</span>
                        <span className="issue-type-badge">{consistencyIssueTypeLabel[issue.issueType]}</span>
                        <span className="issue-chap-badge">
                          {chap ? chap.title : `章节 (v${issue.chapterVersion})`}
                        </span>
                        <span className={`issue-state-badge ${issue.state}`}>
                          {consistencyStateLabel[issue.state]}
                        </span>
                      </div>
                      <span className="issue-time">{formatDate(issue.createdAt)}</span>
                    </div>

                    <div className="issue-desc">
                      <p>{issue.description}</p>
                    </div>

                    {evidence && (
                      <div className="issue-evidence-box">
                        <div className="evidence-label">
                          <Bookmark size={11} />
                          <span>原文证据 (偏移量: {evidence.startOffset} - {evidence.endOffset})</span>
                        </div>
                        <blockquote className="evidence-quote">"{evidence.excerpt}"</blockquote>
                      </div>
                    )}

                    <div className="issue-actions">
                      {evidence && (
                        <button
                          type="button"
                          className="text-button"
                          style={{ fontSize: 12 }}
                          onClick={() => {
                            onNavigateChapter(issue.chapterId, evidence.startOffset, evidence.endOffset - evidence.startOffset)
                            onClose()
                          }}
                        >
                          <Eye size={13} />定位原文
                        </button>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                        {issue.state === 'open' && (
                          <>
                            <button
                              type="button"
                              className="text-button"
                              style={{ color: '#2d5a27', fontSize: 12 }}
                              disabled={isReadOnly}
                              onClick={() => void handleReview(issue, 'acknowledged')}
                            >
                              <Check size={13} />确认已知
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              style={{ color: '#6b7280', fontSize: 12 }}
                              disabled={isReadOnly}
                              onClick={() => void handleReview(issue, 'dismissed')}
                            >
                              <X size={13} />忽略
                            </button>
                          </>
                        )}
                        {issue.state === 'acknowledged' && (
                          <button
                            type="button"
                            className="text-button"
                            style={{ color: '#6b7280', fontSize: 12 }}
                            disabled={isReadOnly}
                            onClick={() => void handleReview(issue, 'dismissed')}
                          >
                            <X size={13} />改为忽略
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="dialog-footer">
          <span>章节正文修改后，相关未处理问题将自动标记为已过时 (stale)</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
