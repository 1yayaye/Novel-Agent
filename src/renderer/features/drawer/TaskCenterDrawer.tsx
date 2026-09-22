import React from 'react'
import { ListOrdered, CheckCircle2, XCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { useTaskStore } from '../../stores/useTaskStore'

export function TaskCenterDrawer() {
  const { tasks, clearCompleted } = useTaskStore()

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <Badge variant="warning" className="gap-1 text-[10px]">
            <Loader2 size={11} className="animate-spin" />
            <span>执行中</span>
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant="success" className="gap-1 text-[10px]">
            <CheckCircle2 size={11} />
            <span>已完成</span>
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertCircle size={11} />
            <span>失败</span>
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <span>已取消</span>
          </Badge>
        )
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#7d6b59]">
          当前任务队列 ({tasks.length})
        </span>
        {tasks.some((t) => t.status !== 'running') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearCompleted}
            className="h-7 text-xs text-[#7d6b59] gap-1"
          >
            <Trash2 size={12} />
            <span>清理已结束</span>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {tasks.length === 0 ? (
          <div className="py-16 text-center text-xs text-[#baa997] space-y-1">
            <ListOrdered size={24} className="mx-auto mb-2 opacity-50" />
            <div>暂无后台运行任务</div>
            <div className="text-[11px] text-[#baa997]/80">AI 创作或全文分析进行时会在此处实时显示进度</div>
          </div>
        ) : (
          tasks.map((task) => (
            <Card key={task.id} className="p-3.5 border-[#e5ddd3] bg-white space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#2c2523] truncate font-serif">
                  {task.title}
                </span>
                {getStatusBadge(task.status)}
              </div>

              {task.status === 'running' && (
                <div className="space-y-1">
                  <div className="w-full bg-[#efe6da] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#2d6a4f] h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(task.progress * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#7d6b59]">
                    <span>{task.stage || '正在处理中...'}</span>
                    <span>{Math.round(task.progress * 100)}%</span>
                  </div>
                </div>
              )}

              {task.message && (
                <p className="text-[11px] text-[#7d6b59] leading-relaxed bg-[#f5efe6] p-2 rounded-lg">
                  {task.message}
                </p>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
