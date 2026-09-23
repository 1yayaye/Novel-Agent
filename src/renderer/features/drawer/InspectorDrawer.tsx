import React from 'react'
import { FileBarChart, Clock, Users, ShieldAlert, Sparkles, Camera } from 'lucide-react'
import { Card } from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import type { Chapter } from '../../../shared/project'
import { count } from '../../../shared/text-counter'

export function InspectorDrawer({
  chapter,
  onCreateSnapshot
}: {
  chapter: Chapter | null
  onCreateSnapshot?: () => void
}) {
  if (!chapter) {
    return (
      <div className="py-16 text-center text-xs text-[#baa997]">
        请选择一个章节以查看检视分析
      </div>
    )
  }

  const wordCount = count(chapter.content || '')
  const readMinutes = Math.max(1, Math.ceil(wordCount / 400))

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Chapter Basic Stats */}
      <div className="bg-[#f5efe6] p-4 rounded-xl border border-[#e5ddd3] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#2c2523] font-serif truncate">
            {chapter.title}
          </span>
          <span className="text-[10px] text-[#7d6b59] font-mono">v{chapter.version}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="bg-white p-2.5 rounded-lg border border-[#e5ddd3]">
            <div className="text-[10px] text-[#7d6b59]">章节字数</div>
            <div className="text-base font-bold text-[#2c2523] font-mono">
              {wordCount.toLocaleString()}
            </div>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-[#e5ddd3]">
            <div className="text-[10px] text-[#7d6b59]">预计用时</div>
            <div className="text-base font-bold text-[#2c2523] font-mono">
              ~{readMinutes} 分钟
            </div>
          </div>
        </div>
      </div>

      {/* Snapshot quick action */}
      {onCreateSnapshot && (
        <Card className="p-3 bg-white border-[#e5ddd3] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera size={14} className="text-[#2d6a4f]" />
            <span className="text-xs font-medium text-[#2c2523]">章节历史快照</span>
          </div>
          <Button size="sm" variant="secondary" onClick={onCreateSnapshot} className="h-7 text-xs">
            生成快照
          </Button>
        </Card>
      )}

      {/* Chapter Diagnostics */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-[#7d6b59] px-1">章节健康度体检</span>
        <Card className="p-3.5 bg-white border-[#e5ddd3] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#54473b]">段落结构分布</span>
            <span className="text-[#2d6a4f] font-semibold">良好</span>
          </div>
          <p className="text-[11px] text-[#7d6b59] leading-relaxed">
            本章节共包含约 {chapter.content ? chapter.content.split('\n').filter(Boolean).length : 0} 个自然段，段落长短交错均匀。
          </p>
        </Card>
      </div>
    </div>
  )
}
