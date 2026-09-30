import { useState, useEffect } from 'react'
import { Sparkles, FileBarChart, Compass, WandSparkles, ListTree, RotateCw, Play, AlertTriangle, Save } from 'lucide-react'
import { ChapterHeader, ModelConnectionSummary, InstructionPreset } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getEndpointHost } from '../../utils/crypto'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Checkbox } from '@appica/ui-react/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'
import { Textarea } from '@appica/ui-react/textarea'
import { Input } from '@appica/ui-react/input'

export function StartAnalysisDialog({
  sessionId,
  chapters,
  canUsePipelines,
  initialType = 'knowledge',
  isReadOnly,
  onClose,
  onStarted
}: {
  sessionId: string
  chapters: ChapterHeader[]
  canUsePipelines: boolean
  initialType?: 'knowledge' | 'report' | 'synopsis' | 'style_distill' | 'book_summary'
  isReadOnly: boolean
  onClose: () => void
  onStarted: (taskId: string) => void
}) {
  const [taskType, setTaskType] = useState<'knowledge' | 'report' | 'synopsis' | 'style_distill' | 'book_summary'>(initialType)
  const [scopeMode, setScopeMode] = useState<'all' | 'custom'>('all')
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>(chapters.map((c) => c.id))
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetInstruction, setPresetInstruction] = useState('')
  const [segmentSize, setSegmentSize] = useState('50000')
  const [stageSize, setStageSize] = useState('1000000')

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.novelAgent.connection.list({ kind: 'generation' })
        setConnections(list)
        if (list.length > 0) {
          setSelectedConnectionId(list[0].id)
        }
      } catch {}
    })()
  }, [])

  useEffect(() => {
    if (taskType !== 'style_distill' && taskType !== 'book_summary') return
    void window.novelAgent.preset.list({ sessionId, taskType }).then((list) => {
      setPresets(list)
      const first = list[0]
      setSelectedPresetId(first?.id ?? '')
      setPresetInstruction(first?.instruction ?? '')
    }).catch(() => setPresets([]))
  }, [sessionId, taskType])

  const toggleChapter = (id: string) => {
    setSelectedChapterIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleStart = async () => {
    if (scopeMode === 'custom' && selectedChapterIds.length === 0 && taskType !== 'synopsis') {
      setError('请至少勾选一个章节')
      return
    }
    setLoading(true)
    setError('')
    try {
      const scope = {
        ...(scopeMode === 'all' ? { all: true } : { chapterIds: selectedChapterIds }),
        ...(taskType === 'style_distill' || taskType === 'book_summary'
          ? { segmentSize: Number(segmentSize) || 50000, stageSize: Number(stageSize) || 1000000 }
          : {})
      }
      const res = await window.novelAgent.analysis.start({
        sessionId,
        type: taskType,
        scope,
        connectionId: selectedConnectionId || undefined,
        presetId: selectedPresetId || undefined,
        instruction: taskType === 'style_distill' || taskType === 'book_summary' ? presetInstruction : undefined
      })
      onStarted(res.taskId)
      onClose()
    } catch (err) {
      setError(errorText(err, '启动任务失败'))
      setLoading(false)
    }
  }

  const selectedConn = connections.find((c) => c.id === selectedConnectionId)
  const isConfirmed = selectedConn ? Boolean(selectedConn.confirmedContentTargetFingerprint) : false

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col max-h-[85vh] sm:max-w-4xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>发起分析与生成任务</DialogTitle>
          <DialogDescription>
            基于配置的模型连接，后台执行知识分析、文学报告、文风蒸馏或分阶段全书总结
          </DialogDescription>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        <ScrollArea className="h-[460px] px-6">
          <div className="flex flex-col gap-4 p-1">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[#7d6b59]">任务类型</label>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {canUsePipelines && <Card
                  className={`flex flex-col gap-2 p-3 text-left transition-colors cursor-pointer border ${
                    taskType === 'knowledge'
                      ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                      : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                  }`}
                  onClick={() => setTaskType('knowledge')}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[#2c2523]">
                    <Sparkles size={16} className="text-[#2d6a4f]" />
                    <span>知识设定与一致性</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#7d6b59]">
                    按章节顺序滚动提取人物/世界观/时间线事实，验证语义分块边界，排查剧情漏洞与矛盾
                  </p>
                </Card>}

                {canUsePipelines && <Card
                  className={`flex flex-col gap-2 p-3 text-left transition-colors cursor-pointer border ${
                    taskType === 'report'
                      ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                      : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                  }`}
                  onClick={() => setTaskType('report')}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[#2c2523]">
                    <FileBarChart size={16} className="text-[#2d6a4f]" />
                    <span>文学分析报告 (六维)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#7d6b59]">
                    深度剖析主题思想、叙事视角、语言文风、节奏与结构、人物成长及连续性
                  </p>
                </Card>}

                <Card
                  className={`flex flex-col gap-2 p-3 text-left transition-colors cursor-pointer border ${
                    taskType === 'synopsis'
                      ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                      : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                  }`}
                  onClick={() => setTaskType('synopsis')}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[#2c2523]">
                    <Compass size={16} className="text-[#2d6a4f]" />
                    <span>滚动故事梗概 (大纲)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#7d6b59]">
                    综合已生成的章节摘要，构建全局宏观故事演进脉络与细分梗概
                  </p>
                </Card>

                <Card
                  className={`flex flex-col gap-2 p-3 text-left transition-colors cursor-pointer border ${taskType === 'style_distill' ? 'border-[#2d6a4f] bg-[#e8f3ee]' : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'}`}
                  onClick={() => setTaskType('style_distill')}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[#2c2523]"><WandSparkles size={16} className="text-[#2d6a4f]" /><span>文风蒸馏</span></div>
                  <p className="text-[11px] leading-relaxed text-[#7d6b59]">分段提炼文风公式，合并为可复用写作提示词</p>
                </Card>

                <Card
                  className={`flex flex-col gap-2 p-3 text-left transition-colors cursor-pointer border ${taskType === 'book_summary' ? 'border-[#2d6a4f] bg-[#e8f3ee]' : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'}`}
                  onClick={() => setTaskType('book_summary')}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-[#2c2523]"><ListTree size={16} className="text-[#2d6a4f]" /><span>全书总结</span></div>
                  <p className="text-[11px] leading-relaxed text-[#7d6b59]">滚动整理主线、人物、世界观、伏笔与时间线</p>
                </Card>
              </div>
            </div>

            {taskType !== 'synopsis' && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[#7d6b59]">分析章节范围</label>
                <div className="flex gap-6 rounded-xl border border-[#e5ddd3] bg-[#f5efe6] p-3 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={scopeMode === 'all'}
                      onCheckedChange={() => setScopeMode('all')}
                    />
                    <span>全部章节 ({chapters.length} 章)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={scopeMode === 'custom'}
                      onCheckedChange={() => setScopeMode('custom')}
                    />
                    <span>自定义勾选章节</span>
                  </label>
                </div>

                {scopeMode === 'custom' && (
                  <div className="flex flex-col gap-2 rounded-xl border border-[#e5ddd3] bg-white p-3">
                    <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2 text-xs">
                      <span className="font-medium text-[#2c2523]">
                        已选择 {selectedChapterIds.length} / {chapters.length} 章
                      </span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedChapterIds(chapters.map((c) => c.id))}
                        >
                          全选
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedChapterIds([])}
                        >
                          清空
                        </Button>
                      </div>
                    </div>
                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pt-1">
                      {chapters.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-[#2c2523] hover:bg-[#f5efe6] cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedChapterIds.includes(c.id)}
                            onCheckedChange={() => toggleChapter(c.id)}
                          />
                          <span>{c.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {canUsePipelines && (taskType === 'style_distill' || taskType === 'book_summary') && (
              <div className="grid gap-3 rounded-xl border border-[#e5ddd3] bg-[#f5efe6] p-3 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#7d6b59]">任务预设</label>
                  <Select value={selectedPresetId || '__none__'} onValueChange={(value) => { const selectedValue = String(value); const p = presets.find((item) => item.id === selectedValue); setSelectedPresetId(selectedValue === '__none__' ? '' : selectedValue); setPresetInstruction(p?.instruction ?? '') }}>
                    <SelectTrigger className="w-full bg-white"><SelectValue placeholder="不使用预设" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">不使用预设</SelectItem>{presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Textarea value={presetInstruction} onChange={(event) => setPresetInstruction(String(event.target.value ?? ''))} placeholder="可编辑当前步骤提示词预设" className="min-h-24 bg-white text-xs" />
                  <Button type="button" size="sm" variant="outline" className="self-start gap-1" disabled={!presetInstruction.trim()} onClick={async () => { try { const saved = await window.novelAgent.preset.create({ sessionId, taskType, name: `${taskType === 'style_distill' ? '文风蒸馏' : '全书总结'}预设`, instruction: presetInstruction }); setPresets((prev) => [...prev, saved]); setSelectedPresetId(saved.id) } catch (err) { setError(errorText(err, '保存预设失败')) } }}><Save size={13} />保存为新预设</Button>
                </div>
                <div className="grid content-start gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[#7d6b59]">单段字数<Input value={segmentSize} onChange={(event) => setSegmentSize(event.target.value)} className="rounded-lg border border-[#dacdbe] bg-white px-2 py-2 text-sm text-[#2c2523]" inputMode="numeric" /></label>
                  <label className="flex flex-col gap-1 text-xs text-[#7d6b59]">阶段合并上限<Input value={stageSize} onChange={(event) => setStageSize(event.target.value)} className="rounded-lg border border-[#dacdbe] bg-white px-2 py-2 text-sm text-[#2c2523]" inputMode="numeric" /></label>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[#7d6b59]">执行模型连接</label>
              {connections.length === 0 ? (
                <p className="text-xs text-red-600">
                  当前尚未配置生成模型连接。请先前往「模型」配置连接。
                </p>
              ) : (
                <Select
                  value={selectedConnectionId}
                  onValueChange={(val) => setSelectedConnectionId(val as string)}
                >
                  <SelectTrigger className="w-full rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.model}) - {getEndpointHost(c.baseUrl)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedConn && !isConfirmed && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>该连接的目标指纹尚未确认。发送请求时需进行联网目标确认。</span>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>任务在后台异步串行执行，可随时在「任务」面板查看实时进度</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={isReadOnly || loading || connections.length === 0}
              onClick={() => void handleStart()}
            >
              {loading ? (
                <RotateCw className="animate-spin" size={14} />
              ) : (
                <Play size={14} />
              )}
              {loading ? '启动中...' : '开始执行任务'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
