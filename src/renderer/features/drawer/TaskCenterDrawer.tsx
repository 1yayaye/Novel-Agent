import React, { useEffect, useState } from 'react'
import { ListOrdered, Trash2 } from 'lucide-react'
import { Button } from '@appica/ui-react/button'
import { TaskRows } from '../../components/ai/TaskRows'
import { useTaskStore } from '../../stores/useTaskStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { taskTypeLabel } from '../../utils/constants'

export function TaskCenterDrawer() {
  const { project } = useProjectStore()
  const { tasks, setTasks, updateTask, clearCompleted } = useTaskStore()
  const [isEmptyStateRevealed, setIsEmptyStateRevealed] = useState(false)

  useEffect(() => {
    if (tasks.length > 0) {
      setIsEmptyStateRevealed(false)
      return
    }
    const frame = window.requestAnimationFrame(() => setIsEmptyStateRevealed(true))
    return () => window.cancelAnimationFrame(frame)
  }, [tasks.length])

  useEffect(() => {
    if (!project) return
    let active = true
    window.novelAgent.task
      .list({ sessionId: project.sessionId })
      .then((list: any[]) => {
        if (active && Array.isArray(list)) {
          setTasks(
            list.map((t) => ({
              id: t.id,
              type: t.type || 'task',
              title: t.title || taskTypeLabel[t.type as keyof typeof taskTypeLabel] || '后台任务',
              progress: t.progress ?? (t.state === 'completed' ? 1 : 0),
              status: t.state || 'running',
              stage: t.stage || '',
              message: t.error || '',
              createdAt: t.createdAt || Date.now()
            }))
          )
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [project, setTasks])

  const handleCancelTask = async (taskId: string) => {
    if (!project) return
    try {
      await window.novelAgent.analysis?.cancel?.({
        sessionId: project.sessionId,
        taskId
      })
      updateTask(taskId, { status: 'cancelled' })
    } catch {}
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
          <div className={`py-16 text-center text-xs text-[#baa997] space-y-1 skeleton-reveal task-empty-state ${isEmptyStateRevealed ? 'is-revealed' : ''}`}>
            <div className="skeleton-reveal-skeleton" aria-hidden="true" />
            <div className="skeleton-reveal-content">
              <ListOrdered size={24} className="mx-auto mb-2 opacity-50" />
              <div>暂无后台运行任务</div>
              <div className="text-[11px] text-[#baa997]/80">AI 创作或全文分析进行时会在此处实时显示进度</div>
            </div>
          </div>
        ) : (
          <TaskRows
            items={tasks.map((task) => ({
              id: task.id,
              title: task.title,
              state: task.status,
              progress: task.progress,
              stage: task.stage,
              message: task.message,
              onCancel: () => void handleCancelTask(task.id)
            }))}
          />
        )}
      </div>
    </div>
  )
}
