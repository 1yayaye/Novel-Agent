import React, { useState } from 'react'
import { Flame, Sparkles, Target, Users, Zap, Plus, CheckCircle, ChevronRight } from 'lucide-react'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'

export interface BeatCard {
  id: string
  stage: '起' | '承' | '转' | '合'
  title: string
  summary: string
  tension: number // 1 to 10
  characters: string[]
  completed: boolean
}

const DEFAULT_BEATS: BeatCard[] = [
  {
    id: 'beat-1',
    stage: '起',
    title: '开篇伏线与日常打破',
    summary: '主角在看似平静的日常中察觉到异常波动，神秘线索初现。',
    tension: 3,
    characters: ['林深', '苏清月'],
    completed: true
  },
  {
    id: 'beat-2',
    stage: '承',
    title: '冲突升级与初次试探',
    summary: '面对突如其来的外力压迫，林深被迫展开反击，暴露出潜藏的实力。',
    tension: 6,
    characters: ['林深', '黑袍人'],
    completed: false
  },
  {
    id: 'beat-3',
    stage: '转',
    title: '关键转折与身份反差',
    summary: '暗处的神秘人竟是昔日同门，局面彻底反转，林深陷入两难绝境。',
    tension: 9,
    characters: ['林深', '苏清月', '黑袍人'],
    completed: false
  },
  {
    id: 'beat-4',
    stage: '合',
    title: '余波暂定与更大危机悬念',
    summary: '险胜破局，但留下的残缺信物揭示了更大的阴谋幕后。',
    tension: 5,
    characters: ['林深'],
    completed: false
  }
]

export function StoryBeatsDrawer({
  chapterTitle
}: {
  chapterTitle?: string
}) {
  const [beats, setBeats] = useState<BeatCard[]>(DEFAULT_BEATS)

  const toggleBeat = (id: string) => {
    setBeats((items) =>
      items.map((b) => (b.id === id ? { ...b, completed: !b.completed } : b))
    )
  }

  const getStageBadgeColor = (stage: BeatCard['stage']) => {
    switch (stage) {
      case '起':
        return 'bg-blue-100 text-blue-800'
      case '承':
        return 'bg-amber-100 text-amber-800'
      case '转':
        return 'bg-red-100 text-red-800'
      case '合':
        return 'bg-emerald-100 text-emerald-800'
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="bg-[#f5efe6] p-4 rounded-xl border border-[#e5ddd3]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#2c2523] flex items-center gap-1.5">
            <Flame size={15} className="text-[#c85a32]" />
            <span>章节戏剧张力节拍</span>
          </span>
          <span className="text-[11px] text-[#7d6b59]">{chapterTitle || '当前章节'}</span>
        </div>
        <p className="text-xs text-[#7d6b59] leading-relaxed">
          起承转合叙事流：通过节拍卡把控章节情绪推进，保证冲突张力不塌陷。
        </p>
      </div>

      <div className="space-y-3 overflow-y-auto flex-1 pr-1">
        {beats.map((beat, idx) => (
          <Card
            key={beat.id}
            onClick={() => toggleBeat(beat.id)}
            className={`p-4 cursor-pointer transition-all border-[#e5ddd3] hover:border-[#dacdbe] hover:shadow-xs ${
              beat.completed ? 'bg-white/60 opacity-80' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${getStageBadgeColor(
                    beat.stage
                  )}`}
                >
                  {beat.stage}
                </span>
                <span className="text-xs font-bold text-[#2c2523] font-serif">
                  {beat.title}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#c85a32] font-semibold">
                  张力 {beat.tension}/10
                </span>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    beat.completed
                      ? 'bg-[#2d6a4f] border-[#2d6a4f] text-white'
                      : 'border-[#dacdbe]'
                  }`}
                >
                  {beat.completed && <CheckCircle size={12} />}
                </div>
              </div>
            </div>

            <p className="text-xs text-[#54473b] leading-relaxed mb-3">
              {beat.summary}
            </p>

            <div className="flex items-center justify-between text-[11px] text-[#7d6b59] pt-2 border-t border-[#f5efe6]">
              <div className="flex items-center gap-1">
                <Users size={12} />
                <span>{beat.characters.join('、')}</span>
              </div>
              <div className="w-20 bg-gray-200 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#c85a32] h-full rounded-full"
                  style={{ width: `${beat.tension * 10}%` }}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
