import React from 'react'
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
    <div className="empty-chapter-container flex-1 h-full flex items-center justify-center p-8 select-none" role="region" aria-label="空章节引导">
      <div className="empty-chapter-card max-w-md w-full bg-white border border-[#e5ddd3] rounded-2xl p-8 text-center shadow-sm space-y-4">
        <div className="empty-chapter-icon-wrapper w-16 h-16 rounded-full bg-[#efe6da] text-[#2d6a4f] flex items-center justify-center mx-auto shadow-inner">
          <BookOpen size={36} strokeWidth={1.5} className="empty-chapter-icon" />
        </div>
        <h2 className="empty-chapter-title text-xl font-bold font-serif text-[#2c2523]">{title}</h2>
        <p className="empty-chapter-desc text-xs text-[#7d6b59] leading-relaxed">{description}</p>
        <div className="empty-chapter-actions pt-2 flex justify-center">
          {isReadOnly ? (
            <div className="empty-readonly-badge inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">
              <Lock size={14} />
              <span>当前作品为只读模式</span>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button create-first-chapter-btn inline-flex items-center gap-2 px-4 py-2 bg-[#2d6a4f] text-white rounded-xl text-sm font-medium hover:bg-[#24583e] active:scale-98 transition-all shadow-sm"
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
