import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  GitCompare,
  Layers,
  ListTree,
  Loader2,
  Pause,
  Play,
  RotateCw,
  StopCircle,
  Users,
  X,
  XCircle,
  FileText,
  Sparkles
} from 'lucide-react'
import type { TaskDetail, BookOutline } from '../../../shared/project'
import type {
  BookSummaryArtifact,
  BookSummaryResult,
  BookSummaryStepKind,
  SummaryRelationGraph,
  SummarySystemAssessment
} from '../../../shared/contracts/book-summary'
import { Dialog, DialogContent } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { IconButton } from '../common/IconButton'
import { useToast } from '../common/Toast'
import { errorText } from '../../utils/formatters'

export interface BookSummaryDialogProps {
  sessionId: string
  taskId?: string
  isReadOnly: boolean
  onClose: () => void
  onOpenOutlineEditor?: () => void
}

const STEP_KIND_LABELS: Record<BookSummaryStepKind, string> = {
  small: '正文小总结',
  mainline: '剧情主线',
  stage: '阶段大总结',
  foreshadow: '伏笔线索',
  characters: '角色档案',
  worldview: '世界观设定',
  relations: '人物关系图',
  systemAssess: '体系适用判断',
  system: '等级/修为体系',
  timeline: '事件时间线',
  locations: '地点与势力',
  unresolved: '未解问题',
  super: '全书超级总结',
  outline: '全书大纲候选'
}

export function BookSummaryDialog({
  sessionId,
  taskId: initialTaskId,
  isReadOnly,
  onClose,
  onOpenOutlineEditor
}: BookSummaryDialogProps) {
  const { showToast } = useToast()

  const [activeTaskId, setActiveTaskId] = useState<string | undefined>(initialTaskId)
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [stepFilter, setStepFilter] = useState<'all' | 'summary' | 'ledger' | 'super'>('all')

  // Outline Comparison Modal State
  const [showOutlineComparison, setShowOutlineComparison] = useState(false)
  const [currentOutline, setCurrentOutline] = useState<BookOutline | null>(null)
  const [loadingOutline, setLoadingOutline] = useState(false)
  const [applyingOutline, setApplyingOutline] = useState(false)

  // Actions loading
  const [actionLoading, setActionLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 1. Fetch Task Details
  const loadTask = useCallback(async (targetId: string) => {
    try {
      const detail = await window.novelAgent.task.get({ sessionId, taskId: targetId })
      setTask(detail)
      return detail
    } catch (err) {
      setError(errorText(err, '加载任务详情失败'))
      return null
    }
  }, [sessionId])

  // Initial load
  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      try {
        let currentId = initialTaskId
        if (!currentId) {
          const list = await window.novelAgent.task.list({ sessionId, type: 'book_summary' })
          if (list && list.length > 0) {
            currentId = list[0].id
            if (active) setActiveTaskId(currentId)
          }
        }
        if (currentId && active) {
          await loadTask(currentId)
        }
      } catch (err) {
        if (active) setError(errorText(err, '读取任务列表失败'))
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [sessionId, initialTaskId, loadTask])

  // Subscribe to real-time task progress
  useEffect(() => {
    if (!activeTaskId) return
    const unsub = window.novelAgent.task.onProgress?.((event) => {
      if (event.taskId === activeTaskId) {
        void loadTask(activeTaskId)
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [activeTaskId, loadTask])

  const bookSummary: BookSummaryResult | undefined = task?.bookSummary

  // Step selection logic
  useEffect(() => {
    if (!bookSummary || bookSummary.stepPlan.length === 0) return
    if (!selectedStepId) {
      // Pick running step, or last completed step, or first step
      const runningIndex = task?.steps.findIndex((s) => s.state === 'running')
      if (runningIndex !== undefined && runningIndex >= 0) {
        setSelectedStepId(bookSummary.stepPlan[runningIndex].stepId)
        return
      }
      const lastCompletedArtifact = bookSummary.artifacts[bookSummary.artifacts.length - 1]
      if (lastCompletedArtifact) {
        setSelectedStepId(lastCompletedArtifact.stepId)
      } else {
        setSelectedStepId(bookSummary.stepPlan[0].stepId)
      }
    }
  }, [bookSummary, task, selectedStepId])

  // Filtered steps
  const filteredSteps = useMemo(() => {
    if (!bookSummary) return []
    return bookSummary.stepPlan.map((planItem, index) => {
      const stepState = task?.steps[index]?.state || 'pending'
      const artifact = bookSummary.artifacts.find((a) => a.stepId === planItem.stepId)
      return {
        ...planItem,
        state: stepState,
        artifact
      }
    }).filter((item) => {
      if (stepFilter === 'summary') return item.kind === 'small' || item.kind === 'stage' || item.kind === 'super'
      if (stepFilter === 'ledger') return item.kind !== 'small' && item.kind !== 'stage' && item.kind !== 'super' && item.kind !== 'outline'
      if (stepFilter === 'super') return item.kind === 'super' || item.kind === 'outline'
      return true
    })
  }, [bookSummary, task, stepFilter])

  // Currently selected step & artifact
  const currentStepInfo = useMemo(() => {
    if (!bookSummary) return null
    const index = bookSummary.stepPlan.findIndex((s) => s.stepId === selectedStepId)
    if (index < 0) return null
    const plan = bookSummary.stepPlan[index]
    const step = task?.steps[index]
    const artifact = bookSummary.artifacts.find((a) => a.stepId === selectedStepId)
    return { plan, step, artifact, index }
  }, [bookSummary, task, selectedStepId])

  // --- Task Operations ---
  const handlePause = async () => {
    if (!activeTaskId) return
    setActionLoading(true)
    try {
      await window.novelAgent.analysis.pause({ sessionId, taskId: activeTaskId })
      showToast('全书总结任务已暂停', 'info')
      await loadTask(activeTaskId)
    } catch (err) {
      showToast(errorText(err, '暂停任务失败'), 'warning')
    } finally {
      setActionLoading(false)
    }
  }

  const handleResume = async () => {
    if (!activeTaskId) return
    setActionLoading(true)
    try {
      await window.novelAgent.analysis.resume({ sessionId, taskId: activeTaskId })
      showToast('全书总结任务已恢复', 'info')
      await loadTask(activeTaskId)
    } catch (err) {
      showToast(errorText(err, '恢复任务失败'), 'warning')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRetryWhole = async () => {
    if (!activeTaskId) return
    setActionLoading(true)
    try {
      await window.novelAgent.task.retry({ sessionId, taskId: activeTaskId })
      showToast('任务重试已触发', 'info')
      await loadTask(activeTaskId)
    } catch (err) {
      showToast(errorText(err, '重试任务失败'), 'warning')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRetryStep = async (stepId: string) => {
    if (!activeTaskId) return
    setActionLoading(true)
    try {
      await window.novelAgent.task.retryStep({ sessionId, taskId: activeTaskId, stepId })
      showToast('步骤重试已触发', 'info')
      await loadTask(activeTaskId)
    } catch (err) {
      showToast(errorText(err, '重试步骤失败'), 'warning')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!activeTaskId) return
    setActionLoading(true)
    try {
      await window.novelAgent.analysis.cancel({ sessionId, taskId: activeTaskId })
      showToast('全书总结任务已取消', 'info')
      await loadTask(activeTaskId)
    } catch (err) {
      showToast(errorText(err, '取消任务失败'), 'warning')
    } finally {
      setActionLoading(false)
    }
  }

  const handleExport = async () => {
    if (!activeTaskId) return
    setExporting(true)
    try {
      const res = await window.novelAgent.analysis.exportSummary({ sessionId, taskId: activeTaskId })
      if (res?.savedPath) {
        showToast(`全书总结资料已成功导出至：${res.savedPath}`, 'success')
      }
    } catch (err) {
      showToast(errorText(err, '导出全书总结失败'), 'warning')
    } finally {
      setExporting(false)
    }
  }

  const handleCopyContent = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('资料已复制到剪贴板', 'info')
    } catch {
      showToast('复制失败，请手动选取文本', 'warning')
    }
  }

  // --- Outline Comparison & Application ---
  const handleOpenOutlineComparison = async () => {
    setShowOutlineComparison(true)
    setLoadingOutline(true)
    try {
      const bo = await window.novelAgent.outline.getBookOutline({ sessionId })
      setCurrentOutline(bo)
    } catch (err) {
      showToast(errorText(err, '加载当前全书大纲失败'), 'warning')
    } finally {
      setLoadingOutline(false)
    }
  }

  const handleApplyOutline = async () => {
    if (!activeTaskId) return
    setApplyingOutline(true)
    try {
      const expectedVersion = currentOutline?.version ?? 0
      const draft = await window.novelAgent.analysis.applyOutline({
        sessionId,
        taskId: activeTaskId,
        expectedVersion
      })
      setCurrentOutline(draft)
      showToast('全书大纲草稿应用成功！可在编辑器中进行审查确认', 'success')
    } catch (err: any) {
      if (err?.code === 'VERSION_CONFLICT') {
        showToast('全书大纲已被其他操作修改，已为您加载最新版本，请重新对比！', 'warning')
        try {
          const bo = await window.novelAgent.outline.getBookOutline({ sessionId })
          setCurrentOutline(bo)
        } catch {}
      } else {
        showToast(errorText(err, '应用全书大纲失败'), 'warning')
      }
    } finally {
      setApplyingOutline(false)
    }
  }

  const isStale = bookSummary?.resultState === 'stale'
  const isCompleted = task?.state === 'completed'
  const isRunning = task?.state === 'running'
  const isInterrupted = task?.state === 'interrupted'
  const isFailed = task?.state === 'failed'

  const completedCount = task?.steps.filter((s) => s.state === 'completed').length ?? 0
  const totalCount = task?.steps.length ?? 0
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        frame={false}
        closeButton={false}
        className="flex flex-col w-[94vw] max-w-[94vw] h-[92vh] max-h-[92vh] bg-[#faf8f5] rounded-2xl shadow-2xl overflow-hidden border border-[#e5ddd3]"
      >
        {/* Header */}
        <header className="dialog-header px-6 pt-5 pb-3 border-b border-[#e5ddd3] bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f3ee] text-[#2d6a4f]">
              <ListTree size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#2c2523] font-serif">全书剧情提取与大纲成果</h2>
                {task && (
                  <Badge
                    variant={
                      isCompleted
                        ? 'primary'
                        : isRunning
                        ? 'secondary'
                        : isFailed
                        ? 'error'
                        : isInterrupted
                        ? 'warning'
                        : 'outline'
                    }
                  >
                    {isCompleted ? '已完成' : isRunning ? `执行中 (${progressPercent}%)` : isFailed ? '失败' : isInterrupted ? '已暂停' : task.state}
                  </Badge>
                )}
                {isStale && (
                  <Badge variant="error" className="flex items-center gap-1">
                    <AlertTriangle size={11} />
                    <span>正文已变动 (产物过时)</span>
                  </Badge>
                )}
              </div>
              <p className="text-xs text-[#7d6b59]">
                {bookSummary
                  ? `来源覆盖 ${bookSummary.sources.length} 章，共 ${bookSummary.totalChars.toLocaleString()} 字 · 阶段合并上限 ${(bookSummary.stageSize / 10000).toFixed(0)} 万字`
                  : '深度分阶段提炼主线、阶段大总结、8类专项资料与全书宏观大纲'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => void handlePause()}
                  className="text-button gap-1 text-xs"
                  title="暂停当前任务"
                >
                  <Pause size={13} />
                  <span>暂停</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => void handleCancel()}
                  className="text-button text-red-600 hover:bg-red-50 gap-1 text-xs"
                  title="取消任务"
                >
                  <StopCircle size={13} />
                  <span>取消</span>
                </Button>
              </>
            )}

            {(isInterrupted || isFailed) && !isStale && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading || isReadOnly}
                  onClick={() => void handleResume()}
                  className="primary-button gap-1 text-xs"
                  title="从未完成的步骤继续执行"
                >
                  <Play size={13} />
                  <span>恢复继续</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading || isReadOnly}
                  onClick={() => void handleRetryWhole()}
                  className="text-button gap-1 text-xs"
                  title="重试整个任务"
                >
                  <RotateCw size={13} />
                  <span>重试任务</span>
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={exporting || !bookSummary || bookSummary.artifacts.length === 0}
              onClick={() => void handleExport()}
              className="text-button gap-1 text-xs"
              title="导出包含全部已提交资料的原生 Markdown 文件"
            >
              <Download size={13} />
              <span>{exporting ? '导出中...' : '导出全部资料'}</span>
            </Button>

            {bookSummary?.outlineCandidate && (
              <Button
                size="sm"
                variant="primary"
                disabled={isReadOnly || isStale}
                onClick={() => void handleOpenOutlineComparison()}
                className="primary-button gap-1 text-xs"
                title={isStale ? '来源章节已修改，过时大纲候选不可直接应用' : '与当前全书大纲进行双栏对比并应用为草稿'}
              >
                <GitCompare size={13} />
                <span>比较并应用大纲</span>
              </Button>
            )}

            <IconButton label="关闭" onClick={onClose} className="ml-2">
              <X size={18} />
            </IconButton>
          </div>
        </header>

        {/* Stale Alert Banner */}
        {isStale && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between text-xs text-amber-800 shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              <span>
                <strong>提示：</strong>章节正文、删除或排序在任务之后发生变动，当前任务产物标记为「已过时」。已有资料仍可查看、复制和导出，但不能续跑或应用大纲，建议重新发起全书总结。
              </span>
            </div>
          </div>
        )}

        {error && <div className="bg-red-50 text-red-700 px-6 py-2 text-xs border-b border-red-200">{error}</div>}

        {/* Main Content Layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column: Step Navigation Tree */}
          <aside className="w-80 border-r border-[#e5ddd3] bg-white flex flex-col shrink-0">
            <div className="p-3 border-b border-[#e5ddd3] flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#7d6b59]">
                  执行步骤 ({completedCount} / {totalCount})
                </span>
                <span className="text-[11px] text-[#baa997]">{progressPercent}%</span>
              </div>
              <div className="w-full bg-[#efe6da] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#2d6a4f] h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Filter Chips */}
              <div className="flex gap-1 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 text-[11px] px-2 rounded-lg ${stepFilter === 'all' ? 'bg-[#f5efe6] font-bold text-[#2c2523]' : 'text-[#7d6b59]'}`}
                  onClick={() => setStepFilter('all')}
                >
                  全部
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 text-[11px] px-2 rounded-lg ${stepFilter === 'summary' ? 'bg-[#f5efe6] font-bold text-[#2c2523]' : 'text-[#7d6b59]'}`}
                  onClick={() => setStepFilter('summary')}
                >
                  总结
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 text-[11px] px-2 rounded-lg ${stepFilter === 'ledger' ? 'bg-[#f5efe6] font-bold text-[#2c2523]' : 'text-[#7d6b59]'}`}
                  onClick={() => setStepFilter('ledger')}
                >
                  专项资料
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 text-[11px] px-2 rounded-lg ${stepFilter === 'super' ? 'bg-[#f5efe6] font-bold text-[#2c2523]' : 'text-[#7d6b59]'}`}
                  onClick={() => setStepFilter('super')}
                >
                  大纲/超级
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 p-2">
              <div className="flex flex-col gap-1 pb-4">
                {filteredSteps.map((item, idx) => {
                  const isSelected = item.stepId === selectedStepId
                  const isItemCompleted = item.state === 'completed'
                  const isItemRunning = item.state === 'running'
                  const isItemFailed = item.state === 'failed'

                  return (
                    <div
                      key={item.stepId}
                      onClick={() => setSelectedStepId(item.stepId)}
                      className={`group flex items-center justify-between p-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#e8f3ee] border-[#2d6a4f] text-[#2c2523]'
                          : 'bg-white border-[#f0eae1] hover:border-[#dacdbe] text-[#7d6b59]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isItemCompleted ? (
                          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                        ) : isItemRunning ? (
                          <Loader2 size={14} className="animate-spin text-amber-600 shrink-0" />
                        ) : isItemFailed ? (
                          <XCircle size={14} className="text-red-600 shrink-0" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-[#d0c5b8] shrink-0 mx-0.5" />
                        )}
                        <div className="min-w-0 flex flex-col">
                          <span className={`text-xs font-medium truncate ${isSelected ? 'text-[#2c2523] font-bold' : ''}`}>
                            {item.title}
                          </span>
                          <span className="text-[10px] text-[#baa997] truncate">
                            {STEP_KIND_LABELS[item.kind] || item.kind}
                            {item.stageIndex ? ` · 第${item.stageIndex}阶段` : ''}
                            {item.segmentIndex ? ` · 第${item.segmentIndex}段` : ''}
                          </span>
                        </div>
                      </div>

                      {isItemFailed && !isReadOnly && !isStale && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6 text-red-600 hover:bg-red-50 p-0"
                          title="重试此失败步骤"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleRetryStep(item.stepId)
                          }}
                        >
                          <RotateCw size={12} />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </aside>

          {/* Right Column: Artifact & Detail Pane */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#faf8f5] overflow-hidden">
            {currentStepInfo ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Detail Header */}
                <div className="p-4 px-6 border-b border-[#e5ddd3] bg-white flex items-center justify-between shrink-0">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[#2c2523]">{currentStepInfo.plan.title}</h3>
                      <Badge variant="outline" className="text-[11px]">
                        {STEP_KIND_LABELS[currentStepInfo.plan.kind] || currentStepInfo.plan.kind}
                      </Badge>
                      {currentStepInfo.artifact?.notApplicable && (
                        <Badge variant="secondary" className="text-[11px] bg-slate-100 text-slate-600">
                          不适用（本地记录）
                        </Badge>
                      )}
                    </div>
                    {currentStepInfo.artifact?.ranges && currentStepInfo.artifact.ranges.length > 0 && (
                      <span className="text-[11px] text-[#7d6b59]">
                        覆盖范围：
                        {currentStepInfo.artifact.ranges
                          .map((r) => {
                            const srcChapter = bookSummary?.sources.find((s) => s.chapterId === r.chapterId)
                            return `${srcChapter?.title || '章节'} [${r.startOffset} - ${r.endOffset}]`
                          })
                          .slice(0, 3)
                          .join('，')}
                        {currentStepInfo.artifact.ranges.length > 3 ? ` 等共 ${currentStepInfo.artifact.ranges.length} 处` : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {currentStepInfo.artifact && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-button gap-1 text-xs"
                        onClick={() => void handleCopyContent(currentStepInfo.artifact!.content)}
                        title="复制当前资料完整 Markdown 正文"
                      >
                        <Copy size={13} />
                        <span>复制正文</span>
                      </Button>
                    )}

                    {currentStepInfo.plan.kind === 'outline' && bookSummary?.outlineCandidate && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={isReadOnly || isStale}
                        className="primary-button gap-1 text-xs"
                        onClick={() => void handleOpenOutlineComparison()}
                      >
                        <GitCompare size={13} />
                        <span>比较全书大纲</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Detail Body */}
                <ScrollArea className="flex-1 p-6">
                  <div className="max-w-4xl mx-auto flex flex-col gap-4 pb-12">
                    {/* System Assessment Card */}
                    {currentStepInfo.artifact?.assessment && (
                      <Card className="p-4 bg-white border border-[#dacdbe] rounded-xl flex flex-col gap-3 shadow-sm">
                        <div className="flex items-center justify-between border-b border-[#f0eae1] pb-2">
                          <div className="flex items-center gap-2">
                            <Sparkles size={16} className="text-[#2d6a4f]" />
                            <span className="text-xs font-bold text-[#2c2523]">作品体系适用性判断</span>
                          </div>
                          <Badge variant={currentStepInfo.artifact.assessment.applicable ? 'primary' : 'secondary'}>
                            {currentStepInfo.artifact.assessment.applicable ? '适用体系' : '不适用体系'}
                          </Badge>
                        </div>
                        <div className="grid gap-2 text-xs">
                          {currentStepInfo.artifact.assessment.label && (
                            <div>
                              <span className="font-semibold text-[#7d6b59]">体系类别：</span>
                              <span className="text-[#2c2523] font-medium">{currentStepInfo.artifact.assessment.label}</span>
                            </div>
                          )}
                          <div>
                            <span className="font-semibold text-[#7d6b59]">判断理由：</span>
                            <span className="text-[#2c2523] leading-relaxed">{currentStepInfo.artifact.assessment.reason}</span>
                          </div>
                          {currentStepInfo.artifact.assessment.fields.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                              <span className="font-semibold text-[#7d6b59]">关键字段：</span>
                              {currentStepInfo.artifact.assessment.fields.map((f, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] bg-[#fcf9f8]">
                                  {f}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </Card>
                    )}

                    {/* Relation Graph Card */}
                    {currentStepInfo.artifact?.graph && (
                      <Card className="p-4 bg-white border border-[#dacdbe] rounded-xl flex flex-col gap-3 shadow-sm">
                        <div className="flex items-center justify-between border-b border-[#f0eae1] pb-2">
                          <div className="flex items-center gap-2">
                            <Users size={16} className="text-[#2d6a4f]" />
                            <span className="text-xs font-bold text-[#2c2523]">
                              人物关系图谱 ({currentStepInfo.artifact.graph.nodes.length} 角色 · {currentStepInfo.artifact.graph.edges.length} 条关系)
                            </span>
                          </div>
                        </div>

                        {/* Character Nodes Chips */}
                        <div className="flex flex-wrap gap-2">
                          {currentStepInfo.artifact.graph.nodes.map((node) => (
                            <div
                              key={node.id}
                              className="px-2.5 py-1.5 rounded-lg bg-[#f5efe6] border border-[#e5ddd3] text-xs flex items-center gap-1.5"
                            >
                              <span className="font-bold text-[#2c2523]">{node.name}</span>
                              <span className="text-[10px] text-[#7d6b59]">({node.role})</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-white">
                                权重 {node.weight}
                              </Badge>
                            </div>
                          ))}
                        </div>

                        {/* Relationships Table / List */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                          {currentStepInfo.artifact.graph.edges.map((edge, i) => {
                            const sourceNode = currentStepInfo.artifact!.graph!.nodes.find((n) => n.id === edge.source)
                            const targetNode = currentStepInfo.artifact!.graph!.nodes.find((n) => n.id === edge.target)
                            return (
                              <div
                                key={i}
                                className="p-2.5 rounded-lg border border-[#e5ddd3] bg-[#faf8f5] flex items-center justify-between text-xs"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-[#2c2523]">{sourceNode?.name || edge.source}</span>
                                  <ArrowRight size={12} className="text-[#baa997]" />
                                  <span className="font-semibold text-[#2c2523]">{targetNode?.name || edge.target}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[#2d6a4f] font-medium">{edge.label}</span>
                                  <span className="text-[10px] text-[#baa997]">[{edge.type} · 强度{edge.strength}]</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </Card>
                    )}

                    {/* Markdown Content Display */}
                    {currentStepInfo.artifact ? (
                      <div className="bg-white p-6 rounded-2xl border border-[#e5ddd3] shadow-sm">
                        <div className="prose prose-sm max-w-none text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap font-sans">
                          {currentStepInfo.artifact.content}
                        </div>
                      </div>
                    ) : currentStepInfo.step?.state === 'running' ? (
                      <div className="py-24 text-center text-xs text-[#7d6b59] flex flex-col items-center gap-3">
                        <Loader2 size={28} className="animate-spin text-[#2d6a4f]" />
                        <div className="font-medium text-sm text-[#2c2523]">正在调用大模型生成此步骤资料...</div>
                        <p className="text-[#baa997] max-w-md">
                          依据全书原文正文事实与已提炼的阶段账本，进行严格无幻觉提炼。步骤完成后将在此自动呈现。
                        </p>
                      </div>
                    ) : currentStepInfo.step?.state === 'failed' ? (
                      <div className="py-16 text-center text-xs text-red-600 flex flex-col items-center gap-3">
                        <XCircle size={28} className="text-red-500" />
                        <div className="font-medium text-sm text-[#2c2523]">此步骤执行失败</div>
                        <p className="text-red-500 max-w-md">{currentStepInfo.step.errorMessage || '模型调用发生异常或响应格式不符合规范'}</p>
                        {!isReadOnly && !isStale && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-button gap-1 mt-2"
                            disabled={actionLoading}
                            onClick={() => void handleRetryStep(currentStepInfo.plan.stepId)}
                          >
                            <RotateCw size={13} />
                            <span>重试此步骤</span>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="py-24 text-center text-xs text-[#baa997] flex flex-col items-center gap-2">
                        <FileText size={28} className="opacity-40" />
                        <div>等待前序依赖步骤完成</div>
                        <p className="text-[11px] max-w-md">全书总结遵循严格先后流转序列，待前序步骤产出后本步将自动开始。</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[#baa997]">
                请从左侧选择一个步骤以查看资料成果
              </div>
            )}
          </main>
        </div>

        {/* Outline Comparison Dialog Overlay */}
        {showOutlineComparison && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="flex flex-col w-[85vw] max-w-[85vw] h-[80vh] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-[#e5ddd3] overflow-hidden">
              <header className="dialog-header px-6 pt-5 pb-3 border-b border-[#e5ddd3] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <GitCompare size={18} className="text-[#2d6a4f]" />
                  <h3 className="text-sm font-bold text-[#2c2523]">全书大纲双栏对比与应用</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-button"
                    onClick={() => setShowOutlineComparison(false)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={applyingOutline || isReadOnly || isStale}
                    className="primary-button gap-1"
                    onClick={() => void handleApplyOutline()}
                  >
                    <Check size={14} />
                    <span>{applyingOutline ? '应用中...' : '应用为全书大纲草稿'}</span>
                  </Button>
                  <IconButton label="关闭" onClick={() => setShowOutlineComparison(false)}>
                    <X size={16} />
                  </IconButton>
                </div>
              </header>

              <div className="flex-1 grid grid-cols-2 min-h-0 divide-x divide-[#e5ddd3]">
                {/* Left: Current Outline */}
                <div className="flex flex-col min-h-0">
                  <div className="p-2.5 px-4 bg-[#fcf9f8] border-b border-[#e5ddd3] text-xs font-semibold text-[#7d6b59] flex items-center justify-between">
                    <span>当前项目全书大纲 {currentOutline ? `(版本 v${currentOutline.version} · ${currentOutline.state === 'confirmed' ? '已确认' : '草稿'})` : '(暂未创建大纲)'}</span>
                    {onOpenOutlineEditor && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] text-[#2d6a4f] p-1"
                        onClick={() => {
                          setShowOutlineComparison(false)
                          onOpenOutlineEditor()
                        }}
                      >
                        前往大纲编辑器
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="flex-1 p-4 bg-white">
                    {loadingOutline ? (
                      <div className="py-12 text-center text-xs text-[#baa997]">加载当前大纲中...</div>
                    ) : (
                      <pre className="text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap font-sans">
                        {currentOutline?.content || '（当前项目尚未保存全书大纲，应用后将创建全书大纲草稿）'}
                      </pre>
                    )}
                  </ScrollArea>
                </div>

                {/* Right: Summary Candidate Outline */}
                <div className="flex flex-col min-h-0 bg-[#faf8f5]">
                  <div className="p-2.5 px-4 bg-[#e8f3ee] border-b border-[#e5ddd3] text-xs font-semibold text-[#2d6a4f] flex items-center justify-between">
                    <span>全书总结提炼的候选大纲 (基于全书正文事实)</span>
                    <Badge variant="outline" className="text-[10px] bg-white text-[#2d6a4f]">
                      候选草稿
                    </Badge>
                  </div>
                  <ScrollArea className="flex-1 p-4">
                    <pre className="text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap font-sans">
                      {bookSummary?.outlineCandidate || '（暂无大纲候选）'}
                    </pre>
                  </ScrollArea>
                </div>
              </div>

              <footer className="dialog-footer px-6 py-2.5 bg-[#fcf9f8] border-t border-[#e5ddd3] text-[11px] text-[#7d6b59] flex items-center justify-between shrink-0">
                <span>
                  应用后将保存为全书大纲草稿 (`draft`)，并使用乐观锁校验版本。作者可在编辑器中再次修改并确认。
                </span>
                <span className="text-[#baa997]">版本冲突将自动终止覆盖，保障作者权威性</span>
              </footer>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
