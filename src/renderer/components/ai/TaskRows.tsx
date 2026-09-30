import React from 'react'
import { CheckCircle2, Loader2, Pause, Play, RotateCw, StopCircle, XCircle } from 'lucide-react'
import { Button } from '@appica/ui-react/button'

export interface TaskItem {
  id: string
  title: string
  state: string
  progress?: number
  stage?: string
  message?: string
  onCancel?: () => void
  onPause?: () => void
  onResume?: () => void
  onRetry?: () => void
}

export function TaskRows({ items }: { items: TaskItem[] }) {
  const getBadge = (state: string) => {
    switch (state) {
      case 'completed':
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 size={11} />
            <span>已完成</span>
          </span>
        )
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <Loader2 size={11} className="animate-spin" />
            <span>执行中</span>
          </span>
        )
      case 'queued':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            排队中
          </span>
        )
      case 'failed':
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            <XCircle size={11} />
            <span>{state === 'cancelled' ? '已取消' : '失败'}</span>
          </span>
        )
      case 'interrupted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
            <XCircle size={11} />
            <span>已中断</span>
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {state}
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {items.map((item) => (
        <div
          key={item.id}
          className="p-3.5 border border-[#e5ddd3] dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl space-y-2 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#2c2523] dark:text-slate-100 truncate font-serif">
              {item.title}
            </span>
            <div className="flex items-center gap-1.5">
              {getBadge(item.state)}
              {item.state === 'running' && item.onCancel && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={item.onCancel}
                  className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors h-6 w-6"
                  title="取消正在执行的任务"
                  aria-label="取消任务"
                >
                  <StopCircle size={13} />
                </Button>
              )}
              {(item.state === 'running' || item.state === 'queued') && item.onPause && (
                <Button variant="ghost" size="icon-sm" onClick={item.onPause} className="p-1 text-[#7d6b59] hover:bg-[#f5efe6] rounded transition-colors h-6 w-6" title="暂停任务" aria-label="暂停任务">
                  <Pause size={13} />
                </Button>
              )}
              {item.state === 'interrupted' && item.onResume && (
                <Button variant="ghost" size="icon-sm" onClick={item.onResume} className="p-1 text-[#2d6a4f] hover:bg-emerald-50 rounded transition-colors h-6 w-6" title="恢复任务" aria-label="恢复任务">
                  <Play size={13} />
                </Button>
              )}
              {item.state === 'failed' && item.onRetry && (
                <Button variant="ghost" size="icon-sm" onClick={item.onRetry} className="p-1 text-[#b45309] hover:bg-orange-50 rounded transition-colors h-6 w-6" title="重试失败步骤" aria-label="重试失败步骤">
                  <RotateCw size={13} />
                </Button>
              )}
            </div>
          </div>

          {item.state === 'running' && item.progress !== undefined && (
            <div className="space-y-1">
              <div className="w-full bg-[#efe6da] dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#2d6a4f] h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(item.progress * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#7d6b59] dark:text-slate-400">
                <span>{item.stage || '正在处理中...'}</span>
                <span>{Math.round(item.progress * 100)}%</span>
              </div>
            </div>
          )}

          {item.message && (
            <p className="text-[11px] text-[#7d6b59] dark:text-slate-400 leading-relaxed bg-[#f5efe6] dark:bg-slate-800/60 p-2 rounded-lg">
              {item.message}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
