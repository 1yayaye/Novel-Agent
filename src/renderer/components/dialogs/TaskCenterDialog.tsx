import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { AlertOctagon, Eye, Plus, RefreshCw, RotateCcw, RotateCw, Square, X } from 'lucide-react'
import { TaskDetail, TaskSummary, TaskStep } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { taskTypeLabel, taskStateLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function TaskCenterDialog({
  sessionId,
  isReadOnly,
  onClose,
  onLaunchNew,
  onNavigateChapter
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
  onLaunchNew: () => void
  onNavigateChapter: (chapterId?: string) => void
}) {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const { dialogRef, backdropProps } = useDialogDismiss<HTMLDivElement>({
    isOpen: true,
    onClose
  })

  const loadTasks = useCallback(async () => {
    try {
      const list = await window.novelAgent.task.list({ sessionId })
      setTasks(list)
      if (list.length > 0 && !selectedTaskId) {
        setSelectedTaskId(list[0].id)
      }
    } catch (err) {
      setError(errorText(err, '加载任务列表失败'))
    }
  }, [sessionId, selectedTaskId])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const detail = await window.novelAgent.task.get({ sessionId, taskId: id })
      setTaskDetail(detail)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (selectedTaskId) {
      void loadDetail(selectedTaskId)
    } else {
      setTaskDetail(null)
    }
  }, [selectedTaskId, loadDetail])

  // Listen to real-time progress events
  useEffect(() => {
    const unsub = window.novelAgent?.task?.onProgress?.((event) => {
      if (event.taskId === selectedTaskId) {
        void loadDetail(event.taskId)
      }
      void loadTasks()
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [selectedTaskId, loadDetail, loadTasks])

  const handleCancel = async (taskId: string) => {
    setActionLoading(true)
    try {
      await window.novelAgent.analysis.cancel({ sessionId, taskId })
      await loadTasks()
      if (selectedTaskId) await loadDetail(selectedTaskId)
    } catch (err) {
      setError(errorText(err, '取消任务失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleResume = async (taskId: string) => {
    setActionLoading(true)
    try {
      await window.novelAgent.analysis.resume({ sessionId, taskId })
      await loadTasks()
      if (selectedTaskId) await loadDetail(selectedTaskId)
    } catch (err) {
      setError(errorText(err, '恢复任务失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRetryStep = async (taskId: string, stepId: string) => {
    setActionLoading(true)
    try {
      await window.novelAgent.task.retryStep({ sessionId, taskId, stepId })
      await loadTasks()
      if (selectedTaskId) await loadDetail(selectedTaskId)
    } catch (err) {
      setError(errorText(err, '重试步骤失败'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleSkipStep = async (taskId: string, stepId: string) => {
    setActionLoading(true)
    try {
      await window.novelAgent.task.skipStep({ sessionId, taskId, stepId })
      await loadTasks()
      if (selectedTaskId) await loadDetail(selectedTaskId)
    } catch (err) {
      setError(errorText(err, '跳过步骤失败'))
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="tasks-dialog" role="dialog" aria-modal="true" aria-label="任务中心与后台队列" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>任务中心与进度监控</h2>
            <p>查看后台单章知识提取、全书文学剖析、滚动大纲任务状态与执行步骤</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="primary-button" disabled={isReadOnly} onClick={onLaunchNew}>
              <Plus size={14} />发起新任务
            </button>
            <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </header>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="tasks-body">
          <aside className="tasks-sidebar">
            <div className="panel-caption">
              <span>历史任务 ({tasks.length})</span>
              <IconButton label="刷新列表" onClick={() => void loadTasks()}>
                <RefreshCw size={13} />
              </IconButton>
            </div>
            <div className="tasks-list">
              {tasks.length === 0 ? (
                <p className="empty-hint">暂无分析任务</p>
              ) : (
                tasks.map((t) => (
                  <button
                    key={t.id}
                    className={`task-row ${t.id === selectedTaskId ? 'selected' : ''}`}
                    onClick={() => setSelectedTaskId(t.id)}
                  >
                    <div className="task-row-header">
                      <strong>{taskTypeLabel[t.type] || t.type}</strong>
                      <span className={`task-badge ${t.state}`}>{taskStateLabel[t.state] || t.state}</span>
                    </div>
                    <div className="task-row-meta">
                      <span>{formatDate(t.createdAt)}</span>
                      {t.inputTokens !== null && t.inputTokens !== undefined && <span>{(t.inputTokens + (t.outputTokens || 0)).toLocaleString()} Tokens</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="task-detail-pane">
            {!taskDetail ? (
              <div className="empty-copy" style={{ textAlign: 'center', padding: '60px 0' }}>
                <p>请在左侧选择要查看的任务详情</p>
              </div>
            ) : (
              <div className="task-detail-content">
                <div className="task-detail-header-card">
                  <div className="task-detail-title-row">
                    <div>
                      <h3>{taskTypeLabel[taskDetail.type] || taskDetail.type}</h3>
                      <span className="task-detail-time">创建于 {formatDate(taskDetail.createdAt)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`task-badge ${taskDetail.state}`} style={{ fontSize: 13, padding: '4px 10px' }}>
                        {taskStateLabel[taskDetail.state] || taskDetail.state}
                      </span>
                      {(taskDetail.state === 'running' || taskDetail.state === 'queued') && (
                        <button
                          type="button"
                          className="danger-button"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                          disabled={actionLoading || taskDetail.cancelRequested}
                          onClick={() => void handleCancel(taskDetail.id)}
                        >
                          <Square size={12} />
                          {taskDetail.cancelRequested ? '取消请求中...' : '取消任务'}
                        </button>
                      )}
                      {(taskDetail.state === 'failed' || taskDetail.state === 'interrupted') && (
                        <button
                          type="button"
                          className="primary-button"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                          disabled={actionLoading}
                          onClick={() => void handleResume(taskDetail.id)}
                        >
                          <RotateCcw size={12} />
                          恢复执行
                        </button>
                      )}
                    </div>
                  </div>

                  {taskDetail.errorMessage && (
                    <div className="alert-banner danger" style={{ marginTop: 12 }}>
                      <AlertOctagon size={16} />
                      <div>
                        <strong>执行异常 ({taskDetail.errorCode}):</strong>
                        <div>{taskDetail.errorMessage}</div>
                      </div>
                    </div>
                  )}

                  <div className="task-stats-grid">
                    <div className="task-stat-box">
                      <span>步骤进度</span>
                      <strong>
                        {taskDetail.steps.filter((s) => s.state === 'completed' || s.state === 'skipped').length} / {taskDetail.steps.length}
                      </strong>
                    </div>
                    <div className="task-stat-box">
                      <span>Token 消耗</span>
                      <strong>
                        {((taskDetail.inputTokens || 0) + (taskDetail.outputTokens || 0)).toLocaleString()}
                      </strong>
                    </div>
                    <div className="task-stat-box">
                      <span>耗时</span>
                      <strong>
                        {taskDetail.startedAt
                          ? `${Math.round(((taskDetail.completedAt || Date.now()) - taskDetail.startedAt) / 1000)} 秒`
                          : '未开始'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="task-steps-section">
                  <h4>执行步骤 ({taskDetail.steps.length})</h4>
                  <div className="task-steps-list">
                    {taskDetail.steps.map((step) => (
                      <div key={step.id} className={`task-step-card ${step.state}`}>
                        <div className="step-left">
                          <span className="step-position">#{step.position + 1}</span>
                          <div className="step-info">
                            <strong>{step.chapterTitle ? `章节: ${step.chapterTitle}` : `步骤: ${step.id.slice(0, 8)}`}</strong>
                            <div className="step-meta">
                              <span>状态: {taskStateLabel[step.state] || step.state}</span>
                              {step.resultState && <span>• 结果时效: {step.resultState === 'current' ? '最新 (current)' : '已过时 (stale)'}</span>}
                              {step.attemptCount > 1 && <span>• 尝试次数: {step.attemptCount}</span>}
                            </div>
                            {step.errorMessage && (
                              <p className="inline-error" style={{ margin: '4px 0 0' }}>{step.errorMessage}</p>
                            )}
                          </div>
                        </div>

                        <div className="step-actions">
                          {step.chapterId && (
                            <button
                              type="button"
                              className="text-button"
                              style={{ fontSize: 11 }}
                              onClick={() => {
                                onNavigateChapter(step.chapterId ?? undefined)
                                onClose()
                              }}
                            >
                              <Eye size={12} />查看章节
                            </button>
                          )}
                          {step.state === 'failed' && (
                            <>
                              <button
                                type="button"
                                className="primary-button"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                disabled={actionLoading}
                                onClick={() => void handleRetryStep(taskDetail.id, step.id)}
                              >
                                <RotateCw size={11} />重试步骤
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                disabled={actionLoading}
                                onClick={() => void handleSkipStep(taskDetail.id, step.id)}
                              >
                                跳过步骤
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className="dialog-footer">
          <span>任务支持跨章节断点续跑，单步骤失败可单独重试或跳过</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

export const TasksManagerDialog = TaskCenterDialog
