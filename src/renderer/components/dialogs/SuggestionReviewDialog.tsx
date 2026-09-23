import { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import { AiFactSuggestion, KnowledgeKind, SuggestionState } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { knowledgeKindLabel, suggestionStateLabel } from '../../utils/constants'
import { AcceptancePreviewDialog } from './AcceptancePreviewDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'

export function SuggestionReviewDialog({
  sessionId,
  isReadOnly,
  onClose
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
}) {
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
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-4xl" closeLabel="关闭">
          <DialogHeader>
            <DialogTitle>AI 事实建议审阅</DialogTitle>
            <DialogDescription>
              审阅模型提炼的人物、设定与时间线事实，带章节证据追溯与可编辑采纳。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 border-b border-[#e5ddd3] pb-3 text-xs">
            <div className="flex gap-1.5">
              {(['pending', 'conflict', 'accepted', 'ignored'] as SuggestionState[]).map((state) => (
                <Button
                  key={state}
                  type="button"
                  variant={stateFilter === state ? 'primary' : 'ghost'}
                  size="sm"
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    stateFilter === state
                      ? 'bg-[#2d6a4f] text-white'
                      : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                  }`}
                  onClick={() => setStateFilter(state)}
                >
                  {state === 'pending'
                    ? '待审阅'
                    : state === 'conflict'
                    ? '存在冲突'
                    : state === 'accepted'
                    ? '已采纳'
                    : '已忽略'}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(['all', 'character', 'world', 'timeline', 'foreshadow'] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant={kindFilter === kind ? 'primary' : 'ghost'}
                  size="sm"
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    kindFilter === kind
                      ? 'bg-[#2c2523] text-white'
                      : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                  }`}
                  onClick={() => setKindFilter(kind)}
                >
                  {kind === 'all'
                    ? '全部类型'
                    : knowledgeKindLabel[kind as KnowledgeKind] || kind}
                </Button>
              ))}
            </div>
          </div>

          {error && <p className="inline-error text-xs text-red-600">{error}</p>}

          <ScrollArea className="h-96 pr-2">
            {loading ? (
              <p className="p-8 text-center text-xs text-[#7d6b59]">加载建议列表中...</p>
            ) : suggestions.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#7d6b59]">暂无符合条件的建议记录</p>
            ) : (
              <div className="flex flex-col gap-3 p-1">
                {suggestions.map((s) => (
                  <Card key={s.id} className="flex flex-col gap-2 p-4 bg-white border-[#e5ddd3]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {knowledgeKindLabel[s.knowledgeKind]}
                        </Badge>
                        <strong className="text-sm text-[#2c2523]">{s.normalizedSubject}</strong>
                        <span className="text-xs text-[#7d6b59]">{s.predicate}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.confidence !== null && s.confidence !== undefined && (
                          <span className="text-[11px] text-[#7d6b59]">
                            置信度 {Math.round(s.confidence * 100)}%
                          </span>
                        )}
                        <Badge
                          variant={
                            s.state === 'conflict'
                              ? 'error'
                              : s.state === 'accepted'
                              ? 'success'
                              : 'outline'
                          }
                        >
                          {suggestionStateLabel[s.state] || s.state}
                        </Badge>
                      </div>
                    </div>

                    <div className="text-xs leading-relaxed text-[#2c2523]">{s.displayText}</div>

                    {s.evidences && s.evidences.length > 0 && (
                      <div className="rounded-lg border border-[#e5ddd3] bg-[#faf8f5] p-2.5 text-[11px] text-[#7d6b59]">
                        <div className="mb-1 font-mono text-[10px] text-[#9c8874]">
                          来源证据：{s.evidences[0].chapterTitle || `章节`} (v{s.evidences[0].chapterVersion}) · 字符范围 [{s.evidences[0].startOffset} - {s.evidences[0].endOffset}]
                        </div>
                        <div className="italic text-[#54473b]">“{s.evidences[0].excerpt}”</div>
                      </div>
                    )}

                    {!isReadOnly && (s.state === 'pending' || s.state === 'conflict') && (
                      <div className="flex justify-end gap-2 border-t border-[#f5efe6] pt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleReview(s, 'ignored')}
                        >
                          忽略
                        </Button>
                        {s.state !== 'conflict' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => void handleReview(s, 'conflict')}
                          >
                            标记冲突
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => setAcceptingSuggestion(s)}
                        >
                          <Check size={14} />
                          采纳建议
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-xs text-[#7d6b59]">
            <span>共 {suggestions.length} 条建议记录</span>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  )
}
