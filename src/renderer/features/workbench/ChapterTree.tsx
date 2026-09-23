import React, { useState } from 'react'
import { Plus, Search, MoreVertical, Trash2, Edit3, ArrowUp, ArrowDown, FileText } from 'lucide-react'
import type { ChapterHeader } from '../../../shared/project'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@appica/ui-react/dropdown-menu'

export interface ChapterTreeProps {
  chapters: ChapterHeader[]
  selectedChapterId: string | null
  onSelectChapter: (id: string) => void
  onCreateChapter: () => void
  onRenameChapter: (id: string, currentTitle: string) => void
  onDeleteChapter: (id: string) => void
  onMoveChapter?: (id: string, direction: -1 | 1) => void
}

export function ChapterTree({
  chapters,
  selectedChapterId,
  onSelectChapter,
  onCreateChapter,
  onRenameChapter,
  onDeleteChapter,
  onMoveChapter
}: ChapterTreeProps) {
  const [filterQuery, setFilterQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const filteredChapters = chapters.filter((c) =>
    c.title.toLowerCase().includes(filterQuery.toLowerCase())
  )

  const totalWords = chapters.reduce((acc, c) => acc + (c.characterCount || 0), 0)

  return (
    <div data-tour="chapter-panel" className="flex flex-col h-full bg-[#faf8f5] border-r border-[#e5ddd3] w-64 select-none shrink-0">
      {/* Header with Title and Add Button */}
      <div className="p-3 border-b border-[#e5ddd3] flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-[#2c2523] font-serif">章节目录</h2>
          <div className="text-[11px] text-[#7d6b59]">
            {chapters.length} 章 · {totalWords.toLocaleString()} 字
          </div>
        </div>
        <Button
          size="sm"
          onClick={onCreateChapter}
          className="h-7 px-2.5 gap-1 text-xs"
          title="新建下一章节"
        >
          <Plus size={13} />
          <span>新建</span>
        </Button>
      </div>

      {/* Quick Search */}
      <div className="p-2 border-b border-[#e5ddd3]/60">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-2.5 text-[#baa997] z-10 pointer-events-none" />
          <Input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="搜索章节..."
            className="w-full pl-7 pr-2.5 py-1 text-xs bg-[#efe6da]/60 hover:bg-[#efe6da] focus:bg-white border border-[#dacdbe] rounded-lg text-[#2c2523] placeholder:text-[#baa997] focus:outline-none focus:ring-1 focus:ring-[#2d6a4f]/40 transition-colors"
          />
        </div>
      </div>

      {/* Chapter List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filteredChapters.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#baa997]">
            {filterQuery ? '未找到匹配章节' : '暂无章节'}
          </div>
        ) : (
          filteredChapters.map((chapter, index) => {
            const isSelected = chapter.id === selectedChapterId
            const chapterNum = getChapterNumber(chapters, index)
            const numLabel = chapterNum !== undefined ? `第 ${chapterNum} 章` : '正文'

            return (
              <div
                key={chapter.id}
                onClick={() => onSelectChapter(chapter.id)}
                className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-[#efe6da] text-[#2c2523] font-medium shadow-xs'
                    : 'text-[#54473b] hover:bg-[#efe6da]/50 hover:text-[#2c2523]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`text-[10px] w-5 text-center font-mono shrink-0 ${isSelected ? 'text-[#2d6a4f] font-bold' : 'text-[#baa997]'}`}>
                    {chapterNum !== undefined ? chapterNum : '•'}
                  </span>
                  <div className="truncate flex-1">
                    {editingId === chapter.id ? (
                      <Input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const trimmed = editingTitle.trim()
                            if (trimmed && trimmed !== chapter.title) {
                              onRenameChapter(chapter.id, trimmed)
                            }
                            setEditingId(null)
                          } else if (e.key === 'Escape') {
                            setEditingId(null)
                          }
                        }}
                        onBlur={() => {
                          const trimmed = editingTitle.trim()
                          if (trimmed && trimmed !== chapter.title) {
                            onRenameChapter(chapter.id, trimmed)
                          }
                          setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-1.5 py-0.5 text-xs bg-white border border-[#2d6a4f] rounded text-[#2c2523] focus:outline-none"
                      />
                    ) : (
                      <span className="truncate">{chapter.title || numLabel}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-[#baa997] font-mono group-hover:hidden">
                    {chapter.characterCount ? `${chapter.characterCount}` : '0'}
                  </span>

                  {/* Context menu for chapter */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded-md text-[#7d6b59] hover:bg-[#dacdbe]/60 hidden group-hover:flex transition-colors h-6 w-6"
                        >
                          <MoreVertical size={13} />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingId(chapter.id)
                          setEditingTitle(chapter.title || '')
                        }}
                      >
                        <Edit3 size={13} className="mr-2" />
                        <span>重命名</span>
                      </DropdownMenuItem>
                      {onMoveChapter && (
                        <>
                          <DropdownMenuItem
                            disabled={index === 0}
                            onClick={() => onMoveChapter(chapter.id, -1)}
                          >
                            <ArrowUp size={13} className="mr-2" />
                            <span>上移章节</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === chapters.length - 1}
                            onClick={() => onMoveChapter(chapter.id, 1)}
                          >
                            <ArrowDown size={13} className="mr-2" />
                            <span>下移章节</span>
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDeleteChapter(chapter.id)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 size={13} className="mr-2" />
                        <span>删除章节</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
