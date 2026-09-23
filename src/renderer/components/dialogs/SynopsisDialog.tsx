import { useState, useEffect, useCallback } from 'react'
import { Compass, Sparkles } from 'lucide-react'
import { BookSynopsis, ChapterHeader, ChapterSummary } from '../../../shared/project'
import { errorText, formatDate } from '../../utils/formatters'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'

export function SynopsisDialog({
  sessionId,
  chapters: _chapters,
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent closeLabel="关闭" className="sm:max-w-4xl flex flex-col max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle>全书故事梗概与章节摘要</DialogTitle>
              <DialogDescription>
                基于各章节摘要自动滚动的全书宏观故事脉络与细分梗概
              </DialogDescription>
            </div>
            <Button
              size="sm"
              disabled={isReadOnly}
              onClick={() => {
                if (summaries.length === 0 && onLaunchAnalysis) {
                  onLaunchAnalysis('knowledge')
                } else {
                  onLaunchNew()
                }
              }}
              title={
                summaries.length === 0
                  ? '尚未生成章节摘要，将先启动全书章节分析'
                  : '基于最新章节摘要重新生成全书宏观故事脉络'
              }
            >
              <Sparkles size={14} />
              {summaries.length === 0 ? '一键提取剧情并生成大纲' : '重新生成故事脉络'}
            </Button>
          </div>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600">{error}</p>}

        <ScrollArea className="h-[480px] pr-2">
          <div className="flex flex-col gap-4 p-1">
            <Card className="flex flex-col gap-3 p-4 bg-white border-[#e5ddd3]">
              <div className="flex items-center justify-between border-b border-[#f5efe6] pb-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#2c2523]">
                  <Compass size={18} className="text-[#2d6a4f]" />
                  <span>全书宏观故事脉络</span>
                </div>
                {synopsis && (
                  <div className="flex items-center gap-2">
                    <Badge variant={synopsis.state === 'current' ? 'primary' : 'secondary'}>
                      {synopsis.state === 'current' ? '最新有效' : '已过时 (有章节变动)'}
                    </Badge>
                    <span className="text-[11px] text-[#7d6b59]">
                      {formatDate(synopsis.createdAt)}
                    </span>
                  </div>
                )}
              </div>

              {loading ? (
                <p className="p-4 text-center text-xs text-[#7d6b59]">加载中...</p>
              ) : !synopsis ? (
                <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
                  <p className="max-w-md text-xs text-[#7d6b59]">
                    {summaries.length === 0
                      ? '暂无全书宏观脉络。需先提取章节剧情与摘要，AI 将自动串联生成全书故事走向。'
                      : '已提取章节摘要，可点击右上角「重新生成故事脉络」自动提炼全书大纲。'}
                  </p>
                  {summaries.length === 0 && (
                    <Button
                      size="sm"
                      disabled={isReadOnly}
                      onClick={() => {
                        if (onLaunchAnalysis) onLaunchAnalysis('knowledge')
                        else onLaunchNew()
                      }}
                    >
                      <Sparkles size={13} />
                      立即开始全书章节剧情分析
                    </Button>
                  )}
                </div>
              ) : (
                <div className="font-serif text-sm leading-relaxed text-[#2c2523] whitespace-pre-wrap">
                  {synopsis.summary}
                </div>
              )}
            </Card>

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-[#7d6b59]">
                各章节摘要明细 ({summaries.length})
              </h3>
              {summaries.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#dacdbe] p-8 text-center">
                  <p className="text-xs text-[#7d6b59]">
                    暂无章节摘要，请先通过剧情分析提取各章事实与摘要
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isReadOnly}
                    onClick={() => {
                      if (onLaunchAnalysis) onLaunchAnalysis('knowledge')
                      else onLaunchNew()
                    }}
                  >
                    <Sparkles size={13} />
                    启动章节剧情与知识分析
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {summaries.map((sum) => (
                    <Card key={sum.id} className="flex flex-col gap-2 p-3 bg-white border-[#e5ddd3]">
                      <div className="flex items-center justify-between">
                        <strong className="text-xs text-[#2c2523] truncate">
                          {sum.chapterTitle ?? '章节'}
                        </strong>
                        <Badge variant={sum.state === 'current' ? 'primary' : 'secondary'}>
                          {sum.state === 'current' ? `v${sum.chapterVersion}` : '已过时'}
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-[#54473b] line-clamp-3">
                        {sum.summary}
                      </p>
                      <span className="text-[10px] text-[#9c8874]">
                        {formatDate(sum.createdAt)}
                      </span>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>章节正文修改后，对应章节摘要及全书大纲将自动标记为过时状态</span>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
