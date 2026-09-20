import { BookOpen, Plus, Lock } from 'lucide-react'

export interface EmptyChapterStateProps {
  onCreateChapter?: () => void
  isReadOnly?: boolean
  title?: string
  description?: string
}

export function EmptyChapterState({
  onCreateChapter,
  isReadOnly = false,
  title = '纸白墨润，静待下笔',
  description = '当前作品暂无章节。千里之行始于足下，创建第一章开启您的鸿篇巨制。'
}: EmptyChapterStateProps) {
  return (
    <div className="empty-chapter-container" role="region" aria-label="空章节引导">
      <div className="empty-chapter-card">
        <div className="empty-chapter-icon-wrapper">
          <BookOpen size={40} strokeWidth={1.5} className="empty-chapter-icon" />
        </div>
        <h2 className="empty-chapter-title">{title}</h2>
        <p className="empty-chapter-desc">{description}</p>
        <div className="empty-chapter-actions">
          {isReadOnly ? (
            <div className="empty-readonly-badge">
              <Lock size={14} />
              <span>当前作品为只读模式</span>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button create-first-chapter-btn"
              onClick={onCreateChapter}
            >
              <Plus size={16} />
              <span>新建第一章</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
