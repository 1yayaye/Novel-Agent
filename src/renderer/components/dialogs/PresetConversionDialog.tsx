import React, { useState, useEffect, useRef, useCallback } from 'react'
import type {
  PresetConversionInspection,
  PresetConversionStatus,
  PresetConversionResult,
  NovelPromptPreset,
  PresetStoreData,
  ModelConnectionSummary
} from '../../../shared/project.js'
import { errorText } from '../../utils/formatters.js'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@appica/ui-react/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@appica/ui-react/tabs'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'
import {
  Sparkles,
  AlertCircle,
  FileCode,
  Layers,
  Cpu,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ArrowRight
} from 'lucide-react'
import { PresetConversionReportView } from './PresetConversionReportView.js'

export interface PresetConversionDialogProps {
  open: boolean
  onClose: () => void
  file: File | null
  sessionId?: string
  onImportSuccess: (savedStore: PresetStoreData) => void
}

type Phase = 'inspecting' | 'inspect_ready' | 'converting' | 'result_review' | 'failed' | 'cancelled'

const STATE_LABELS: Record<string, { label: string; desc: string }> = {
  queued: { label: '排队等待', desc: '任务已加入模型队列，等待调度' },
  analyzing: { label: '来源分析', desc: '分批分析酒馆提示词、脚本、正则与扩展' },
  summarizing: { label: '摘要整合', desc: '跨条目语义递归整合与全局关系分析' },
  converting: { label: '静态转换', desc: '转换为创作提示词块与资料插槽' },
  validating: { label: '编译校验', desc: '校验创作任务协议与提示词编译有效性' },
  ready: { label: '转换就绪', desc: '转换完成，等待人工审阅与确认' },
  failed: { label: '转换失败', desc: '转换过程发生错误' },
  cancelled: { label: '已取消', desc: '任务已被用户中止' }
}

export function PresetConversionDialog({
  open,
  onClose,
  file,
  sessionId,
  onImportSuccess
}: PresetConversionDialogProps) {
  const [phase, setPhase] = useState<Phase>('inspecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [jsonContent, setJsonContent] = useState('')

  // 检查与连接信息
  const [inspection, setInspection] = useState<PresetConversionInspection | null>(null)
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')

  // 任务进度
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<PresetConversionStatus | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // 结果审阅
  const [conversionResult, setConversionResult] = useState<PresetConversionResult | null>(null)
  const [finalPresetName, setFinalPresetName] = useState('')
  const [finalPresetDescription, setFinalPresetDescription] = useState('')
  const [selectedBlocks, setSelectedBlocks] = useState<Record<string, boolean>>({})
  const [expandedContent, setExpandedContent] = useState<Record<string, boolean>>({})
  const [activeReviewTab, setActiveReviewTab] = useState<'blocks' | 'report'>('blocks')
  const [saving, setSaving] = useState(false)

  // 进度订阅清理
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const cleanupSubscription = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupSubscription()
    }
  }, [cleanupSubscription])

  // 本地检查流程
  const runInspection = useCallback(async (content: string, fileName: string, connectionIdOverride?: string) => {
    setPhase('inspecting')
    setErrorMessage('')
    try {
      const inspectRes = await window.novelAgent.prompt.inspectPresetConversion({
        jsonContent: content,
        fileName,
        sessionId,
        connectionId: connectionIdOverride || undefined
      })
      setInspection(inspectRes)
      if (inspectRes.connection) {
        setSelectedConnectionId(inspectRes.connection.id)
      }
      setPhase('inspect_ready')
    } catch (err) {
      setErrorMessage(errorText(err, '检查预设文件失败'))
      setPhase('failed')
    }
  }, [sessionId])

  // 打开弹窗初始读取
  useEffect(() => {
    if (!open || !file) return
    let active = true

    const init = async () => {
      try {
        const text = await file.text()
        if (!active) return
        setJsonContent(text)

        // 读取可用的生成连接列表
        try {
          const list = await window.novelAgent.connection.list({ kind: 'generation' })
          if (active) setConnections(list)
        } catch {
          // 容错处理
        }

        if (active) {
          await runInspection(text, file.name)
        }
      } catch (err) {
        if (active) {
          setErrorMessage(errorText(err, '读取预设文件内容失败'))
          setPhase('failed')
        }
      }
    }

    void init()

    return () => {
      active = false
    }
  }, [open, file, runInspection])

  // 切换连接时重新检查
  const handleConnectionChange = (connId: string) => {
    setSelectedConnectionId(connId)
    if (file && jsonContent) {
      void runInspection(jsonContent, file.name, connId)
    }
  }

  // 开始转换
  const handleStartConversion = async () => {
    if (!file || !jsonContent) return
    setPhase('converting')
    setErrorMessage('')
    setCancelling(false)
    cleanupSubscription()

    try {
      // 在开始前建立进度事件订阅
      let currentTaskId: string | null = null
      const bufferedStatuses: PresetConversionStatus[] = []

      unsubscribeRef.current = window.novelAgent.prompt.onPresetConversionProgress((status) => {
        if (currentTaskId) {
          if (status.taskId === currentTaskId) {
            handleStatusProgress(status)
          }
        } else {
          bufferedStatuses.push(status)
        }
      })

      const res = await window.novelAgent.prompt.startPresetConversion({
        jsonContent,
        fileName: file.name,
        sessionId,
        connectionId: selectedConnectionId || undefined
      })

      currentTaskId = res.taskId
      setTaskId(res.taskId)

      // 处理在启动期间收到的当前任务事件
      const matchingBuffered = bufferedStatuses.filter((s) => s.taskId === res.taskId)
      if (matchingBuffered.length > 0) {
        handleStatusProgress(matchingBuffered[matchingBuffered.length - 1])
      } else {
        // 收到 taskId 后立即查询当前状态以补偿事件时序
        const initialStatus = await window.novelAgent.prompt.getPresetConversionStatus({ taskId: res.taskId })
        handleStatusProgress(initialStatus)
      }
    } catch (err) {
      cleanupSubscription()
      setErrorMessage(errorText(err, '启动转换任务失败'))
      setPhase('failed')
    }
  }

  // 状态推进处理
  const handleStatusProgress = (status: PresetConversionStatus) => {
    setTaskStatus(status)

    if (status.state === 'ready') {
      cleanupSubscription()
      void loadConversionResult(status.taskId)
    } else if (status.state === 'failed') {
      cleanupSubscription()
      setErrorMessage(status.error?.message || '预设转换失败')
      setPhase('failed')
    } else if (status.state === 'cancelled') {
      cleanupSubscription()
      setPhase('cancelled')
    }
  }

  // 读取就绪结果
  const loadConversionResult = async (readyTaskId: string) => {
    try {
      const result = await window.novelAgent.prompt.getPresetConversionResult({ taskId: readyTaskId })
      setConversionResult(result)
      setFinalPresetName(result.preset.name)
      setFinalPresetDescription(result.preset.description || '')

      const blockSelection: Record<string, boolean> = {}
      result.preset.blocks.forEach((b) => {
        blockSelection[b.id] = b.enabled
      })
      setSelectedBlocks(blockSelection)
      setActiveReviewTab('blocks')
      setPhase('result_review')
    } catch (err) {
      setErrorMessage(errorText(err, '读取转换结果失败'))
      setPhase('failed')
    }
  }

  // 取消转换
  const handleCancelTask = async () => {
    if (!taskId || cancelling) return
    setCancelling(true)
    try {
      await window.novelAgent.prompt.cancelPresetConversion({ taskId })
    } catch (err) {
      setErrorMessage(errorText(err, '取消任务失败'))
    }
  }

  // 保存确认
  const handleConfirmSave = async (activate: boolean) => {
    if (!conversionResult || saving) return
    setSaving(true)
    setErrorMessage('')
    try {
      const latest = await window.novelAgent.prompt.getPresetStore()
      const finalizedPreset: NovelPromptPreset = {
        ...conversionResult.preset,
        name: finalPresetName.trim() || conversionResult.preset.name,
        description: finalPresetDescription.trim() || conversionResult.preset.description,
        blocks: conversionResult.preset.blocks.map((b) => ({
          ...b,
          enabled: selectedBlocks[b.id] ?? b.enabled
        }))
      }

      const saveResult = await window.novelAgent.prompt.savePresetStore({
        activePresetId: activate ? finalizedPreset.id : latest.store.activePresetId,
        presets: [...latest.store.presets, finalizedPreset]
      })

      onImportSuccess(saveResult.store)
      onClose()
    } catch (err) {
      setErrorMessage(errorText(err, '保存到预设库失败'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <Dialog open onOpenChange={(val) => { if (!val && phase !== 'converting') onClose() }}>
      <DialogContent
        frame={false}
        closeLabel="关闭"
        className="flex flex-col w-[92vw] max-w-4xl h-[88vh] overflow-hidden bg-[#faf8f5] text-[#2c2523] border border-[#dacdbe] rounded-2xl shadow-2xl"
      >
        <DialogHeader className="px-5 py-3.5 border-b border-[#e5ddd3] bg-[#f7f2ea]">
          <DialogTitle className="text-base font-bold text-[#2c2523] flex items-center gap-2">
            <Sparkles size={16} className="text-[#2d6a4f]" />
            <span>预设导入与转换</span>
            {file && <span className="text-xs font-normal text-[#7d6b59]">（{file.name}）</span>}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#7d6b59] mt-0.5">
            解析来源条目，由 AI 模型分批分析并转换为小说静态提示词块与插槽，审阅确认后保存。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
          {/* 阶段 1：检查中 */}
          {phase === 'inspecting' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
              <Loader2 size={32} className="animate-spin text-[#2d6a4f]" />
              <p className="text-xs font-medium text-[#54473b]">正在进行本地格式检查与条目解析...</p>
              <p className="text-[11px] text-[#7d6b59]">不调用远程模型，不保存原文件</p>
            </div>
          )}

          {/* 阶段 2：检查就绪 */}
          {phase === 'inspect_ready' && inspection && (
            <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-y-auto pr-1">
              {/* 原生格式提示 */}
              {inspection.format === 'novel' ? (
                <Card className="p-4 bg-emerald-50/70 border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                    <CheckCircle2 size={16} className="text-[#2d6a4f]" />
                    <span>检测为本项目原生预设 (Novel Format)</span>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    该文件结构完全符合规范，无需调用 AI 模型或消耗 Token。导入后将自动生成独立预设 ID 并保留全部块定义。
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-emerald-800 pt-1 font-mono">
                    <span>预设名称：{inspection.name}</span>
                    <span>字符数：{inspection.sourceCharacters.toLocaleString()}</span>
                  </div>
                </Card>
              ) : (
                <>
                  {/* 酒馆格式分析卡片 */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
                      <span className="text-[11px] text-[#7d6b59]">格式识别</span>
                      <span className="text-xs font-bold text-[#2c2523]">酒馆预设 (Tavern)</span>
                      <span className="text-[10px] text-[#7d6b59] font-mono mt-0.5 truncate">
                        {inspection.items.length} 个来源条目
                      </span>
                    </Card>

                    <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
                      <span className="text-[11px] text-[#7d6b59]">字符总数</span>
                      <span className="text-xs font-bold text-[#2c2523]">
                        {inspection.sourceCharacters.toLocaleString()} 字
                      </span>
                      <span className="text-[10px] text-[#7d6b59] mt-0.5">UTF-16 长度</span>
                    </Card>

                    <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
                      <span className="text-[11px] text-[#7d6b59]">估算来源 Token</span>
                      <span className="text-xs font-bold text-[#2c2523]">
                        {inspection.estimatedSourceTokens ? `${inspection.estimatedSourceTokens.toLocaleString()} 约` : '待计算'}
                      </span>
                      <span className="text-[10px] text-[#7d6b59] mt-0.5">仅含来源文本</span>
                    </Card>

                    <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
                      <span className="text-[11px] text-[#7d6b59]">初始分析批次</span>
                      <span className="text-xs font-bold text-[#2c2523]">
                        {inspection.initialAnalysisBatches ?? 1} 批
                      </span>
                      <span className="text-[10px] text-[#7d6b59] mt-0.5">按模型上下文切分</span>
                    </Card>
                  </div>

                  {/* 模型连接选择 */}
                  <Card className="p-3.5 bg-white border-[#dacdbe] rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2c2523]">
                        <Cpu size={14} className="text-[#2d6a4f]" />
                        <span>转换使用的生成模型连接</span>
                      </div>
                      {inspection.connection && (
                        <span className="text-[10px] font-mono text-[#7d6b59]">
                          当前已解析：{inspection.connection.name} ({inspection.connection.model})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        value={selectedConnectionId}
                        onValueChange={(val: any) => handleConnectionChange(String(val))}
                      >
                        <SelectTrigger className="w-full text-xs border-[#dacdbe] bg-white">
                          <SelectValue placeholder="请选择用于转换的生成模型连接..." />
                        </SelectTrigger>
                        <SelectContent>
                          {connections.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} — {c.model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {!selectedConnectionId && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
                        <AlertCircle size={13} className="shrink-0" />
                        <span>未找到可用的文本生成连接，请选择或在连接管理中添加生成模型连接。</span>
                      </div>
                    )}
                  </Card>

                  {/* 来源条目分类预览 */}
                  <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
                    <span className="text-xs font-semibold text-[#2c2523]">包含的来源条目清单 ({inspection.items.length})：</span>
                    <ScrollArea className="h-44 sm:h-52 pr-2 border border-[#e5ddd3] rounded-lg bg-white p-2">
                      <div className="space-y-1.5">
                        {inspection.items.map((item) => (
                          <div
                            key={item.sourceId}
                            className="flex items-center justify-between gap-2 p-1.5 rounded bg-[#faf8f5] text-[11px]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {item.kind}
                              </Badge>
                              <span className="font-medium text-[#2c2523] truncate">{item.name || '(无名称)'}</span>
                              <span className="text-[10px] font-mono text-[#7d6b59] truncate">{item.path}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 text-[10px] text-[#7d6b59]">
                              <span>{item.characters} 字符</span>
                              {item.enabled !== null && (
                                <span className={item.enabled ? 'text-emerald-700' : 'text-stone-400'}>
                                  {item.enabled ? '已启用' : '已停用'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}

              {/* 警告信息 */}
              {inspection.warnings.length > 0 && (
                <div className="space-y-1">
                  {inspection.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 p-2 rounded bg-amber-50 text-amber-800 text-[11px] border border-amber-200">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 阶段 3：转换中 */}
          {phase === 'converting' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-[#2d6a4f] flex items-center justify-center shadow-xs">
                <Loader2 size={32} className="animate-spin" />
              </div>

              <div className="text-center space-y-1 max-w-md">
                <div className="flex items-center justify-center gap-2">
                  <Badge className="bg-[#2d6a4f] text-white text-xs">
                    {STATE_LABELS[taskStatus?.state || 'analyzing']?.label || taskStatus?.state}
                  </Badge>
                  <span className="text-sm font-bold text-[#2c2523]">{taskStatus?.name || '预设转换'}</span>
                </div>
                <p className="text-xs text-[#7d6b59]">
                  {STATE_LABELS[taskStatus?.state || 'analyzing']?.desc || '正在进行模型结构化转换与校验...'}
                </p>
              </div>

              {/* 批次与进度数据 */}
              {taskStatus && (
                <Card className="w-full max-w-md p-4 bg-white border-[#dacdbe] rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#7d6b59]">已完成逻辑批次</span>
                    <span className="font-semibold text-[#2c2523]">
                      {taskStatus.completedBatches} / {taskStatus.totalBatches} 批
                    </span>
                  </div>

                  <div className="w-full bg-[#f0eae1] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#2d6a4f] h-full transition-all duration-300"
                      style={{
                        width: taskStatus.totalBatches > 0
                          ? `${Math.min(100, Math.round((taskStatus.completedBatches / taskStatus.totalBatches) * 100))}%`
                          : '15%'
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#f0eae1] text-[11px] text-[#7d6b59]">
                    <div>
                      <span>输入 Token：</span>
                      <span className="font-mono text-[#2c2523]">{taskStatus.usage.promptTokens.toLocaleString()}</span>
                    </div>
                    <div>
                      <span>输出 Token：</span>
                      <span className="font-mono text-[#2c2523]">{taskStatus.usage.completionTokens.toLocaleString()}</span>
                    </div>
                  </div>
                </Card>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCancelTask()}
                disabled={cancelling}
                className="text-xs border-red-200 text-red-700 hover:bg-red-50"
              >
                {cancelling ? '正在中止任务...' : '取消转换任务'}
              </Button>
            </div>
          )}

          {/* 阶段 4：审阅就绪 */}
          {phase === 'result_review' && conversionResult && (
            <div className="flex-1 min-h-0 flex flex-col space-y-3">
              {/* 预设基础名称与描述 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#2c2523]">预设名称</label>
                  <Input
                    value={finalPresetName}
                    onChange={(e) => setFinalPresetName(e.target.value)}
                    className="text-xs border-[#dacdbe] bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#2c2523]">描述说明</label>
                  <Input
                    value={finalPresetDescription}
                    onChange={(e) => setFinalPresetDescription(e.target.value)}
                    placeholder="自定义预设说明..."
                    className="text-xs border-[#dacdbe] bg-white"
                  />
                </div>
              </div>

              {/* 警告列表 */}
              {conversionResult.warnings.length > 0 && (
                <div className="space-y-1">
                  {conversionResult.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 p-2 rounded bg-amber-50 text-amber-800 text-[11px] border border-amber-200">
                      <AlertCircle size={13} className="shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 审阅 Tabs */}
              <Tabs value={activeReviewTab} onValueChange={(val: any) => setActiveReviewTab(val)} className="flex-1 min-h-0 flex flex-col">
                <TabsList className="bg-[#f0eae1] p-1 border border-[#dacdbe] rounded-lg w-fit">
                  <TabsTrigger value="blocks" className="text-xs">
                    生成 Block 列表 ({conversionResult.preset.blocks.length})
                  </TabsTrigger>
                  <TabsTrigger value="report" className="text-xs">
                    AI 兼容报告 {conversionResult.preset.conversionReport ? `(${conversionResult.preset.conversionReport.items.length} 条目)` : '(原生)'}
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: Block 列表 */}
                <TabsContent value="blocks" className="flex-1 min-h-0 pt-2 flex flex-col">
                  <ScrollArea className="flex-1 min-h-0 pr-2">
                    <div className="space-y-2 pb-2">
                      {conversionResult.preset.blocks.map((block) => {
                        const isExpanded = Boolean(expandedContent[block.id])
                        return (
                          <Card key={block.id} className="p-3 rounded-lg border-[#dacdbe] bg-white space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-2 cursor-pointer min-w-0">
                                <input
                                  type="checkbox"
                                  checked={selectedBlocks[block.id] ?? block.enabled}
                                  onChange={(e) => setSelectedBlocks((prev) => ({ ...prev, [block.id]: e.target.checked }))}
                                  className="h-4 w-4 accent-[#2d6a4f]"
                                />
                                <span className="text-xs font-semibold text-[#2c2523] truncate">{block.name}</span>
                              </label>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge variant="outline" className="text-[10px]">
                                  {block.role}
                                </Badge>
                                {block.position === 'in_chat' ? (
                                  <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">
                                    In-Chat (Depth {block.depth})
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">相对顺序</Badge>
                                )}
                                {block.marker && (
                                  <Badge variant="outline" className="text-[10px] border-[#2d6a4f]/30 text-[#2d6a4f] bg-emerald-50">
                                    {block.marker}
                                  </Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setExpandedContent((prev) => ({ ...prev, [block.id]: !isExpanded }))}
                                  className="h-6 px-1.5 text-[10px] text-[#7d6b59]"
                                >
                                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  <span>{isExpanded ? '收起' : '展开内容'}</span>
                                </Button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="text-[11px] font-mono text-[#54473b] bg-[#faf8f5] p-2.5 rounded border border-[#e5ddd3] max-h-40 overflow-y-auto whitespace-pre-wrap">
                                {block.content || <span className="text-stone-400 italic">（动态插槽或无固定静态内容）</span>}
                              </div>
                            )}
                          </Card>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Tab 2: 兼容报告 */}
                <TabsContent value="report" className="flex-1 min-h-0 pt-2 flex flex-col">
                  {conversionResult.preset.conversionReport ? (
                    <PresetConversionReportView
                      report={conversionResult.preset.conversionReport}
                      className="flex-1 min-h-0 flex flex-col"
                    />
                  ) : (
                    <div className="p-8 text-center text-[#7d6b59] bg-white rounded-xl border border-[#e5ddd3]">
                      本项目原生格式导入，未调用 AI 模型，无需兼容处置报告。
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* 阶段 5：失败 */}
          {phase === 'failed' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                <XCircle size={24} />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-sm font-bold text-[#2c2523]">预设检查或转换发生错误</h3>
                <p className="text-xs text-red-600 max-w-md mx-auto leading-relaxed">{errorMessage}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (file && jsonContent) {
                      void runInspection(jsonContent, file.name, selectedConnectionId)
                    }
                  }}
                  className="text-xs border-[#dacdbe]"
                >
                  <RefreshCw size={13} className="mr-1.5" />重新检查
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
                  关闭
                </Button>
              </div>
            </div>
          )}

          {/* 阶段 6：已取消 */}
          {phase === 'cancelled' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
              <div className="w-12 h-12 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center">
                <ShieldAlert size={24} />
              </div>
              <h3 className="text-sm font-bold text-[#2c2523]">转换已取消</h3>
              <p className="text-xs text-[#7d6b59]">任务已中止，未对应用预设库做任何修改。</p>
              <Button size="sm" onClick={onClose} className="text-xs mt-2 bg-[#2d6a4f] text-white">
                关闭
              </Button>
            </div>
          )}
        </div>

        {/* 底部操作条 */}
        <DialogFooter className="px-5 py-3 border-t border-[#e5ddd3] bg-[#f7f2ea] flex items-center justify-between">
          <div className="text-[11px] text-[#7d6b59]">
            {phase === 'inspect_ready' && '确认所选模型连接与条目后即可启动分批转换'}
            {phase === 'converting' && '模型正在后台进行结构化转换，您可以随时取消'}
            {phase === 'result_review' && '审阅 Block 与兼容处置结论后，选择保存方式'}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={phase === 'converting' || saving}
              className="text-xs"
            >
              取消
            </Button>

            {phase === 'inspect_ready' && (
              <Button
                size="sm"
                onClick={() => void handleStartConversion()}
                disabled={inspection?.format === 'tavern' && !selectedConnectionId}
                className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
              >
                {inspection?.format === 'novel' ? '直接导入预设' : '开始 AI 转换'}
                <ArrowRight size={13} className="ml-1" />
              </Button>
            )}

            {phase === 'result_review' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleConfirmSave(false)}
                  disabled={saving}
                  className="text-xs border-[#dacdbe]"
                >
                  保存到预设库
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleConfirmSave(true)}
                  disabled={saving}
                  className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
                >
                  {saving ? '正在保存...' : '保存并设为当前活跃预设'}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
