import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Copy, Eye, RotateCw, Sparkles } from 'lucide-react'
import {
  ChapterHeader,
  ChatWorkflowStage,
  ChatWorkflowType,
  ContextPackage,
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

export function ContextPreviewDialog({
  sessionId,
  chapters,
  currentChapterId,
  initialTaskType = 'continue',
  initialStage,
  initialWorkflowType,
  initialOutlineId,
  initialOutlineVersion,
  chatSessionId,
  onClose,
  onStartCreation,
  onOpenConnections
}: {
  sessionId: string
  chapters: ChapterHeader[]
  currentChapterId?: string
  initialTaskType?: TaskType
  initialStage?: ChatWorkflowStage
  initialWorkflowType?: ChatWorkflowType
  initialOutlineId?: string
  initialOutlineVersion?: number
  chatSessionId?: string
  onClose: () => void
  onStartCreation?: (contextPackageId: string, taskType: TaskType) => void
  onOpenConnections?: () => void
}) {
  const [taskType, setTaskType] = useState<TaskType>(initialTaskType)
  const [targetChapterId, setTargetChapterId] = useState<string>(currentChapterId || (chapters[0]?.id ?? ''))
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [styleSamples, setStyleSamples] = useState<StyleSample[]>([])
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([])
  const [includeCreativeRules, setIncludeCreativeRules] = useState(true)
  const [targetLength, setTargetLength] = useState<number>(1000)
  const [creativity, setCreativity] = useState<'low' | 'medium' | 'high'>('medium')
  const [instruction, setInstruction] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [contextPackage, setContextPackage] = useState<ContextPackage | null>(null)
  const [activeTab, setActiveTab] = useState<'items' | 'system' | 'user'>('items')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleGeneratePreview = useCallback(async (connIdOverride?: string) => {
    const connId = connIdOverride || selectedConnectionId
    if (!connId) {
      setError('请选择模型连接')
      return
    }

    setPreviewing(true)
    setError('')
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
        target: targetChapterId ? { chapterId: targetChapterId } : undefined,
        instruction,
        presetId: selectedPresetId || undefined,
        styleSampleIds: selectedStyleIds.length > 0 ? selectedStyleIds : undefined,
        includeCreativeRules,
        targetLength: targetLength > 0 ? targetLength : undefined,
        creativity
      })
      setContextPackage(pkg)
    } catch (err) {
      setError(errorText(err, '生成上下文装配预览失败'))
    } finally {
      setPreviewing(false)
    }
  }, [sessionId, selectedConnectionId, taskType, initialStage, initialWorkflowType, initialOutlineId, initialOutlineVersion, chatSessionId, targetChapterId, instruction, selectedPresetId, selectedStyleIds, includeCreativeRules, targetLength, creativity])

  const loadDependencies = useCallback(async () => {
    try {
      const [connList, presetList, sampleList] = await Promise.all([
        window.novelAgent.connection.list({ kind: 'generation' }),
        window.novelAgent.preset.list({ sessionId }),
        window.novelAgent.styleSample.list({ sessionId })
      ])
      setConnections(connList)
      let activeConn = selectedConnectionId
      if (connList.length > 0 && !activeConn) {
        activeConn = connList[0].id
        setSelectedConnectionId(activeConn)
      }
      setPresets(presetList)
      setStyleSamples(sampleList)
      if (activeConn) {
        void handleGeneratePreview(activeConn)
      }
    } catch {}
  }, [sessionId, selectedConnectionId, handleGeneratePreview])

  useEffect(() => {
    void loadDependencies()
  }, [loadDependencies])

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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col w-[90vw] max-w-[90vw] h-[90vh]" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>上下文装配预览与 Token 预算</DialogTitle>
          <DialogDescription>
            12 级优先级装配规则、Token 输入预算分配、不可裁剪内容保护及最终 Prompt 查看
          </DialogDescription>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        <div className="flex flex-1 gap-5 overflow-hidden border-t border-[#e5ddd3] pt-3 px-6">
          {/* Controls Left Column */}
          <div className="flex w-80 flex-col gap-3 border-r border-[#e5ddd3] pr-4 shrink-0">
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
                      onValueChange={(val) => setCreativity(val as any)}
                    >
                      <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-2 py-1 text-xs text-[#2c2523] outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">低 (严谨)</SelectItem>
                        <SelectItem value="medium">中 (平衡)</SelectItem>
                        <SelectItem value="high">高 (探索)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer font-medium text-[#2c2523]">
                  <Checkbox
                    checked={includeCreativeRules}
                    onCheckedChange={(checked) => setIncludeCreativeRules(Boolean(checked))}
                  />
                  <span>注入全书创作规则 (第2优先级)</span>
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
              disabled={previewing || !selectedConnectionId}
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
          </div>

          {/* Result Right Column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!contextPackage ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[#7d6b59]">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#efe6da] text-[#2d6a4f]">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#2c2523] mb-1">尚未生成装配预览</h3>
                  <p className="max-w-xs text-xs text-[#7d6b59] leading-relaxed">
                    在左侧配置任务目标、参数与模型，点击「生成装配预览」即可查看 12 级优先级裁剪预算与组装后的 Prompt 全文。
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden gap-3">
                {/* Token Budget Meter */}
                <Card className="flex flex-col gap-2 p-3 bg-white border-[#e5ddd3] shrink-0 text-xs">
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
                        已裁剪 {contextPackage.excludedItems.length} 项超出预算条目
                      </span>
                    )}
                    <span>
                      指纹:{' '}
                      <code className="font-mono text-[10px] text-[#54473b]">
                        {contextPackage.configurationFingerprint}
                      </code>
                    </span>
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
                  onValueChange={(v) => setActiveTab(v as any)}
                  className="flex flex-1 flex-col overflow-hidden"
                >
                  <TabsList className="self-start">
                    <TabsTrigger value="items">
                      上下文条目清单 ({contextPackage.items.length})
                    </TabsTrigger>
                    <TabsTrigger value="system">System Prompt</TabsTrigger>
                    <TabsTrigger value="user">User Prompt</TabsTrigger>
                  </TabsList>

                  <TabsContent value="items" className="flex-1 overflow-hidden mt-2">
                    <ScrollArea className="h-[360px] pr-2">
                      <div className="flex flex-col gap-2 p-1">
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
                              被裁剪的低优先级项:
                            </h5>
                            {contextPackage.excludedItems.map((ex, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700"
                              >
                                <span>{ex.title || ex.sourceType}</span>
                                <span>超出预算 (~{ex.estimatedTokens} tokens)</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="system" className="flex-1 overflow-hidden mt-2 relative">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute right-3 top-2 z-10 text-xs"
                      onClick={() => handleCopyText(contextPackage.systemMessage)}
                    >
                      <Copy size={12} />
                      {copied ? '已复制' : '复制全文'}
                    </Button>
                    <ScrollArea className="h-[360px] rounded-xl border border-[#e5ddd3] bg-white p-3">
                      <pre className="font-mono text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap">
                        {contextPackage.systemMessage}
                      </pre>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="user" className="flex-1 overflow-hidden mt-2 relative">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute right-3 top-2 z-10 text-xs"
                      onClick={() => handleCopyText(contextPackage.userMessage)}
                    >
                      <Copy size={12} />
                      {copied ? '已复制' : '复制全文'}
                    </Button>
                    <ScrollArea className="h-[360px] rounded-xl border border-[#e5ddd3] bg-white p-3">
                      <pre className="font-mono text-xs leading-relaxed text-[#2c2523] whitespace-pre-wrap">
                        {contextPackage.userMessage}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>
            上下文包写入数据库后具备唯一指纹，正文或配置变更将触发过时失效保护
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            {onStartCreation && (
              <Button
                disabled={!contextPackage}
                onClick={() => {
                  if (contextPackage) onStartCreation(contextPackage.id, taskType)
                }}
              >
                <Sparkles size={14} />
                开始生成候选
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
