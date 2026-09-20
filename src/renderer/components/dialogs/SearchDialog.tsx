import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Search, X, BookOpen, RotateCcw } from 'lucide-react'
import { IndexStatusResult, SearchResultItem, SearchSourceType } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { HighlightedText } from '../common/HighlightedText'
import { errorText } from '../../utils/formatters'
import { sourceLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function SearchDialog({
  sessionId,
  onClose,
  onNavigate
}: {
  sessionId: string
  onClose: () => void
  onNavigate: (chapterId?: string, offset?: number, length?: number) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
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
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="search-dialog" role="dialog" aria-modal="true" aria-label="全文搜索" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="search-header">
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" />
            <input
              autoFocus
              className="search-main-input"
              placeholder="搜索正文、创作规则、风格样本、知识条目..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="全文搜索输入"
            />
            {query && (
              <button className="icon-button" onClick={() => setQuery('')} aria-label="清空搜索词">
                <X size={16} />
              </button>
            )}
          </div>
          <IconButton label="关闭搜索" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="search-filter-bar">
          <div className="source-filter-chips">
            <button
              type="button"
              className={`filter-chip ${selectedSource === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedSource('all')}
            >
              全部来源
            </button>
            <button
              type="button"
              className={`filter-chip ${selectedSource === 'chapter_chunk' ? 'active' : ''}`}
              onClick={() => setSelectedSource('chapter_chunk')}
            >
              章节正文
            </button>
            <button
              type="button"
              className={`filter-chip ${selectedSource === 'creative_rules' ? 'active' : ''}`}
              onClick={() => setSelectedSource('creative_rules')}
            >
              创作规则
            </button>
            <button
              type="button"
              className={`filter-chip ${selectedSource === 'style_sample' ? 'active' : ''}`}
              onClick={() => setSelectedSource('style_sample')}
            >
              风格样本
            </button>
            <button
              type="button"
              className={`filter-chip ${selectedSource === 'knowledge_entry' ? 'active' : ''}`}
              onClick={() => setSelectedSource('knowledge_entry')}
            >
              知识条目
            </button>
          </div>
        </div>

        {error && <p className="inline-error dialog-error">{error}</p>}

        <div className="search-results-body">
          {!query.trim() ? (
            <div className="search-placeholder">
              <BookOpen size={32} className="placeholder-icon" />
              <h3>输入关键词检索作品</h3>
              <p>支持 3 字及以上 FTS5 中文全文检索，短词自动使用精确匹配。</p>
            </div>
          ) : loading ? (
            <p className="empty-hint">正在检索中...</p>
          ) : results.length === 0 ? (
            <div className="search-empty">
              <p>未找到与 “<strong>{query}</strong>” 相关的匹配内容</p>
            </div>
          ) : (
            <div className="search-results-list">
              {results.map((item) => (
                <div
                  key={item.id}
                  className="search-result-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(item.target.chapterId, item.target.offset, query.length)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(item.target.chapterId, item.target.offset, query.length) }}
                >
                  <div className="search-result-meta">
                    <span className={`source-tag ${item.sourceType}`}>{sourceLabel[item.sourceType] || item.sourceType}</span>
                    <strong className="search-result-title">{item.title}</strong>
                  </div>
                  <div className="search-result-excerpt">
                    <HighlightedText text={item.excerpt} highlightOffsets={item.highlightOffsets} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="search-footer">
          <div className="index-health">
            {indexStatus?.state === 'current' ? (
              <span className="health-tag ok"><span className="health-dot" />全文索引已就绪 (v{indexStatus.searchRevision})</span>
            ) : (
              <span className="health-tag rebuild"><span className="health-dot warning" />全文索引需重建</span>
            )}
            {indexStatus?.vectorMeta && (
              <span className={`health-tag ${indexStatus.vectorMeta.state === 'ready' ? 'ok' : indexStatus.vectorMeta.state === 'building' ? 'rebuild' : 'danger'}`}>
                <span className={`health-dot ${indexStatus.vectorMeta.state === 'ready' ? '' : 'warning'}`} />
                向量: {indexStatus.vectorMeta.state === 'ready' ? `就绪 (${indexStatus.vectorMeta.totalCount} 单元)` : indexStatus.vectorMeta.state === 'building' ? `构建中 (${indexStatus.vectorMeta.processedCount}/${indexStatus.vectorMeta.totalCount})` : indexStatus.vectorMeta.state === 'failed' ? '失败' : '未就绪'}
              </span>
            )}
            <button
              type="button"
              className="text-button rebuild-btn"
              onClick={() => void rebuild()}
              disabled={rebuilding}
              title="重新为全书正文与知识构建 FTS5 索引"
            >
              <RotateCcw size={13} className={rebuilding ? 'spin' : ''} />
              {rebuilding ? '重建中...' : '重建索引'}
            </button>
          </div>
          <div className="search-footer-info">
            {query.trim() && !loading && <span>找到 {results.length} 条匹配结果</span>}
            <button type="button" className="text-button" onClick={onClose}>关闭</button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
