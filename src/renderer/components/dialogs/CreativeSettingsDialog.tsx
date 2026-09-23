import { useState, useEffect, useCallback } from 'react'
import { Check, Plus, Sliders, Sparkles, Tag, Trash2 } from 'lucide-react'
import { InstructionPreset, StyleSample } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { taskTypeLabel } from '../../utils/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@appica/ui-react/tabs'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

export function CreativeSettingsDialog({
  sessionId,
  isReadOnly,
  onClose
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'rules' | 'samples' | 'presets'>('rules')
  const [error, setError] = useState('')

  // Rules state
  const [rulesContent, setRulesContent] = useState('')
  const [rulesVersion, setRulesVersion] = useState(1)
  const [savedRulesContent, setSavedRulesContent] = useState('')
  const [savingRules, setSavingRules] = useState(false)

  // Samples state
  const [samples, setSamples] = useState<StyleSample[]>([])
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)
  const [sampleName, setSampleName] = useState('')
  const [sampleTags, setSampleTags] = useState('')
  const [sampleContent, setSampleContent] = useState('')
  const [sampleVersion, setSampleVersion] = useState(1)
  const [isNewSample, setIsNewSample] = useState(false)
  const [savingSample, setSavingSample] = useState(false)

  // Presets state
  const [taskFilter, setTaskFilter] = useState<'all' | 'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat'>('all')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetType, setPresetType] = useState<'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat'>('continue')
  const [presetName, setPresetName] = useState('')
  const [presetInstruction, setPresetInstruction] = useState('')
  const [presetVersion, setPresetVersion] = useState(1)
  const [isNewPreset, setIsNewPreset] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)

  const loadRules = useCallback(async () => {
    try {
      const res = await window.novelAgent.creativeRule.get({ sessionId })
      setRulesContent(res.content)
      setSavedRulesContent(res.content)
      setRulesVersion(res.version)
    } catch {}
  }, [sessionId])

  const loadSamples = useCallback(async () => {
    try {
      const list = await window.novelAgent.styleSample.list({ sessionId })
      setSamples(list)
      if (list.length > 0 && !selectedSampleId && !isNewSample) {
        setSelectedSampleId(list[0].id)
        setSampleName(list[0].name)
        setSampleTags(list[0].tags.join(', '))
        setSampleContent(list[0].content)
        setSampleVersion(list[0].version)
      }
    } catch {}
  }, [sessionId, selectedSampleId, isNewSample])

  const loadPresets = useCallback(async () => {
    try {
      const list = await window.novelAgent.preset.list({
        sessionId,
        taskType: taskFilter === 'all' ? undefined : taskFilter
      })
      setPresets(list)
      if (list.length > 0 && !selectedPresetId && !isNewPreset) {
        setSelectedPresetId(list[0].id)
        setPresetType(list[0].taskType)
        setPresetName(list[0].name)
        setPresetInstruction(list[0].instruction)
        setPresetVersion(list[0].version)
      }
    } catch {}
  }, [sessionId, taskFilter, selectedPresetId, isNewPreset])

  useEffect(() => {
    if (activeTab === 'rules') void loadRules()
    else if (activeTab === 'samples') void loadSamples()
    else void loadPresets()
  }, [activeTab, loadRules, loadSamples, loadPresets])

  const saveRules = async () => {
    try {
      setSavingRules(true)
      setError('')
      const updated = await window.novelAgent.creativeRule.update({
        sessionId,
        content: rulesContent,
        expectedVersion: rulesVersion
      })
      setRulesContent(updated.content)
      setSavedRulesContent(updated.content)
      setRulesVersion(updated.version)
    } catch (err) {
      setError(errorText(err, '保存创作规则失败'))
    } finally {
      setSavingRules(false)
    }
  }

  const selectSample = (s: StyleSample) => {
    setIsNewSample(false)
    setSelectedSampleId(s.id)
    setSampleName(s.name)
    setSampleTags(s.tags.join(', '))
    setSampleContent(s.content)
    setSampleVersion(s.version)
    setError('')
  }

  const startNewSample = () => {
    setIsNewSample(true)
    setSelectedSampleId(null)
    setSampleName('新建风格样本')
    setSampleTags('')
    setSampleContent('')
    setSampleVersion(1)
    setError('')
  }

  const saveSample = async () => {
    try {
      setSavingSample(true)
      setError('')
      const tags = sampleTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      if (isNewSample) {
        const created = await window.novelAgent.styleSample.create({
          sessionId,
          name: sampleName,
          content: sampleContent,
          tags
        })
        setIsNewSample(false)
        setSelectedSampleId(created.id)
        setSampleVersion(created.version)
      } else if (selectedSampleId) {
        const updated = await window.novelAgent.styleSample.update({
          sessionId,
          sampleId: selectedSampleId,
          name: sampleName,
          content: sampleContent,
          tags,
          expectedVersion: sampleVersion
        })
        setSampleVersion(updated.version)
      }
      await loadSamples()
    } catch (err) {
      setError(errorText(err, '保存风格样本失败'))
    } finally {
      setSavingSample(false)
    }
  }

  const deleteSample = async () => {
    if (!selectedSampleId || isNewSample) return
    try {
      setError('')
      await window.novelAgent.styleSample.delete({
        sessionId,
        sampleId: selectedSampleId,
        expectedVersion: sampleVersion
      })
      setSelectedSampleId(null)
      await loadSamples()
    } catch (err) {
      setError(errorText(err, '删除风格样本失败'))
    }
  }

  const selectPreset = (p: InstructionPreset) => {
    setIsNewPreset(false)
    setSelectedPresetId(p.id)
    setPresetType(p.taskType)
    setPresetName(p.name)
    setPresetInstruction(p.instruction)
    setPresetVersion(p.version)
    setError('')
  }

  const startNewPreset = () => {
    setIsNewPreset(true)
    setSelectedPresetId(null)
    setPresetType(taskFilter === 'all' ? 'continue' : taskFilter)
    setPresetName('新建指令预设')
    setPresetInstruction('')
    setPresetVersion(1)
    setError('')
  }

  const savePreset = async () => {
    try {
      setSavingPreset(true)
      setError('')
      if (isNewPreset) {
        const created = await window.novelAgent.preset.create({
          sessionId,
          taskType: presetType,
          name: presetName,
          instruction: presetInstruction
        })
        setIsNewPreset(false)
        setSelectedPresetId(created.id)
        setPresetVersion(created.version)
      } else if (selectedPresetId) {
        const updated = await window.novelAgent.preset.update({
          sessionId,
          presetId: selectedPresetId,
          name: presetName,
          instruction: presetInstruction,
          expectedVersion: presetVersion
        })
        setPresetVersion(updated.version)
      }
      await loadPresets()
    } catch (err) {
      setError(errorText(err, '保存指令预设失败'))
    } finally {
      setSavingPreset(false)
    }
  }

  const deletePreset = async () => {
    if (!selectedPresetId || isNewPreset) return
    try {
      setError('')
      await window.novelAgent.preset.delete({
        sessionId,
        presetId: selectedPresetId,
        expectedVersion: presetVersion
      })
      setSelectedPresetId(null)
      await loadPresets()
    } catch (err) {
      setError(errorText(err, '删除指令预设失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col w-[90vw] max-w-[90vw] h-[90vh] p-6" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>创作配置管理</DialogTitle>
          <DialogDescription>
            维护全书长期创作规则、写作风格样本以及各任务分类指令预设。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as any)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList className="self-start">
            <TabsTrigger value="rules" className="gap-1.5">
              <Sliders size={14} />
              全书创作规则
            </TabsTrigger>
            <TabsTrigger value="samples" className="gap-1.5">
              <Tag size={14} />
              风格样本 ({samples.length})
            </TabsTrigger>
            <TabsTrigger value="presets" className="gap-1.5">
              <Sparkles size={14} />
              指令预设 ({presets.length})
            </TabsTrigger>
          </TabsList>

          {error && <p className="inline-error text-xs text-red-600 mt-2">{error}</p>}

          {/* Tab 1: Rules */}
          <TabsContent value="rules" className="flex flex-1 flex-col overflow-hidden gap-3 mt-2">
            <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2">
              <span className="text-xs text-[#7d6b59]">
                长期规则在所有生成任务中默认注入且优先级仅次于系统约束 (版本 v{rulesVersion})
              </span>
              <Button
                size="sm"
                disabled={isReadOnly || savingRules || rulesContent === savedRulesContent}
                onClick={() => void saveRules()}
              >
                <Check size={14} />
                {savingRules ? '保存中...' : rulesContent === savedRulesContent ? '已保存' : '保存规则'}
              </Button>
            </div>
            <Textarea
              value={rulesContent}
              disabled={isReadOnly}
              onChange={(e) => setRulesContent(e.target.value)}
              placeholder="请输入全书长期有效的题材设定、人物禁忌、文风要求等硬性创作规则..."
              className="flex-1 resize-none rounded-xl border border-[#dacdbe] bg-white p-4 font-serif text-sm leading-relaxed text-[#2c2523] outline-none focus:border-[#2d6a4f]"
            />
          </TabsContent>

          {/* Tab 2: Samples */}
          <TabsContent value="samples" className="flex flex-1 gap-4 overflow-hidden mt-2">
            <aside className="flex w-64 flex-col gap-2 border-r border-[#e5ddd3] pr-3 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#7d6b59]">风格样本列表</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={isReadOnly}
                  onClick={startNewSample}
                >
                  <Plus size={15} />
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-1">
                  {samples.map((s) => (
                    <Card
                      key={s.id}
                      className={`flex flex-col gap-1 p-2.5 text-left transition-colors cursor-pointer border ${
                        !isNewSample && selectedSampleId === s.id
                          ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                          : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                      }`}
                      onClick={() => selectSample(s)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#2c2523] truncate">
                          {s.name}
                        </span>
                        <Badge variant="secondary">v{s.version}</Badge>
                      </div>
                      <span className="text-[11px] text-[#7d6b59] truncate">
                        {s.content || '无正文'}
                      </span>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </aside>

            <main className="flex flex-1 flex-col overflow-hidden">
              {selectedSampleId || isNewSample ? (
                <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2">
                    <h2 className="text-sm font-semibold text-[#2c2523]">
                      {isNewSample ? '新建风格样本' : sampleName}
                    </h2>
                    {!isNewSample && <Badge variant="secondary">版本 v{sampleVersion}</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 text-xs">
                      <label className="font-semibold text-[#7d6b59]">样本名称</label>
                      <Input
                        className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none"
                        value={sampleName}
                        onChange={(e) => setSampleName(e.target.value)}
                        placeholder="例如：打斗高潮、细腻心理"
                      />
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      <label className="font-semibold text-[#7d6b59]">标签 (逗号分隔)</label>
                      <Input
                        className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none"
                        value={sampleTags}
                        onChange={(e) => setSampleTags(e.target.value)}
                        placeholder="打斗, 仙侠, 豪放"
                      />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-1 text-xs overflow-hidden">
                    <label className="font-semibold text-[#7d6b59]">参考文本正文</label>
                    <Textarea
                      value={sampleContent}
                      onChange={(e) => setSampleContent(e.target.value)}
                      placeholder="输入示范正文片段..."
                      className="flex-1 resize-none rounded-xl border border-[#dacdbe] bg-white p-3 font-serif text-sm leading-relaxed text-[#2c2523] outline-none focus:border-[#2d6a4f]"
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-[#e5ddd3] pt-2">
                    <div>
                      {!isNewSample && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 text-xs"
                          onClick={() => void deleteSample()}
                        >
                          <Trash2 size={14} />
                          删除样本
                        </Button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={isReadOnly || savingSample || !sampleName.trim()}
                      onClick={() => void saveSample()}
                    >
                      <Check size={14} />
                      {savingSample ? '保存中...' : '保存样本'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="m-auto text-xs text-[#7d6b59]">请选择或新建一个风格样本</p>
              )}
            </main>
          </TabsContent>

          {/* Tab 3: Presets */}
          <TabsContent value="presets" className="flex flex-1 gap-4 overflow-hidden mt-2">
            <aside className="flex w-64 flex-col gap-2 border-r border-[#e5ddd3] pr-3 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#7d6b59]">指令预设列表</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={isReadOnly}
                  onClick={startNewPreset}
                >
                  <Plus size={15} />
                </Button>
              </div>
              <Select
                value={taskFilter}
                onValueChange={(val) => setTaskFilter(val as typeof taskFilter)}
              >
                <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white p-1.5 text-xs text-[#2c2523] outline-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部任务类型</SelectItem>
                  <SelectItem value="continue">续写 (continue)</SelectItem>
                  <SelectItem value="rewrite">重写 (rewrite)</SelectItem>
                  <SelectItem value="polish">润色 (polish)</SelectItem>
                  <SelectItem value="knowledge">知识分析 (knowledge)</SelectItem>
                  <SelectItem value="report">文学报告 (report)</SelectItem>
                  <SelectItem value="chat">项目问答 (chat)</SelectItem>
                </SelectContent>
              </Select>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-1">
                  {presets.map((p) => (
                    <Card
                      key={p.id}
                      className={`flex flex-col gap-1 p-2.5 text-left transition-colors cursor-pointer border ${
                        !isNewPreset && selectedPresetId === p.id
                          ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                          : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                      }`}
                      onClick={() => selectPreset(p)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#2c2523] truncate">
                          {p.name}
                        </span>
                        <Badge variant="secondary">{taskTypeLabel[p.taskType]}</Badge>
                      </div>
                      <span className="text-[11px] text-[#7d6b59] truncate">
                        {p.instruction || '无指令'}
                      </span>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </aside>

            <main className="flex flex-1 flex-col overflow-hidden">
              {selectedPresetId || isNewPreset ? (
                <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2">
                    <h2 className="text-sm font-semibold text-[#2c2523]">
                      {isNewPreset ? '新建指令预设' : presetName}
                    </h2>
                    {!isNewPreset && <Badge variant="secondary">版本 v{presetVersion}</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 text-xs">
                      <label className="font-semibold text-[#7d6b59]">任务分类</label>
                      <Select
                        value={presetType}
                        onValueChange={(val) => setPresetType(val as typeof presetType)}
                      >
                        <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="continue">续写 (continue)</SelectItem>
                          <SelectItem value="rewrite">重写 (rewrite)</SelectItem>
                          <SelectItem value="polish">润色 (polish)</SelectItem>
                          <SelectItem value="knowledge">知识分析 (knowledge)</SelectItem>
                          <SelectItem value="report">文学报告 (report)</SelectItem>
                          <SelectItem value="chat">项目问答 (chat)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      <label className="font-semibold text-[#7d6b59]">预设名称</label>
                      <Input
                        className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="例如：战斗场面强化"
                      />
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-1 text-xs overflow-hidden">
                    <label className="font-semibold text-[#7d6b59]">指令模板内容</label>
                    <Textarea
                      value={presetInstruction}
                      onChange={(e) => setPresetInstruction(e.target.value)}
                      placeholder="输入在执行对应任务时使用的指令提示词模板..."
                      className="flex-1 resize-none rounded-xl border border-[#dacdbe] bg-white p-3 font-serif text-sm leading-relaxed text-[#2c2523] outline-none focus:border-[#2d6a4f]"
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-[#e5ddd3] pt-2">
                    <div>
                      {!isNewPreset && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 text-xs"
                          onClick={() => void deletePreset()}
                        >
                          <Trash2 size={14} />
                          删除预设
                        </Button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={isReadOnly || savingPreset || !presetName.trim()}
                      onClick={() => void savePreset()}
                    >
                      <Check size={14} />
                      {savingPreset ? '保存中...' : '保存预设'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="m-auto text-xs text-[#7d6b59]">请选择或新建一个指令预设</p>
              )}
            </main>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>创作配置修改后自动递增 revision 并同步检索</span>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
