import { useState, useEffect, useCallback } from 'react'
import { Search, X, BookOpen, RotateCcw } from 'lucide-react'
import { IndexStatusResult, SearchResultItem, SearchSourceType } from '../../../shared/project'
import { HighlightedText } from '../common/HighlightedText'
import { errorText } from '../../utils/formatters'
import { sourceLabel } from '../../utils/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'

export function SearchDialog({
  sessionId,
  onClose,
  onNavigate
}: {
  sessionId: string
  onClose: () => void
  onNavigate: (chapterId?: string, offset?: number, length?: number) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedSource, setSelectedSource] = useState<'all' | SearchSourceType>('all')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatusResult | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const status = await window.novelAgent.index.getStatus({ sessionId })
      setIndexStatus(status)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const doSearch = useCallback(async (q: string, source: 'all' | SearchSourceType) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError('')
      const filters = source === 'all' ? undefined : { sourceTypes: [source] }
      const res = await window.novelAgent.search.keyword({
        sessionId,
        query: trimmed,
        filters
      })
      setResults(res)
    } catch (err) {
      setError(errorText(err, '搜索失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void doSearch(query, selectedSource)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, selectedSource, doSearch])

  const rebuild = async () => {
    try {
      setRebuilding(true)
      setError('')
      await window.novelAgent.index.rebuild({ sessionId })
      await loadStatus()
      if (query.trim()) {
        void doSearch(query, selectedSource)
      }
    } catch (err) {
      setError(errorText(err, '重建索引失败'))
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col max-h-[85vh] p-5 sm:max-w-4xl" closeLabel="关闭">
        <DialogHeader className="sr-only">
          <DialogTitle>全文搜索</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 pr-8">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-[#dacdbe] bg-white px-3 py-2 text-sm focus-within:border-[#2d6a4f] focus-within:ring-2 focus-within:ring-[#2d6a4f]/20">
            <Search size={18} className="text-[#7d6b59] shrink-0" />
            <Input
              autoFocus
              className="w-full border-none bg-transparent text-sm text-[#2c2523] outline-none shadow-none focus-visible:ring-0"
              placeholder="搜索正文、创作规则、风格样本、知识条目..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="全文搜索输入"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-[#7d6b59] hover:text-[#2c2523]"
                onClick={() => setQuery('')}
                aria-label="清空搜索词"
              >
                <X size={16} />
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 border-b border-[#e5ddd3] pb-2 text-xs">
          {[
            { id: 'all', label: '全部来源' },
            { id: 'chapter_chunk', label: '章节正文' },
            { id: 'creative_rules', label: '创作规则' },
            { id: 'style_sample', label: '风格样本' },
            { id: 'knowledge_entry', label: '知识条目' }
          ].map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={selectedSource === item.id ? 'primary' : 'ghost'}
              size="sm"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedSource === item.id
                  ? 'bg-[#2d6a4f] text-white'
                  : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
              }`}
              onClick={() => setSelectedSource(item.id as any)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {error && <p className="inline-error text-xs text-red-600">{error}</p>}

        <ScrollArea className="h-96 pr-2">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-[#7d6b59]">
              <BookOpen size={32} className="text-[#d6cbbf]" />
              <h3 className="text-sm font-semibold text-[#2c2523]">输入关键词检索作品</h3>
              <p className="text-xs text-[#9c8874]">
                支持 3 字及以上 FTS5 中文全文检索，短词自动使用精确匹配。
              </p>
            </div>
          ) : loading ? (
            <p className="p-12 text-center text-xs text-[#7d6b59]">正在检索中...</p>
          ) : results.length === 0 ? (
            <div className="p-12 text-center text-xs text-[#7d6b59]">
              未找到与 “<strong className="text-[#2c2523]">{query}</strong>” 相关的匹配内容
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              {results.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1.5 rounded-xl border border-[#e5ddd3] bg-white p-3 text-xs transition-colors hover:border-[#2d6a4f] hover:bg-[#faf8f5] cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onNavigate(item.target.chapterId, item.target.offset, query.length)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onNavigate(item.target.chapterId, item.target.offset, query.length)
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {sourceLabel[item.sourceType] || item.sourceType}
                    </Badge>
                    <strong className="text-sm text-[#2c2523] truncate">{item.title}</strong>
                  </div>
                  <div className="text-xs leading-relaxed text-[#54473b] font-serif">
                    <HighlightedText
                      text={item.excerpt}
                      highlightOffsets={item.highlightOffsets}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  indexStatus?.state === 'current' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              全文索引{indexStatus?.state === 'current' ? `已就绪 (v${indexStatus.searchRevision})` : '需重建'}
            </span>
            {indexStatus?.vectorMeta && (
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    indexStatus.vectorMeta.state === 'ready'
                      ? 'bg-emerald-500'
                      : indexStatus.vectorMeta.state === 'building'
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                  }`}
                />
                向量:{' '}
                {indexStatus.vectorMeta.state === 'ready'
                  ? `就绪 (${indexStatus.vectorMeta.totalCount} 单元)`
                  : indexStatus.vectorMeta.state === 'building'
                  ? `构建中 (${indexStatus.vectorMeta.processedCount}/${indexStatus.vectorMeta.totalCount})`
                  : '未就绪'}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => void rebuild()}
              disabled={rebuilding}
              title="重新为全书正文与知识构建 FTS5 索引"
            >
              <RotateCcw size={12} className={rebuilding ? 'animate-spin' : ''} />
              {rebuilding ? '重建中...' : '重建索引'}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {query.trim() && !loading && <span>找到 {results.length} 条匹配结果</span>}
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
