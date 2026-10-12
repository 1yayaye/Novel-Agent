import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertTriangle, Copy, Eye, RotateCw, Sparkles, Sliders } from 'lucide-react'
import {
  ChapterHeader,
  ChatWorkflowStage,
  ChatWorkflowType,
  ContextPackage,
  ContextPreviewInput,
  InstructionPreset,
  ModelConnectionSummary,
  StyleSample,
  TaskType
} from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@appica/ui-react/tabs'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { Checkbox } from '@appica/ui-react/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

const CREATIVITY_DESCRIPTIONS = {
  low: '保守承接：优先既有事实与直接因果，少量局部拓展。',
  medium: '适度拓展：在人物、设定与任务范围内探索合理变化。',
  high: '积极探索：尝试更多局部表达和发展可能，保留事实与任务边界。'
}

const EXCLUSION_REASONS = {
  budget_exceeded: '超出输入预算',
  conflict: '与当前资料冲突',
  stale: '资料版本已过时',
  invalid_source: '来源无效'
}

export function ContextPreviewDialog({
  sessionId,
  chapters,
  currentChapterId,
  initialTaskType = 'continue',
  initialStage,
  initialWorkflowType,
  initialOutlineId,
  initialOutlineVersion,
  initialTarget,
  initialInstruction,
  initialConnectionId,
  contextPackageId,
  chatSessionId,
  onClose,
  onStartCreation,
  onOpenConnections,
  onOpenCreativeSettings
}: {
  sessionId: string
  chapters: ChapterHeader[]
  currentChapterId?: string
  initialTaskType?: TaskType
  initialStage?: ChatWorkflowStage
  initialWorkflowType?: ChatWorkflowType
  initialOutlineId?: string
  initialOutlineVersion?: number
  initialTarget?: NonNullable<ContextPreviewInput['target']>
  initialInstruction?: string
  initialConnectionId?: string
  contextPackageId?: string
  chatSessionId?: string
  onClose: () => void
  onStartCreation?: (contextPackageId: string, taskType: TaskType) => void | Promise<void>
  onOpenConnections?: () => void
  onOpenCreativeSettings?: () => void
}) {
  const [taskType, setTaskType] = useState<TaskType>(initialTaskType)
  const [targetChapterId, setTargetChapterId] = useState<string>(initialTarget?.chapterId || currentChapterId || (chapters[0]?.id ?? ''))
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState(initialConnectionId || '')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [styleSamples, setStyleSamples] = useState<StyleSample[]>([])
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([])
  const [includeCreativeRules, setIncludeCreativeRules] = useState(true)
  const [targetLength, setTargetLength] = useState<number>(1000)
  const [creativity, setCreativity] = useState<'low' | 'medium' | 'high'>('medium')
  const [instruction, setInstruction] = useState(initialInstruction || '')
  const [previewing, setPreviewing] = useState(false)
  const [startingCreation, setStartingCreation] = useState(false)
  const [contextPackage, setContextPackage] = useState<ContextPackage | null>(null)
  const [activeTab, setActiveTab] = useState<'items' | 'messages'>('messages')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const previewInputKey = JSON.stringify({ sessionId, selectedConnectionId, taskType, initialStage, initialWorkflowType, initialOutlineId, initialOutlineVersion, initialTarget, chatSessionId, targetChapterId, instruction, selectedPresetId, selectedStyleIds, includeCreativeRules, targetLength, creativity })
  const latestPreviewInputKey = useRef(previewInputKey)
  latestPreviewInputKey.current = previewInputKey

  useEffect(() => { if (!contextPackageId) setContextPackage(null) }, [previewInputKey, contextPackageId])

  useEffect(() => {
    if (!contextPackageId) return
    let current = true
    setPreviewing(true)
    setError('')
    void window.novelAgent.context.get({ sessionId, contextPackageId })
      .then((stored) => { if (current) setContextPackage(stored) })
      .catch((err) => { if (current) setError(errorText(err, '加载历史上下文包失败')) })
      .finally(() => { if (current) setPreviewing(false) })
    return () => { current = false }
  }, [sessionId, contextPackageId])

  const handleGeneratePreview = useCallback(async () => {
    const connId = selectedConnectionId
    if (!connId) {
      setError('请选择模型连接')
      return
    }

    setPreviewing(true)
    setContextPackage(null)
    setError('')
    const requestedInputKey = previewInputKey
    try {
      const pkg = await window.novelAgent.context.preview({
        sessionId,
        connectionId: connId,
        taskType,
        stage: initialStage,
        workflowType: initialWorkflowType,
        outlineId: initialOutlineId,
        outlineVersion: initialOutlineVersion,
        chatSessionId,
        target: targetChapterId ? { ...(initialTarget?.chapterId === targetChapterId ? initialTarget : {}), chapterId: targetChapterId, chatId: chatSessionId || initialTarget?.chatId } : undefined,
        instruction,
        presetId: selectedPresetId || undefined,
        styleSampleIds: selectedStyleIds.length > 0 ? selectedStyleIds : undefined,
        includeCreativeRules,
        targetLength: targetLength > 0 ? targetLength : undefined,
        creativity
      })
      if (latestPreviewInputKey.current === requestedInputKey) setContextPackage(pkg)
    } catch (err) {
      if (latestPreviewInputKey.current === requestedInputKey) setError(errorText(err, '生成上下文装配预览失败'))
    } finally {
      setPreviewing(false)
    }
  }, [sessionId, selectedConnectionId, taskType, initialStage, initialWorkflowType, initialOutlineId, initialOutlineVersion, initialTarget, chatSessionId, targetChapterId, instruction, selectedPresetId, selectedStyleIds, includeCreativeRules, targetLength, creativity, previewInputKey])

  const handleStartCreation = async () => {
    if (!contextPackage || !onStartCreation || startingCreation) return
    setStartingCreation(true)
    setError('')
    try {
      await onStartCreation(contextPackage.id, contextPackage.taskType)
    } catch (err) {
      setError(errorText(err, '启动正文候选生成失败，请重新生成预览后重试'))
    } finally {
      setStartingCreation(false)
    }
  }

  const loadDependencies = useCallback(async () => {
    try {
      const [connList, presetList, sampleList] = await Promise.all([
        window.novelAgent.connection.list({ kind: 'generation' }),
        window.novelAgent.preset.list({ sessionId }),
        window.novelAgent.styleSample.list({ sessionId })
      ])
      setConnections(connList)
      setSelectedConnectionId((current) => connList.some((connection) => connection.id === current) ? current : connList[0]?.id ?? '')
      setPresets(presetList)
      setStyleSamples(sampleList)
    } catch (err) {
      setError(errorText(err, '加载预览所需资料失败'))
    }
  }, [sessionId])

  useEffect(() => {
    if (!contextPackageId) void loadDependencies()
  }, [loadDependencies, contextPackageId])

  const handleCopyText = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleStyleSample = (id: string) => {
    setSelectedStyleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const tokenUsagePercent = contextPackage
    ? Math.min(
        100,
        Math.round(
          (contextPackage.estimatedInputTokens /
            Math.max(1, contextPackage.availableInputTokens)) *
            100
        )
      )
    : 0
  const effectiveTemplates = contextPackage?.items.filter((item) => item.sourceType === 'system_template') ?? []
  const activePresetName = contextPackage?.promptSnapshot.activePreset?.name ?? '无活跃预设（默认回退）'
  const snapshotBudget = contextPackage?.promptSnapshot.budget

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col w-[90vw] max-w-[90vw] h-[90vh]" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>{contextPackageId ? '历史上下文消息与冻结预算' : '上下文装配预览与 Token 预算'}</DialogTitle>
          <DialogDescription>
            查看本次请求的实际消息、生效模块、冻结预算与资料裁剪说明。
          </DialogDescription>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        <div className="flex flex-1 gap-5 overflow-hidden border-t border-[#e5ddd3] pt-3 px-6">
          {/* Controls Left Column */}
          {!contextPackageId && <div className="flex w-80 flex-col gap-3 border-r border-[#e5ddd3] pr-4 shrink-0">
            <ScrollArea className="flex-1 pr-2">
              <div className="flex flex-col gap-3 p-1 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#7d6b59]">任务类型</label>
                  <Select
                    value={taskType}
                    onValueChange={(val) => setTaskType(val as TaskType)}
                  >
                    <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="continue">正文续写 (continue)</SelectItem>
                      <SelectItem value="rewrite">选区重写 (rewrite)</SelectItem>
                      <SelectItem value="polish">文字润色 (polish)</SelectItem>
                      <SelectItem value="chat">项目问答 (chat)</SelectItem>
                      <SelectItem value="knowledge">知识提取 (knowledge)</SelectItem>
                      <SelectItem value="report">文学报告 (report)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#7d6b59]">目标章节</label>
                  <Select
                    value={targetChapterId}
                    disabled={initialWorkflowType === 'creation_workflow'}
                    onValueChange={(val) => setTargetChapterId(val as string)}
                  >
                    <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c, index) => {
                        const chapterNumber = getChapterNumber(chapters, index)
                        return (
                          <SelectItem key={c.id} value={c.id}>
                            {chapterNumber === undefined ? '' : `${chapterNumber}. `}
                            {c.title} (v{c.version})
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#7d6b59]">模型连接</label>
                  {connections.length === 0 ? (
                    <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>未检测到生成模型</span>
                      </div>
                      <span className="text-[11px] text-amber-700">
                        请先配置模型连接以启用装配与候选生成。
                      </span>
                      {onOpenConnections && (
                        <Button
                          size="sm"
                          className="h-6 text-[11px] self-start"
                          onClick={onOpenConnections}
                        >
                          前往配置模型
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Select
                      value={selectedConnectionId}
                      onValueChange={(val) => setSelectedConnectionId(val as string)}
                    >
                      <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {connections.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.model})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#7d6b59]">指令预设 (可选)</label>
                  <Select
                    value={selectedPresetId || 'none'}
                    onValueChange={(val) => setSelectedPresetId(val === 'none' ? '' : (val as string))}
                  >
                    <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">(不使用预设)</SelectItem>
                      {presets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.taskType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {styleSamples.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#7d6b59]">
                      参考文风样本 ({selectedStyleIds.length})
                    </label>
                    <div className="flex max-h-24 flex-col gap-1 overflow-y-auto rounded-lg border border-[#dacdbe] bg-white p-2">
                      {styleSamples.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#2c2523]"
                        >
                          <Checkbox
                            checked={selectedStyleIds.includes(s.id)}
                            onCheckedChange={() => toggleStyleSample(s.id)}
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#7d6b59]">目标字数</label>
                    <Input
                      type="number"
                      className="rounded-lg border border-[#dacdbe] bg-white px-2.5 py-1 text-xs text-[#2c2523] outline-none"
                      value={targetLength}
                      onChange={(e) => setTargetLength(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#7d6b59]">创意倾向</label>
                    <Select
                      value={creativity}
                      onValueChange={(val) => setCreativity(val as typeof creativity)}
                    >
                      <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-2 py-1 text-xs text-[#2c2523] outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">保守承接</SelectItem>
                        <SelectItem value="medium">适度拓展</SelectItem>
                        <SelectItem value="high">积极探索</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-[#7d6b59]">{CREATIVITY_DESCRIPTIONS[creativity]} 该选择通过任务指令控制局部拓展程度。</p>

                <label className="flex items-center gap-2 cursor-pointer font-medium text-[#2c2523]">
                  <Checkbox
                    checked={includeCreativeRules}
                    onCheckedChange={(checked) => setIncludeCreativeRules(Boolean(checked))}
                  />
                  <span>使用本作品创作规则</span>
                </label>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#7d6b59]">本次任务指令</label>
                  <Textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="输入对 AI 的具体写作要求..."
                    rows={3}
                    className="resize-none rounded-lg border border-[#dacdbe] bg-white p-2 text-xs text-[#2c2523] outline-none focus:border-[#2d6a4f]"
                  />
                </div>
              </div>
            </ScrollArea>

            <Button
              disabled={previewing || startingCreation || !selectedConnectionId}
              onClick={() => void handleGeneratePreview()}
              className="w-full justify-center shrink-0"
            >
              {previewing ? (
                <RotateCw className="animate-spin" size={14} />
              ) : (
                <Eye size={14} />
              )}
              {previewing ? '装配中...' : '生成装配预览'}
            </Button>
          </div>}

          {/* Result Right Column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!contextPackage ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[#7d6b59]">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#efe6da] text-[#2d6a4f]">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#2c2523] mb-1">{contextPackageId ? '正在读取历史上下文包' : '尚未生成装配预览'}</h3>
                  <p className="max-w-xs text-xs text-[#7d6b59] leading-relaxed">
                    {contextPackageId ? '显示该次请求保存的消息与配置，不会重新装配历史请求。' : '在左侧配置任务目标、参数与模型，点击「生成装配预览」查看实际消息与预算。修改任务参数后，需要重新生成预览。'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden gap-3">
                {/* Token Budget Meter */}
                <Card className="flex flex-col gap-2 p-3 bg-white border-[#e5ddd3] shrink-0 text-xs max-h-[26vh] overflow-auto">
                  <div className="flex items-center justify-between">
                    <span>
                      Token 预算消耗：
                      <strong className="text-[#2c2523]">
                        {contextPackage.estimatedInputTokens.toLocaleString()}
                      </strong>{' '}
                      / {contextPackage.availableInputTokens.toLocaleString()} Tokens
                    </span>
                    <span
                      className={`font-bold ${
                        tokenUsagePercent > 90
                          ? 'text-red-600'
                          : tokenUsagePercent > 75
                          ? 'text-amber-600'
                          : 'text-[#2d6a4f]'
                      }`}
                    >
                      {tokenUsagePercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#efe6da]">
                    <div
                      className={`h-full transition-all ${
                        tokenUsagePercent > 90
                          ? 'bg-red-500'
                          : tokenUsagePercent > 75
                          ? 'bg-amber-500'
                          : 'bg-[#2d6a4f]'
                      }`}
                      style={{ width: `${tokenUsagePercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#7d6b59]">
                    <span>包含 {contextPackage.items.length} 个上下文条目</span>
                    {contextPackage.excludedItems.length > 0 && (
                      <span className="font-semibold text-red-600">
                        已排除 {contextPackage.excludedItems.length} 个参考条目
                      </span>
                    )}
                    <span>
                      指纹:{' '}
                      <code className="font-mono text-[10px] text-[#54473b]">
                        {contextPackage.configurationFingerprint}
                      </code>
                    </span>
                  </div>
                  <div className="space-y-1.5 border-t border-[#e5ddd3] pt-2 text-[11px] text-[#7d6b59]">
                    <p className="flex flex-wrap gap-1.5 items-center"><strong className="text-[#2c2523]">提示词模板条目：</strong>{effectiveTemplates.length > 0 ? effectiveTemplates.map((item) => <Badge key={item.sourceId} variant="outline" className="text-[10px] border-[#dacdbe]" title={item.sourceId}>{item.title || item.sourceId}</Badge>) : <span>当前任务无注入模板</span>}</p>
                    <p>当前活跃预设：{activePresetName}。后台分析任务按严格 JSON 协议执行，创作类任务由预设接管。</p>
                    {contextPackage.creativity && <p>本次创意倾向：{CREATIVITY_DESCRIPTIONS[contextPackage.creativity.level]}</p>}
                    {snapshotBudget && <p>冻结预算：上下文窗口 {snapshotBudget.contextWindow.toLocaleString()} · 输出上限 {snapshotBudget.maxOutputTokens.toLocaleString()} · 安全余量 {Math.round(snapshotBudget.safetyMarginRatio * 100)}% · 估算系数 {snapshotBudget.tokenEstimationRatio} · 连接版本 v{snapshotBudget.connectionVersion}</p>}
                  </div>
                </Card>

                {contextPackage.warnings.length > 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 shrink-0">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>{contextPackage.warnings.join('；')}</span>
                  </div>
                )}

                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setActiveTab(v as typeof activeTab)}
                  className="flex flex-1 min-h-0 flex-col overflow-hidden"
                >
                  <TabsList className="self-start">
                    <TabsTrigger value="items">
                      上下文条目清单 ({contextPackage.items.length})
                    </TabsTrigger>
                    <TabsTrigger value="messages">实际请求消息 ({contextPackage.messages.length})</TabsTrigger>
                  </TabsList>

                  <TabsContent value="items" className="flex-1 overflow-hidden mt-2">
                    <ScrollArea className="h-full pr-2">
                      <div className="flex flex-col gap-2 p-1 pb-8">
                        {contextPackage.items.map((item) => (
                          <Card
                            key={item.id}
                            className="flex items-center justify-between p-3 bg-white border-[#e5ddd3] text-xs"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <Badge variant="secondary" title={`优先级等级: ${item.authorityLevel}`}>
                                {item.authorityLevel}
                              </Badge>
                              <strong className="text-[#2c2523] truncate">
                                {item.title || item.sourceType}
                              </strong>
                              <span className="text-[11px] text-[#7d6b59] truncate">
                                {item.selectionReason}
                              </span>
                              <span className="text-[10px] text-[#7d6b59]" title={`来源：${item.sourceType} / ${item.sourceId}`}>{item.role || '资料'}{item.moduleId && ` · ${item.moduleId}`}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {item.fixed && <Badge variant="primary">不可裁剪</Badge>}
                              <span className="font-mono font-semibold text-[#54473b]">
                                ~{item.estimatedTokens} tokens
                              </span>
                            </div>
                          </Card>
                        ))}

                        {contextPackage.excludedItems.length > 0 && (
                          <div className="flex flex-col gap-1.5 pt-3">
                            <h5 className="text-xs font-semibold text-red-600">
                              未纳入请求的参考资料：
                            </h5>
                            {contextPackage.excludedItems.map((ex, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700"
                              >
                                <span>{ex.title || ex.sourceType}</span>
                                <span>{EXCLUSION_REASONS[ex.reason]} (~{ex.estimatedTokens} tokens)</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="messages" className="flex flex-1 min-h-0 flex-col overflow-hidden mt-2">
                    <div className="flex justify-end gap-2 pb-2 shrink-0">
                      {onOpenCreativeSettings && (
                        <Button size="sm" variant="outline" className="text-xs h-7 border-[#dacdbe]" onClick={() => { onClose(); onOpenCreativeSettings() }}><Sliders size={12} className="mr-1 text-[#2d6a4f]" />提示词设置</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => handleCopyText(JSON.stringify(contextPackage.messages, null, 2))}><Copy size={12} />{copied ? '已复制' : '复制实际消息'}</Button>
                    </div>
                    <ScrollArea className="flex-1 min-h-0 rounded-xl border border-[#e5ddd3] bg-white">
                      <div className="space-y-3 p-3 pb-8">
                        {contextPackage.messages.map((message, index) => (
                          <div key={index} className="space-y-2">
                            <Badge variant="outline" className="text-[10px] border-[#dacdbe]">{index + 1} · {message.role}</Badge>
                            <pre className="font-mono text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap break-words">{message.content}</pre>
                          </div>
                        ))}
                        {contextPackage.messages.length === 0 && <p className="text-xs text-[#7d6b59]">本预览未包含实际请求消息，请重新生成预览。</p>}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 px-6 pb-4 shrink-0 text-[11px] text-[#7d6b59]">
          <span>
            上下文包写入数据库后具备唯一指纹，正文或配置变更将触发过时失效保护
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            {onStartCreation && !contextPackageId && (
              <Button
                disabled={!contextPackage || previewing || startingCreation}
                onClick={() => void handleStartCreation()}
              >
                <Sparkles size={14} />
                {startingCreation ? '正在启动…' : '开始生成候选'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
