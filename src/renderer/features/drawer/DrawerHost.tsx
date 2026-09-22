import React from 'react'
import { X, Flame, Compass, BookOpen, ListOrdered, FileBarChart } from 'lucide-react'
import { useWorkbenchStore, type DrawerType } from '../../stores/useWorkbenchStore'
import { StoryBeatsDrawer } from './StoryBeatsDrawer'
import { OutlineDrawer } from './OutlineDrawer'
import { KnowledgeDrawer } from './KnowledgeDrawer'
import { TaskCenterDrawer } from './TaskCenterDrawer'
import { InspectorDrawer } from './InspectorDrawer'
import type { Chapter } from '../../../shared/project'

export interface DrawerHostProps {
  currentChapter?: Chapter | null
  onSelectChapter?: (id: string) => void
  onCreateSnapshot?: () => void
}

export function DrawerHost({
  currentChapter = null,
  onSelectChapter,
  onCreateSnapshot
}: DrawerHostProps) {
  const { activeDrawer, closeDrawer } = useWorkbenchStore()

  if (!activeDrawer) return null

  const getDrawerMeta = (drawer: DrawerType) => {
    switch (drawer) {
      case 'beats':
        return {
          title: '故事节拍与冲突张力',
          icon: Flame,
          color: 'text-[#c85a32]'
        }
      case 'outline':
        return {
          title: '大纲与故事脉络',
          icon: Compass,
          color: 'text-[#2d6a4f]'
        }
      case 'knowledge':
        return {
          title: '人物与设定知识库',
          icon: BookOpen,
          color: 'text-[#b45309]'
        }
      case 'tasks':
        return {
          title: '后台任务执行中心',
          icon: ListOrdered,
          color: 'text-[#6b7280]'
        }
      case 'inspector':
        return {
          title: '章节属性与检视',
          icon: FileBarChart,
          color: 'text-[#7d6b59]'
        }
    }
  }

  const meta = getDrawerMeta(activeDrawer)
  const Icon = meta.icon

  return (
    <aside
      data-tour="inspector"
      className="w-96 border-l border-[#e5ddd3] bg-[#faf8f5] flex flex-col h-full shrink-0 shadow-lg select-none z-20 animate-in slide-in-from-right duration-200"
      aria-label={meta.title}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#e5ddd3] bg-[#faf8f5]">
        <div className="flex items-center gap-2">
          <Icon size={16} className={meta.color} />
          <h2 className="text-xs font-bold text-[#2c2523] font-serif tracking-wide">
            {meta.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={closeDrawer}
          className="p-1 text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-lg transition-colors"
          title="关闭侧边面板"
        >
          <X size={15} />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeDrawer === 'beats' && (
          <StoryBeatsDrawer chapterTitle={currentChapter?.title} />
        )}
        {activeDrawer === 'outline' && (
          <OutlineDrawer onSelectChapter={onSelectChapter} />
        )}
        {activeDrawer === 'knowledge' && <KnowledgeDrawer />}
        {activeDrawer === 'tasks' && <TaskCenterDrawer />}
        {activeDrawer === 'inspector' && (
          <InspectorDrawer
            chapter={currentChapter}
            onCreateSnapshot={onCreateSnapshot}
          />
        )}
      </div>
    </aside>
  )
}
