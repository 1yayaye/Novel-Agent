import React from 'react'
import { BookOpen, Radio, Loader2, Compass, ScrollText, Sparkles, HelpCircle, FileDown } from 'lucide-react'
import { WindowControls } from '../../components/common/WindowControls'
import { Button } from '@appica/ui-react/button'
import { useWorkbenchStore } from '../../stores/useWorkbenchStore'
import { useProjectStore } from '../../stores/useProjectStore'

function getEndpointHost(url?: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

export function TopBar({
  onReturnToShelf,
  activeTaskProgress,
  defaultConnection
}: {
  onReturnToShelf?: () => void
  activeTaskProgress?: { title?: string; progress?: number; state?: string } | null
  defaultConnection?: { name: string; baseUrl: string; confirmedContentTargetFingerprint?: string } | null
}) {
  const { project } = useProjectStore()
  const { openDialog, openDrawer } = useWorkbenchStore()

  return (
    <header className="drag-region h-11 border-b border-[#e5ddd3] bg-[#faf8f5] flex items-center justify-between px-3 select-none shrink-0 z-30">
      {/* Left side: Return to shelf + Project Title + Model Connection Badge */}
      <div className="no-drag-region flex items-center gap-3">
        {onReturnToShelf && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReturnToShelf}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-lg transition-colors h-auto"
            title="返回作品书架 (关闭当前作品)"
            aria-label="返回书架"
          >
            <BookOpen size={14} />
            <span className="font-medium">书架</span>
          </Button>
        )}

        <div className="h-4 w-px bg-[#e5ddd3]" />

        <strong className="text-xs font-bold text-[#2c2523] font-serif tracking-wide truncate max-w-xs" title={project?.metadata.title}>
          {project?.metadata.title || 'Novel Agent'}
        </strong>

        <Button
          variant="ghost"
          size="sm"
          data-tour="connection-badge"
          onClick={() => openDialog('connection')}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-[#efe6da] hover:bg-[#e5ddd3] text-[#54473b] transition-colors border border-[#dacdbe]/60 h-auto"
          title="点击配置模型连接与任务路由"
          aria-label="模型连接状态"
        >
          <span className={`w-2 h-2 rounded-full ${defaultConnection ? 'bg-[#2d6a4f]' : 'bg-amber-500'}`} />
          <Radio size={11} className="text-[#7d6b59]" />
          <span className="truncate max-w-[140px]">
            {defaultConnection ? `${defaultConnection.name} (${getEndpointHost(defaultConnection.baseUrl)})` : '未连接模型'}
          </span>
        </Button>

        {activeTaskProgress && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] bg-[#e8f3ee] text-[#2d6a4f] border border-[#c4e1d3] animate-pulse">
            <Loader2 size={11} className="animate-spin" />
            <span>{activeTaskProgress.title || '后台任务执行中'} ({Math.round((activeTaskProgress.progress || 0) * 100)}%)</span>
          </div>
        )}
      </div>

      {/* Right side: Quick actions + Native Window controls */}
      <div className="no-drag-region flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openDialog('export')}
          className="p-1.5 text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-lg transition-colors"
          title="导出作品文档"
          aria-label="导出作品文档"
        >
          <FileDown size={15} />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openDialog('tour')}
          className="p-1.5 text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-lg transition-colors"
          title="工作台新手向导"
          aria-label="工作台向导"
        >
          <HelpCircle size={15} />
        </Button>

        <div className="h-4 w-px bg-[#e5ddd3] mx-1" />

        <WindowControls />
      </div>
    </header>
  )
}
