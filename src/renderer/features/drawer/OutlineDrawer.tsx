import React, { useEffect, useState } from 'react'
import { Compass, BookOpen, ChevronRight, FileText, Sparkles } from 'lucide-react'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { useProjectStore } from '../../stores/useProjectStore'

export function OutlineDrawer({
  onSelectChapter
}: {
  onSelectChapter?: (id: string) => void
}) {
  const { project, chapters, selectedChapterId } = useProjectStore()
  const [synopsis, setSynopsis] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!project) return
    let active = true
    setIsLoading(true)
    window.novelAgent.synopsis
      .get({ sessionId: project.sessionId })
      .then((res: any) => {
        if (active && res) {
          setSynopsis(res.synopsis || '')
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [project])

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Novel Synopsis Card */}
      <div className="bg-[#f5efe6] p-4 rounded-xl border border-[#e5ddd3] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#2c2523] flex items-center gap-1.5">
            <Compass size={15} className="text-[#2d6a4f]" />
            <span>全书核心梗概</span>
          </span>
          <span className="text-[11px] text-[#7d6b59]">{project?.metadata.title}</span>
        </div>
        <p className="text-xs text-[#54473b] leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
          {synopsis || '尚未生成全书大纲梗概。可通过主菜单的“大纲与故事脉络”一键提炼。'}
        </p>
      </div>

      {/* Chapter Outlines Tree */}
      <div className="space-y-2 flex-1 overflow-y-auto pr-1">
        <div className="text-xs font-semibold text-[#7d6b59] px-1">
          章节脉络列表 ({chapters.length})
        </div>

        {chapters.map((chapter, index) => {
          const isSelected = chapter.id === selectedChapterId
          return (
            <Card
              key={chapter.id}
              onClick={() => onSelectChapter?.(chapter.id)}
              className={`p-3 cursor-pointer transition-all border-[#e5ddd3] hover:border-[#dacdbe] ${
                isSelected ? 'bg-[#efe6da] border-[#2d6a4f]' : 'bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[11px] font-mono text-[#877d74] w-5 text-center">
                    {index + 1}
                  </span>
                  <span className="text-xs font-medium text-[#2c2523] truncate">
                    {chapter.title || `第 ${index + 1} 章`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[#877d74]">
                  <span className="text-[10px] font-mono">
                    {chapter.characterCount ? `${chapter.characterCount}字` : ''}
                  </span>
                  <ChevronRight size={13} />
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
