import React, { useState, useEffect } from 'react'
import {
  AlignLeft,
  BookOpen,
  Check,
  Edit2,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  Type
} from 'lucide-react'
import type { Chapter } from '../../../shared/project'
import type { EditorPreferences } from '../../types/editor'

export interface EditorHeaderProps {
  chapter: Chapter | null
  preferences: EditorPreferences
  isZenMode: boolean
  onToggleZenMode: () => void
  onUpdateTitle: (title: string) => void
  onFormatDocument?: () => void
  onOpenFind?: () => void
  onPreferencesChange?: (prefs: Partial<EditorPreferences>) => void
}

export function EditorHeader({
  chapter,
  preferences,
  isZenMode,
  onToggleZenMode,
  onUpdateTitle,
  onFormatDocument,
  onOpenFind,
  onPreferencesChange
}: EditorHeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(chapter?.title || '')

  useEffect(() => {
    setTitleValue(chapter?.title || '')
  }, [chapter?.title])

  const handleTitleSubmit = () => {
    setIsEditingTitle(false)
    if (titleValue.trim() && titleValue.trim() !== chapter?.title) {
      onUpdateTitle(titleValue.trim())
    }
  }

  return (
    <div className="flex items-center justify-between px-8 py-3 border-b border-[#e5ddd3]/70 bg-[#faf8f5]/80 backdrop-blur-xs select-none">
      {/* Chapter Title */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isEditingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit()
              if (e.key === 'Escape') {
                setTitleValue(chapter?.title || '')
                setIsEditingTitle(false)
              }
            }}
            className="text-base font-bold font-serif text-[#2c2523] bg-white border border-[#2d6a4f] rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20 w-80"
          />
        ) : (
          <div
            onClick={() => setIsEditingTitle(true)}
            className="group flex items-center gap-2 cursor-pointer py-1 px-2 -ml-2 rounded-lg hover:bg-[#efe6da]/60 transition-colors"
            title="点击修改章节标题"
          >
            <h1 className="text-base font-bold font-serif text-[#2c2523] truncate">
              {chapter?.title || '未选择章节'}
            </h1>
            <Edit2
              size={13}
              className="text-[#baa997] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        )}
      </div>

      {/* Editor Controls / Formatting Bar */}
      <div className="flex items-center gap-1.5 shrink-0 text-[#7d6b59]">
        {/* Font Family switch */}
        <button
          type="button"
          onClick={() =>
            onPreferencesChange?.({
              fontFamily: preferences.fontFamily === 'serif' ? 'sans' : 'serif'
            })
          }
          className="px-2.5 py-1 text-xs rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors flex items-center gap-1"
          title={`切换字体 (当前: ${preferences.fontFamily === 'serif' ? '出版宋体' : '黑体'})`}
        >
          <Type size={13} />
          <span className="font-serif text-[11px]">{preferences.fontFamily === 'serif' ? '宋体' : '黑体'}</span>
        </button>

        {/* 2em Paragraph Indentation toggle */}
        <button
          type="button"
          onClick={() =>
            onPreferencesChange?.({
              indentParagraphs: !preferences.indentParagraphs
            })
          }
          className={`px-2.5 py-1 text-xs rounded-lg transition-colors flex items-center gap-1 ${
            preferences.indentParagraphs
              ? 'bg-[#efe6da] text-[#2d6a4f] font-medium'
              : 'hover:bg-[#efe6da] hover:text-[#2c2523]'
          }`}
          title={preferences.indentParagraphs ? '段首两格缩进已开启' : '段首两格缩进已关闭'}
        >
          <AlignLeft size={13} />
          <span className="text-[11px]">首行缩进</span>
        </button>

        {/* Format document */}
        {onFormatDocument && (
          <button
            type="button"
            onClick={onFormatDocument}
            className="px-2.5 py-1 text-xs rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors flex items-center gap-1"
            title="一键正文智能排版 (两格缩进与清理冗余空行)"
          >
            <Sparkles size={13} className="text-[#b45309]" />
            <span className="text-[11px]">一键排版</span>
          </button>
        )}

        {/* Find & Replace */}
        {onOpenFind && (
          <button
            type="button"
            onClick={onOpenFind}
            className="p-1.5 rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors"
            title="查找与替换 (Ctrl+F)"
          >
            <Search size={14} />
          </button>
        )}

        <div className="h-4 w-px bg-[#e5ddd3] mx-1" />

        {/* Zen Mode Button */}
        <button
          type="button"
          onClick={onToggleZenMode}
          className={`p-1.5 rounded-lg transition-colors ${
            isZenMode
              ? 'bg-[#2d6a4f] text-white'
              : 'hover:bg-[#efe6da] hover:text-[#2c2523]'
          }`}
          title={isZenMode ? '退出沉浸全屏模式 (Esc)' : '进入沉浸全屏模式'}
        >
          {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  )
}
