import { useState, useEffect, useCallback } from 'react'
import { Bookmark, Check, CheckCircle2, Eye, X } from 'lucide-react'
import { ChapterHeader, ConsistencyIssue, ConsistencyIssueSeverity, ConsistencyIssueState } from '../../../shared/project'
import { errorText, formatDate } from '../../utils/formatters'
import { consistencySeverityLabel, consistencyIssueTypeLabel, consistencyStateLabel } from '../../utils/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col max-h-[85vh] sm:max-w-4xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>故事一致性与矛盾检测</DialogTitle>
          <DialogDescription>
            审阅 AI 知识分析发现的剧情漏洞、人设偏差、时间线错位与设定冲突
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2.5 text-xs px-6">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#7d6b59] mr-1">状态:</span>
            {[
              { id: 'all', label: '全部' },
              { id: 'open', label: '待处理' },
              { id: 'acknowledged', label: '已确认' },
              { id: 'dismissed', label: '已忽略' },
              { id: 'stale', label: '已过时' }
            ].map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={stateFilter === item.id ? 'primary' : 'ghost'}
                size="sm"
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                  stateFilter === item.id
                    ? 'bg-[#2d6a4f] text-white'
                    : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                }`}
                onClick={() => setStateFilter(item.id as any)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#7d6b59] mr-1">严重度:</span>
            {[
              { id: 'all', label: '全部' },
              { id: 'high', label: '严重' },
              { id: 'medium', label: '中等' },
              { id: 'low', label: '轻微' }
            ].map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={severityFilter === item.id ? 'primary' : 'ghost'}
                size="sm"
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                  severityFilter === item.id
                    ? 'bg-[#2c2523] text-white'
                    : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                }`}
                onClick={() => setSeverityFilter(item.id as any)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        <ScrollArea className="h-[460px] px-6">
          {loading ? (
            <p className="p-12 text-center text-xs text-[#7d6b59]">加载中...</p>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <CheckCircle2 size={36} className="text-[#2d6a4f]" />
              <h3 className="text-sm font-semibold text-[#2c2523]">暂无匹配的一致性问题</h3>
              <p className="text-xs text-[#7d6b59]">当前筛选条件下未发现叙事矛盾或一致性缺陷。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-1">
              {issues.map((issue) => {
                const chap = chapters.find((c) => c.id === issue.chapterId)
                const evidence = issue.evidences[0]
                return (
                  <Card key={issue.id} className="flex flex-col gap-2.5 p-4 bg-white border-[#e5ddd3]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            issue.severity === 'high'
                              ? 'error'
                              : issue.severity === 'medium'
                              ? 'warning'
                              : 'secondary'
                          }
                        >
                          {consistencySeverityLabel[issue.severity]}
                        </Badge>
                        <Badge variant="outline">
                          {consistencyIssueTypeLabel[issue.issueType]}
                        </Badge>
                        <span className="text-xs font-semibold text-[#2c2523]">
                          {chap ? chap.title : `章节 (v${issue.chapterVersion})`}
                        </span>
                        <Badge variant="secondary">
                          {consistencyStateLabel[issue.state]}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-[#9c8874]">
                        {formatDate(issue.createdAt)}
                      </span>
                    </div>

                    <div className="text-xs leading-relaxed text-[#2c2523]">
                      <p className="m-0">{issue.description}</p>
                    </div>

                    {evidence && (
                      <div className="rounded-lg border border-[#e5ddd3] bg-[#faf8f5] p-2.5 text-xs text-[#7d6b59]">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-[#9c8874] mb-1">
                          <Bookmark size={12} />
                          <span>
                            原文证据 (偏移量: {evidence.startOffset} - {evidence.endOffset})
                          </span>
                        </div>
                        <blockquote className="m-0 italic text-[#54473b] font-serif">
                          "{evidence.excerpt}"
                        </blockquote>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-[#f5efe6] pt-2">
                      {evidence ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-[#2d6a4f]"
                          onClick={() => {
                            onNavigateChapter(
                              issue.chapterId,
                              evidence.startOffset,
                              evidence.endOffset - evidence.startOffset
                            )
                            onClose()
                          }}
                        >
                          <Eye size={13} />
                          定位原文
                        </Button>
                      ) : (
                        <div />
                      )}
                      <div className="flex gap-2">
                        {issue.state === 'open' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-[#2d6a4f]"
                              disabled={isReadOnly}
                              onClick={() => void handleReview(issue, 'acknowledged')}
                            >
                              <Check size={13} />
                              确认已知
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-[#7d6b59]"
                              disabled={isReadOnly}
                              onClick={() => void handleReview(issue, 'dismissed')}
                            >
                              <X size={13} />
                              忽略
                            </Button>
                          </>
                        )}
                        {issue.state === 'acknowledged' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-[#7d6b59]"
                            disabled={isReadOnly}
                            onClick={() => void handleReview(issue, 'dismissed')}
                          >
                            <X size={13} />
                            改为忽略
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>章节正文修改后，相关未处理问题将自动标记为已过时 (stale)</span>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
