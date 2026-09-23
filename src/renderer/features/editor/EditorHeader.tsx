import React, { useState, useEffect, useRef } from 'react'
import {
  AlignLeft,
  BookOpen,
  Check,
  Edit2,
  Maximize2,
  Minimize2,
  Moon,
  Search,
  Sparkles,
  Sun,
  Type
} from 'lucide-react'
import type { Chapter } from '../../../shared/project'
import type { EditorPreferences, WritingTheme } from '../../types/editor'
import { WindowControls } from '../../components/common/WindowControls'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'

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
  const [displayTitle, setDisplayTitle] = useState(chapter?.title || '未选择章节')
  const [titleAnimation, setTitleAnimation] = useState('')
  const displayTitleRef = useRef(displayTitle)
  const previousChapterTitleRef = useRef(chapter?.title || '')
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const currentChapterTitle = chapter?.title || ''
    const nextTitle = currentChapterTitle || '未选择章节'
    const previousChapterTitle = previousChapterTitleRef.current
    previousChapterTitleRef.current = currentChapterTitle
    setTitleValue(currentChapterTitle)
    if (titleTimerRef.current !== null) {
      clearTimeout(titleTimerRef.current)
      titleTimerRef.current = null
    }
    if (titleFrameRef.current !== null) {
      cancelAnimationFrame(titleFrameRef.current)
      titleFrameRef.current = null
    }
    if (displayTitleRef.current === nextTitle) {
      setTitleAnimation('')
      return
    }

    if (!previousChapterTitle || !currentChapterTitle) {
      displayTitleRef.current = nextTitle
      setDisplayTitle(nextTitle)
      setTitleAnimation('')
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayTitleRef.current = nextTitle
      setDisplayTitle(nextTitle)
      setTitleAnimation('')
      return
    }

    setTitleAnimation('is-exit')
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null
      displayTitleRef.current = nextTitle
      setDisplayTitle(nextTitle)
      setTitleAnimation('is-enter-start')
      titleFrameRef.current = requestAnimationFrame(() => {
        titleFrameRef.current = null
        setTitleAnimation('')
      })
    }, 150)
  }, [chapter?.title])

  useEffect(() => () => {
    if (titleTimerRef.current !== null) clearTimeout(titleTimerRef.current)
    if (titleFrameRef.current !== null) cancelAnimationFrame(titleFrameRef.current)
  }, [])

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
          <Input
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
            <h1 className={`text-base font-bold font-serif text-[#2c2523] truncate text-states-swap ${titleAnimation}`}>
              {displayTitle}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onPreferencesChange?.({
              fontFamily: preferences.fontFamily === 'serif' ? 'sans' : 'serif'
            })
          }
          className="px-2.5 py-1 text-xs rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors flex items-center gap-1 h-auto"
          title={`切换字体 (当前: ${preferences.fontFamily === 'serif' ? '出版宋体' : '黑体'})`}
        >
          <Type size={13} />
          <span className="font-serif text-[11px]">{preferences.fontFamily === 'serif' ? '宋体' : '黑体'}</span>
        </Button>

        {/* 2em Paragraph Indentation toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onPreferencesChange?.({
              indentParagraphs: !preferences.indentParagraphs
            })
          }
          className={`px-2.5 py-1 text-xs rounded-lg transition-colors flex items-center gap-1 h-auto ${
            preferences.indentParagraphs
              ? 'bg-[#efe6da] text-[#2d6a4f] font-medium'
              : 'hover:bg-[#efe6da] hover:text-[#2c2523]'
          }`}
          title={preferences.indentParagraphs ? '段首两格缩进已开启' : '段首两格缩进已关闭'}
        >
          <AlignLeft size={13} />
          <span className="text-[11px]">首行缩进</span>
        </Button>

        {/* Format document */}
        {onFormatDocument && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFormatDocument}
            className="px-2.5 py-1 text-xs rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors flex items-center gap-1 h-auto"
            title="一键正文智能排版 (两格缩进与清理冗余空行)"
          >
            <Sparkles size={13} className="text-[#b45309]" />
            <span className="text-[11px]">一键排版</span>
          </Button>
        )}

        {/* Find & Replace */}
        {onOpenFind && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenFind}
            className="p-1.5 rounded-lg hover:bg-[#efe6da] hover:text-[#2c2523] transition-colors"
            title="查找与替换 (Ctrl+F)"
            aria-label="查找与替换"
          >
            <Search size={14} />
          </Button>
        )}

        {/* Theme toggle chips */}
        <div className="flex items-center gap-0.5 bg-[#efe6da]/60 p-0.5 rounded-lg border border-[#dacdbe]/60">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPreferencesChange?.({ theme: 'light' })}
            className={`p-1 rounded-md transition-colors ${
              preferences.theme === 'light' ? 'bg-white text-[#2c2523] shadow-xs' : 'text-[#7d6b59] hover:text-[#2c2523]'
            }`}
            title="明亮模式 (Light)"
            aria-label="明亮模式"
          >
            <Sun size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPreferencesChange?.({ theme: 'sepia' })}
            className={`p-1 rounded-md transition-colors ${
              preferences.theme === 'sepia' ? 'bg-[#f4ecd8] text-[#433422] shadow-xs' : 'text-[#7d6b59] hover:text-[#2c2523]'
            }`}
            title="羊皮纸护眼模式 (Sepia)"
            aria-label="羊皮纸模式"
          >
            <BookOpen size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPreferencesChange?.({ theme: 'dark' })}
            className={`p-1 rounded-md transition-colors ${
              preferences.theme === 'dark' ? 'bg-[#26262d] text-[#f3f4f6] shadow-xs' : 'text-[#7d6b59] hover:text-[#2c2523]'
            }`}
            title="深夜暗黑模式 (Dark)"
            aria-label="暗黑模式"
          >
            <Moon size={12} />
          </Button>
        </div>

        <div className="h-4 w-px bg-[#e5ddd3] mx-1" />

        {/* Zen Mode Button */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleZenMode}
          className={`p-1.5 rounded-lg transition-colors ${
            isZenMode
              ? 'bg-[#2d6a4f] text-white'
              : 'hover:bg-[#efe6da] hover:text-[#2c2523]'
          }`}
          title={isZenMode ? '退出沉浸全屏模式 (Esc)' : '进入沉浸全屏模式'}
          aria-label={isZenMode ? '退出全屏' : '全屏模式'}
        >
          {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>

        {isZenMode && (
          <div className="zen-window-controls ml-2" data-testid="zen-window-controls">
            <WindowControls />
          </div>
        )}
      </div>
    </div>
  )
}
