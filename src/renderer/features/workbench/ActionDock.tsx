import React from 'react'
import {
  Compass,
  BookOpen,
  Sparkles,
  Flame,
  FileBarChart,
  ListOrdered,
  Maximize2,
  Minimize2,
  CheckCircle,
  MessageSquare
} from 'lucide-react'
import { useWorkbenchStore, type DrawerType } from '../../stores/useWorkbenchStore'
import { useEditorStore } from '../../stores/useEditorStore'

export function ActionDock({
  onToggleZenMode,
  isZenMode = false
}: {
  onToggleZenMode?: () => void
  isZenMode?: boolean
}) {
  const { activeDrawer, toggleDrawer, openDialog } = useWorkbenchStore()
  const { wordCount } = useEditorStore()

  const dockButtons: Array<{
    id: DrawerType | 'chat'
    label: string
    icon: typeof Compass
    colorClass: string
    activeClass: string
    onClick: () => void
    isActive: boolean
  }> = [
    {
      id: 'beats',
      label: '故事节拍',
      icon: Flame,
      colorClass: 'text-[#c85a32]',
      activeClass: 'bg-[#fceee9] text-[#c85a32]',
      onClick: () => toggleDrawer('beats'),
      isActive: activeDrawer === 'beats'
    },
    {
      id: 'outline',
      label: '大纲脉络',
      icon: Compass,
      colorClass: 'text-[#2d6a4f]',
      activeClass: 'bg-[#e8f3ee] text-[#2d6a4f]',
      onClick: () => toggleDrawer('outline'),
      isActive: activeDrawer === 'outline'
    },
    {
      id: 'knowledge',
      label: '人物设定',
      icon: BookOpen,
      colorClass: 'text-[#b45309]',
      activeClass: 'bg-[#fef3c7] text-[#b45309]',
      onClick: () => toggleDrawer('knowledge'),
      isActive: activeDrawer === 'knowledge'
    },
    {
      id: 'chat',
      label: '创作问答',
      icon: MessageSquare,
      colorClass: 'text-[#2563eb]',
      activeClass: 'bg-blue-50 text-blue-600',
      onClick: () => openDialog('chat'),
      isActive: false
    },
    {
      id: 'inspector',
      label: '章节检视',
      icon: FileBarChart,
      colorClass: 'text-[#7d6b59]',
      activeClass: 'bg-[#efe6da] text-[#2c2523]',
      onClick: () => toggleDrawer('inspector'),
      isActive: activeDrawer === 'inspector'
    },
    {
      id: 'tasks',
      label: '任务中心',
      icon: ListOrdered,
      colorClass: 'text-[#6b7280]',
      activeClass: 'bg-gray-100 text-gray-800',
      onClick: () => toggleDrawer('tasks'),
      isActive: activeDrawer === 'tasks'
    }
  ]

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 select-none">
      <div className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#faf8f5]/95 backdrop-blur-md border border-[#e5ddd3] shadow-lg shadow-stone-300/30 rounded-full transition-all">
        {dockButtons.map((btn) => {
          const Icon = btn.icon
          return (
            <button
              key={btn.id}
              type="button"
              onClick={btn.onClick}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all active:scale-95 ${
                btn.isActive
                  ? btn.activeClass
                  : 'text-[#54473b] hover:bg-[#efe6da]/80 hover:text-[#2c2523]'
              }`}
              title={btn.label}
            >
              <Icon size={14} className={btn.isActive ? 'currentColor' : btn.colorClass} />
              <span className="hidden sm:inline">{btn.label}</span>
            </button>
          )
        })}

        <div className="h-4 w-px bg-[#e5ddd3] mx-1" />

        {/* Live Word Count indicator */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-[#7d6b59] font-mono"
          title="当前章节字数"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#2d6a4f]" />
          <span>{wordCount.toLocaleString()} 字</span>
        </div>

        {onToggleZenMode && (
          <>
            <div className="h-4 w-px bg-[#e5ddd3] mx-1" />
            <button
              type="button"
              onClick={onToggleZenMode}
              className="p-1.5 text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-full transition-colors"
              title={isZenMode ? '退出沉浸写作模式 (Esc)' : '进入沉浸全屏写作模式 (Zen Mode)'}
            >
              {isZenMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
