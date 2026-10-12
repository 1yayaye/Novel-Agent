import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Check, Plus, Sliders, Sparkles, Trash2, RefreshCw, BookOpen, Terminal, AlertCircle, FileText, Maximize2, Minimize2, ChevronDown, ChevronRight, RotateCcw, Upload, Download, ArrowUp, ArrowDown } from 'lucide-react'
import type { InstructionPreset, StyleSample, PromptBundle, PresetStoreData, NovelPromptPreset, PresetBlock } from '../../../shared/project.js'
import { errorText } from '../../utils/formatters.js'
import { taskTypeLabel } from '../../utils/constants.js'
import { extractHeadings } from '../../utils/markdownOutline.js'
import { PRESET_ROLE_OPTIONS, PRESET_MARKER_OPTIONS, PRESET_POSITION_OPTIONS } from '../../utils/prompt-settings.js'
import { ProseEditor, type ProseEditorHandle } from '../editor/ProseEditor.js'
import { useToast } from '../common/Toast.js'
import { ConfirmActionDialog } from './ConfirmActionDialog.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@appica/ui-react/tabs'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

function MacroReferenceList() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {AVAILABLE_MACROS.map((m) => (
        <span
          key={m.macro}
          title={m.desc}
          className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#efe6da] text-[#54473b] border border-[#dacdbe]"
        >
          {m.macro}
        </span>
      ))}
    </div>
  )
}

const AVAILABLE_MACROS = [
  { macro: '{{target_text}}', label: '目标正文', desc: '选区文本或前文正文' },
  { macro: '{{creative_rules}}', label: '全书准则', desc: '本作品的作者规则与创作要求' },
  { macro: '{{book_synopsis}}', label: '故事梗概', desc: '全书宏观故事梗概' },
  { macro: '{{book_outline}}', label: '全书大纲', desc: '全书主线大纲' },
  { macro: '{{volume_outline}}', label: '分卷大纲', desc: '当前分卷情节大纲' },
  { macro: '{{chapter_outline}}', label: '章大纲', desc: '本章结构化大纲与场景节拍' },
  { macro: '{{author_instruction}}', label: '作者指令', desc: '作者即时写作要求' }
]

export function CreativeSettingsDialog({ sessionId, isReadOnly = false, onClose, onPreview }: {
  sessionId?: string
  isReadOnly?: boolean
  onClose: () => void
  onPreview?: () => void
}) {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<'settings' | 'rules' | 'presets' | 'samples'>('settings')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [projectLoaded, setProjectLoaded] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  // 1. 全局提示词预设库（酒馆预设架构）
  const [presetStoreDraft, setPresetStoreDraft] = useState<PresetStoreData | null>(null)
  const [savedPresetStore, setSavedPresetStore] = useState<PresetStoreData | null>(null)
  const [presetWarnings, setPresetWarnings] = useState<string[]>([])
  const [presetError, setPresetError] = useState('')
  const [loadingPresets, setLoadingPresets] = useState(true)
  const [savingPresets, setSavingPresets] = useState(false)
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({})
  const [importingModalPreset, setImportingModalPreset] = useState<NovelPromptPreset | null>(null)
  const [importSelectedBlocks, setImportSelectedBlocks] = useState<Record<string, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const presetsDirty = JSON.stringify(presetStoreDraft) !== JSON.stringify(savedPresetStore)
  const presetsNeedSave = presetsDirty || presetWarnings.length > 0
  const activePreset = presetStoreDraft?.presets.find((p) => p.id === presetStoreDraft.activePresetId) ?? (presetStoreDraft?.presets[0] ?? null)

  // 2. 小说项目级：全书准则
  const [rulesContent, setRulesContent] = useState('')
  const [savedRulesContent, setSavedRulesContent] = useState('')
  const [rulesVersion, setRulesVersion] = useState(1)
  const [savingRules, setSavingRules] = useState(false)
  const [showRuleTools, setShowRuleTools] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null)
  const rulesEditorRef = useRef<ProseEditorHandle | null>(null)
  const rulesOutline = useMemo(() => extractHeadings(rulesContent), [rulesContent])
  const rulesDirty = rulesContent !== savedRulesContent

  // 3. 小说项目级：指令预设
  const [taskFilter, setTaskFilter] = useState<'all' | 'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat' | 'style_distill' | 'book_summary'>('all')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetType, setPresetType] = useState<'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat' | 'style_distill' | 'book_summary'>('continue')
  const [presetName, setPresetName] = useState('')
  const [presetInstruction, setPresetInstruction] = useState('')
  const [presetVersion, setPresetVersion] = useState(1)
  const [isNewPreset, setIsNewPreset] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)
  const [resettingPresets, setResettingPresets] = useState(false)
  const presetEditorRef = useRef<ProseEditorHandle | null>(null)

  // 4. 小说项目级：文风样本
  const [samples, setSamples] = useState<StyleSample[]>([])
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)
  const [sampleName, setSampleName] = useState('')
  const [sampleTags, setSampleTags] = useState('')
  const [sampleContent, setSampleContent] = useState('')
  const [sampleVersion, setSampleVersion] = useState(1)
  const [isNewSample, setIsNewSample] = useState(false)
  const [savingSample, setSavingSample] = useState(false)
  const sampleEditorRef = useRef<ProseEditorHandle | null>(null)

  const loadPresetStore = useCallback(async () => {
    setLoadingPresets(true)
    setPresetError('')
    try {
      const state = await window.novelAgent.prompt.getPresetStore()
      setPresetStoreDraft(state.store)
      setSavedPresetStore(state.store)
      setPresetWarnings(state.warnings)
    } catch (err) {
      setPresetError(errorText(err, '加载全局预设库失败'))
    } finally {
      setLoadingPresets(false)
    }
  }, [])

  const savePresetStore = async () => {
    if (!presetStoreDraft || savingPresets) return
    setSavingPresets(true)
    setPresetError('')
    try {
      const state = await window.novelAgent.prompt.savePresetStore(presetStoreDraft)
      setPresetStoreDraft(state.store)
      setSavedPresetStore(state.store)
      setPresetWarnings(state.warnings)
      showToast('全局提示词设置已保存，下次请求生效', 'success')
    } catch (err) {
      setPresetError(errorText(err, '保存全局预设库失败'))
    } finally {
      setSavingPresets(false)
    }
  }

  const handleSelectActivePreset = (presetId: string) => {
    setPresetStoreDraft((current) => current ? { ...current, activePresetId: presetId } : current)
  }

  const handleCreateBlankPreset = () => {
    const newId = crypto.randomUUID()
    const newPreset: NovelPromptPreset = {
      id: newId,
      name: `新预设 ${(presetStoreDraft?.presets.length ?? 0) + 1}`,
      description: '自定义小说创作预设',
      blocks: [
        { id: crypto.randomUUID(), name: '系统创作设定', role: 'system', content: '你是专业小说作家与创作助手。遵守已确认事实与小说世界观，输出生动、自然、符合人物声口的高质量小说内容。', enabled: true, position: 'relative', depth: 0, order: 0 },
        { id: crypto.randomUUID(), name: '设定库资料插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 1, marker: 'marker.knowledge' },
        { id: crypto.randomUUID(), name: '会话与正文历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.history' },
        { id: crypto.randomUUID(), name: '作者任务与指令插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 3, marker: 'marker.task' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setPresetStoreDraft((current) => current ? {
      activePresetId: newId,
      presets: [...current.presets, newPreset]
    } : { activePresetId: newId, presets: [newPreset] })
    showToast(`已创建空白预设「${newPreset.name}」`, 'info')
  }

  const handleDeleteActivePreset = (presetId: string) => {
    setPresetStoreDraft((current) => {
      if (!current) return current
      const nextPresets = current.presets.filter((p) => p.id !== presetId)
      const nextActiveId = current.activePresetId === presetId
        ? (nextPresets[0]?.id ?? null)
        : current.activePresetId
      return {
        activePresetId: nextActiveId,
        presets: nextPresets
      }
    })
    showToast('预设已删除', 'info')
  }

  const handleExportActivePreset = () => {
    if (!activePreset) return
    const blob = new Blob([JSON.stringify(activePreset, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activePreset.name || 'novel-preset'}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`已导出「${activePreset.name}」`, 'success')
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsedPreset = await window.novelAgent.prompt.parseTavernFile(text)
      if (parsedPreset.name === '酒馆导入预设' && file.name) {
        parsedPreset.name = file.name.replace(/\.[^/.]+$/, '')
      }
      const initialSelection: Record<string, boolean> = {}
      parsedPreset.blocks.forEach((b) => {
        initialSelection[b.id] = b.enabled
      })
      setImportSelectedBlocks(initialSelection)
      setImportingModalPreset(parsedPreset)
    } catch (err) {
      showToast(errorText(err, '解析酒馆预设文件失败'), 'error')
    } finally {
      e.target.value = ''
    }
  }

  const handleConfirmImport = () => {
    if (!importingModalPreset) return
    const finalizedPreset: NovelPromptPreset = {
      ...importingModalPreset,
      blocks: importingModalPreset.blocks.map((b) => ({
        ...b,
        enabled: importSelectedBlocks[b.id] ?? b.enabled
      }))
    }
    setPresetStoreDraft((current) => {
      const existing = current?.presets ?? []
      return {
        activePresetId: finalizedPreset.id,
        presets: [...existing, finalizedPreset]
      }
    })
    setImportingModalPreset(null)
    showToast(`已成功导入预设「${finalizedPreset.name}」并设为活跃预设`, 'success')
  }

  const updateActivePreset = (updater: (preset: NovelPromptPreset) => NovelPromptPreset) => {
    setPresetStoreDraft((current) => {
      if (!current || !activePreset) return current
      return {
        ...current,
        presets: current.presets.map((p) => p.id === activePreset.id ? updater(p) : p)
      }
    })
  }

  const handleAddBlock = () => {
    if (!activePreset) return
    const newBlock: PresetBlock = {
      id: crypto.randomUUID(),
      name: `自定义 Block ${activePreset.blocks.length + 1}`,
      role: 'system',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: activePreset.blocks.length
    }
    updateActivePreset((preset) => ({
      ...preset,
      blocks: [...preset.blocks, newBlock]
    }))
  }

  const handleUpdateBlock = (blockId: string, updates: Partial<PresetBlock>) => {
    updateActivePreset((preset) => ({
      ...preset,
      blocks: preset.blocks.map((b) => b.id === blockId ? { ...b, ...updates } : b)
    }))
  }

  const handleDeleteBlock = (blockId: string) => {
    updateActivePreset((preset) => {
      const remaining = preset.blocks.filter((b) => b.id !== blockId)
      remaining.forEach((b, i) => { b.order = i })
      return {
        ...preset,
        blocks: remaining
      }
    })
  }

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    if (!activePreset) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= activePreset.blocks.length) return
    const newBlocks = [...activePreset.blocks]
    const temp = newBlocks[index]
    newBlocks[index] = newBlocks[targetIndex]
    newBlocks[targetIndex] = temp
    newBlocks.forEach((b, i) => { b.order = i })
    updateActivePreset((preset) => ({ ...preset, blocks: newBlocks }))
  }

  const loadBundle = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setProjectLoaded(false)
    setError('')
    try {
      const bundle: PromptBundle = await window.novelAgent.prompt.getBundle({ sessionId })

      setRulesContent(bundle.rules.content)
      setSavedRulesContent(bundle.rules.content)
      setRulesVersion(bundle.rules.version)

      setPresets(bundle.presets)
      if (bundle.presets.length > 0) {
        const first = bundle.presets[0]
        setSelectedPresetId(first.id)
        setPresetType(first.taskType)
        setPresetName(first.name)
        setPresetInstruction(first.instruction)
        setPresetVersion(first.version)
      }

      setSamples(bundle.styleSamples)
      if (bundle.styleSamples.length > 0) {
        const first = bundle.styleSamples[0]
        setSelectedSampleId(first.id)
        setSampleName(first.name)
        setSampleTags(first.tags.join(', '))
        setSampleContent(first.content)
        setSampleVersion(first.version)
      }
      setProjectLoaded(true)
    } catch (err) {
      setError(errorText(err, '加载项目创作资料失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void loadPresetStore() }, [loadPresetStore])
  useEffect(() => { void loadBundle() }, [loadBundle])


  // --- 项目级：准则操作 ---
  const saveRules = async (): Promise<boolean> => {
    if (!sessionId || isReadOnly || savingRules) return false
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
      showToast('全书创作规则已成功保存', 'success')
      return true
    } catch (err) {
      setError(errorText(err, '保存创作规则失败'))
      return false
    } finally {
      setSavingRules(false)
    }
  }

  const saveRulesAndPreview = async () => {
    if (await saveRules()) onPreview?.()
  }

  // --- 项目级：指令预设操作 ---
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
    if (!sessionId || isReadOnly) return
    if (!presetName.trim()) {
      setError('预设名称不能为空')
      return
    }
    if (!presetInstruction.trim()) {
      setError('指令正文不能为空')
      return
    }

    try {
      setSavingPreset(true)
      setError('')
      if (isNewPreset || !selectedPresetId) {
        const created = await window.novelAgent.preset.create({
          sessionId,
          taskType: presetType,
          name: presetName.trim(),
          instruction: presetInstruction
        })
        setSelectedPresetId(created.id)
        setPresetVersion(created.version)
        setIsNewPreset(false)
      } else {
        const updated = await window.novelAgent.preset.update({
          sessionId,
          presetId: selectedPresetId,
          name: presetName.trim(),
          instruction: presetInstruction,
          expectedVersion: presetVersion
        })
        setPresetVersion(updated.version)
      }

      const list = await window.novelAgent.preset.list({
        sessionId,
        taskType: taskFilter === 'all' ? undefined : taskFilter
      })
      setPresets(list)
      showToast('指令预设已成功保存', 'success')
    } catch (err) {
      setError(errorText(err, '保存指令预设失败'))
    } finally {
      setSavingPreset(false)
    }
  }

  const deletePreset = async () => {
    if (!sessionId || isReadOnly || !selectedPresetId || isNewPreset) return
    try {
      setError('')
      await window.novelAgent.preset.delete({
        sessionId,
        presetId: selectedPresetId,
        expectedVersion: presetVersion
      })
      setSelectedPresetId(null)
      const list = await window.novelAgent.preset.list({
        sessionId,
        taskType: taskFilter === 'all' ? undefined : taskFilter
      })
      setPresets(list)
      if (list.length > 0) selectPreset(list[0])
      showToast('指令预设已删除', 'info')
    } catch (err) {
      setError(errorText(err, '删除指令预设失败'))
    }
  }

  const resetDefaultPresets = async () => {
    if (!sessionId || isReadOnly || resettingPresets) return
    try {
      setResettingPresets(true)
      setError('')
      const list = await window.novelAgent.preset.resetDefaults({ sessionId })
      setPresets(list)
      if (list.length > 0) selectPreset(list[0])
      showToast('已载入最新默认指令预设', 'success')
    } catch (err) {
      setError(errorText(err, '恢复默认指令预设失败'))
    } finally {
      setResettingPresets(false)
    }
  }

  // --- 项目级：文风样本操作 ---
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
    setSampleName('新建文风样本')
    setSampleTags('')
    setSampleContent('')
    setSampleVersion(1)
    setError('')
  }

  const saveSample = async () => {
    if (!sessionId || isReadOnly) return
    if (!sampleName.trim()) {
      setError('样本名称不能为空')
      return
    }
    if (!sampleContent.trim()) {
      setError('样本正文不能为空')
      return
    }

    const tags = sampleTags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      setSavingSample(true)
      setError('')
      if (isNewSample || !selectedSampleId) {
        const created = await window.novelAgent.styleSample.create({
          sessionId,
          name: sampleName.trim(),
          tags,
          content: sampleContent
        })
        setSelectedSampleId(created.id)
        setSampleVersion(created.version)
        setIsNewSample(false)
      } else {
        const updated = await window.novelAgent.styleSample.update({
          sessionId,
          sampleId: selectedSampleId,
          name: sampleName.trim(),
          tags,
          content: sampleContent,
          expectedVersion: sampleVersion
        })
        setSampleVersion(updated.version)
      }

      const list = await window.novelAgent.styleSample.list({ sessionId })
      setSamples(list)
      showToast('文风样本已保存', 'success')
    } catch (err) {
      setError(errorText(err, '保存风格样本失败'))
    } finally {
      setSavingSample(false)
    }
  }

  const deleteSample = async () => {
    if (!sessionId || isReadOnly || !selectedSampleId || isNewSample) return
    try {
      setError('')
      await window.novelAgent.styleSample.delete({
        sessionId,
        sampleId: selectedSampleId,
        expectedVersion: sampleVersion
      })
      setSelectedSampleId(null)
      const list = await window.novelAgent.styleSample.list({ sessionId })
      setSamples(list)
      if (list.length > 0) selectSample(list[0])
      showToast('文风样本已删除', 'info')
    } catch (err) {
      setError(errorText(err, '删除风格样本失败'))
    }
  }

  const requestClose = () => {
    if (savingPresets) return
    if (rulesDirty || presetsDirty) {
      setIsDiscardConfirmOpen(true)
      return
    }
    onClose()
  }

  const filteredPresets = presets.filter((p) => taskFilter === 'all' || p.taskType === taskFilter)
  const selectedPreset = presets.find((p) => p.id === selectedPresetId)
  const selectedSample = samples.find((s) => s.id === selectedSampleId)
  const tabClassName = 'inline-flex items-center gap-1.5 rounded-t-lg border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-[#7d6b59] data-[state=active]:border-[#2d6a4f] data-[state=active]:bg-[#f4ece1] data-[state=active]:text-[#2d6a4f] disabled:opacity-50'

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept=".json"
        onChange={(e) => void handleFileSelect(e)}
        className="hidden"
      />

      {importingModalPreset && (
        <Dialog open onOpenChange={(open) => { if (!open) setImportingModalPreset(null) }}>
          <DialogContent frame={false} className="flex flex-col w-[85vw] max-w-3xl h-[80vh] overflow-hidden bg-[#faf8f5] text-[#2c2523] border border-[#dacdbe] rounded-2xl shadow-2xl" closeLabel="取消导入">
            <DialogHeader className="px-5 py-3 border-b border-[#e5ddd3] bg-[#f7f2ea]">
              <DialogTitle className="text-base font-bold text-[#2c2523]">导入酒馆预设预览与微调</DialogTitle>
              <DialogDescription className="text-xs text-[#7d6b59] mt-0.5">
                已自动将酒馆宏（如 &#123;&#123;user&#125;&#125; -&gt; 作者）与角色扮演提示转换为小说语境。请核对 Block 并勾选所需内容：
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 p-5 space-y-4 overflow-hidden flex flex-col">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#2c2523]">导入后的预设名称</label>
                <Input
                  value={importingModalPreset.name}
                  onChange={(e) => setImportingModalPreset({ ...importingModalPreset, name: e.target.value })}
                  className="text-xs border-[#dacdbe]"
                />
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <span className="text-xs font-semibold text-[#2c2523] mb-1.5">包含的 Block 列表 ({importingModalPreset.blocks.length})：</span>
                <ScrollArea className="flex-1 min-h-0 pr-2">
                  <div className="space-y-2 pb-2">
                    {importingModalPreset.blocks.map((block) => (
                      <Card key={block.id} className="p-3 rounded-lg border-[#dacdbe] bg-white space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={importSelectedBlocks[block.id] ?? block.enabled}
                              onChange={(e) => setImportSelectedBlocks((prev) => ({ ...prev, [block.id]: e.target.checked }))}
                              className="h-4 w-4 accent-[#2d6a4f]"
                            />
                            <span className="text-xs font-semibold text-[#2c2523]">{block.name}</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">{block.role}</Badge>
                            {block.position === 'in_chat' ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">In-Chat (Depth {block.depth})</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">相对顺序</Badge>
                            )}
                            {block.marker && (
                              <Badge variant="outline" className="text-[10px] border-[#2d6a4f]/30 text-[#2d6a4f] bg-emerald-50">{block.marker}</Badge>
                            )}
                          </div>
                        </div>
                        {block.content && (
                          <div className="text-[11px] font-mono text-[#7d6b59] bg-[#faf8f5] p-2 rounded border border-[#e5ddd3] max-h-20 overflow-y-auto whitespace-pre-wrap">
                            {block.content}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <DialogFooter className="px-5 py-3 border-t border-[#e5ddd3] bg-[#f7f2ea] flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setImportingModalPreset(null)} className="text-xs">取消</Button>
              <Button size="sm" onClick={handleConfirmImport} className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs">确认导入并设为当前活跃预设</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open onOpenChange={(open) => { if (!open) requestClose() }}>
        <DialogContent frame={false} closeLabel="关闭" className="flex flex-col w-[94vw] max-w-[94vw] h-[92vh] [&>[data-slot=dialog-content]]:flex-1 [&>[data-slot=dialog-content]]:h-full [&>[data-slot=dialog-content]]:min-h-0 bg-[#faf8f5] text-[#2c2523] border border-[#dacdbe] rounded-2xl shadow-2xl overflow-hidden">
          {!isFocusMode && (
            <DialogHeader className="px-4 py-2.5 border-b border-[#e5ddd3] bg-[#f7f2ea] flex flex-row items-center justify-between gap-4 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[#2d6a4f]/10 text-[#2d6a4f]"><Sliders size={18} /></div>
                  <DialogTitle className="text-base font-bold font-serif text-[#2c2523]">提示词与创作设置</DialogTitle>
                </div>
                <DialogDescription className="text-xs text-[#7d6b59] mt-1">全局预设用于所有作品创作任务；规则、预设与样本仅用于当前作品。</DialogDescription>
              </div>
              {sessionId && onPreview && (
                <Button variant="outline" size="sm" disabled={presetsDirty || rulesDirty || savingPresets} onClick={onPreview} title={presetsDirty || rulesDirty ? '先保存修改，再查看上下文' : '查看当前任务使用的已保存设置与创作资料'} className="text-xs border-[#2d6a4f]/40 text-[#2d6a4f] hover:bg-emerald-50">
                  <Sparkles size={13} className="mr-1" />查看上下文
                </Button>
              )}
            </DialogHeader>
          )}
          {error && (
            <div role="alert" className="mx-4 mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3 shrink-0">
              <span className="flex items-center gap-2"><AlertCircle size={14} />{error}</span>
              {!projectLoaded && sessionId && <Button size="sm" variant="ghost" disabled={loading} onClick={() => void loadBundle()}>重新加载作品资料</Button>}
            </div>
          )}
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="flex flex-1 flex-col min-h-0 overflow-hidden px-4 pt-2">
            {!isFocusMode && (
              <TabsList className="flex border-b border-[#e5ddd3] bg-transparent p-0 gap-1 shrink-0">
                <TabsTrigger value="settings" className={tabClassName}><Sliders size={14} />预设与提示词{presetsDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="有未保存的修改" />}</TabsTrigger>
                {sessionId && <>
                  <TabsTrigger value="rules" disabled={!projectLoaded} className={tabClassName}><BookOpen size={14} />全书创作规则{rulesDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="有未保存的修改" />}</TabsTrigger>
                  <TabsTrigger value="presets" disabled={!projectLoaded} className={tabClassName}><Terminal size={14} />指令预设库<Badge variant="outline" className="text-[10px] border-[#dacdbe]">{presets.length}</Badge></TabsTrigger>
                  <TabsTrigger value="samples" disabled={!projectLoaded} className={tabClassName}><FileText size={14} />文风样本库<Badge variant="outline" className="text-[10px] border-[#dacdbe]">{samples.length}</Badge></TabsTrigger>
                </>}
              </TabsList>
            )}
            <TabsContent value="settings" className="flex flex-1 min-h-0 flex-col gap-3 py-3 overflow-hidden">
              <ScrollArea className="flex-1 min-h-0 pr-2">
                <div className="max-w-4xl space-y-3 pb-8">
                  {/* 顶部工具栏与预设选择 */}
                  <Card className="p-4 rounded-xl border-[#dacdbe] bg-white space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                        <label htmlFor="active-preset-select" className="text-xs font-semibold text-[#2c2523] shrink-0">当前活跃预设：</label>
                        {presetStoreDraft && presetStoreDraft.presets.length > 0 ? (
                          <Select
                            value={activePreset?.id ?? ''}
                            onValueChange={(val) => { if (typeof val === 'string') handleSelectActivePreset(val) }}
                            disabled={savingPresets}
                          >
                            <SelectTrigger id="active-preset-select" aria-label="活跃预设选择" className="text-xs border-[#dacdbe] flex-1 max-w-xs">
                              <SelectValue placeholder="选择活跃预设..." />
                            </SelectTrigger>
                            <SelectContent>
                              {presetStoreDraft.presets.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-[#a89887]">尚未创建或导入预设</span>
                        )}
                        {savedPresetStore && (
                          <Badge variant="outline" className="text-[10px] border-[#dacdbe] shrink-0">
                            当前生效：{savedPresetStore.presets.find((p) => p.id === savedPresetStore.activePresetId)?.name ?? '无'}
                          </Badge>
                        )}
                        {presetsDirty && <span className="text-[11px] text-amber-700 shrink-0">待保存</span>}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={savingPresets}
                          className="text-xs border-[#dacdbe] hover:bg-[#efe6da]"
                        >
                          <Upload size={13} className="mr-1" />导入酒馆预设 (.json)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCreateBlankPreset}
                          disabled={savingPresets}
                          className="text-xs border-[#dacdbe] hover:bg-[#efe6da]"
                        >
                          <Plus size={13} className="mr-1" />新建空白预设
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleExportActivePreset}
                          disabled={!activePreset || savingPresets}
                          className="text-xs text-[#7d6b59] hover:bg-[#efe6da]"
                          title="导出当前活跃预设为 JSON 文件"
                        >
                          <Download size={13} className="mr-1" />导出
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { if (activePreset) setPresetToDelete(activePreset.id) }}
                          disabled={!activePreset || savingPresets}
                          className="text-xs text-red-600 hover:bg-red-50"
                          title="删除当前预设"
                        >
                          <Trash2 size={13} className="mr-1" />删除
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {presetError && (
                    <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700">
                      <p>{presetError}</p>
                      <Button variant="ghost" size="sm" className="mt-2 text-xs" disabled={loadingPresets} onClick={() => void loadPresetStore()}><RefreshCw size={13} className="mr-1" />重新加载</Button>
                    </div>
                  )}

                  {presetWarnings.map((warning, index) => (
                    <div role="alert" key={`${index}-${warning}`} className="flex gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800"><AlertCircle size={14} className="shrink-0" /><span>{warning}</span></div>
                  ))}

                  {/* 空状态引导界面 */}
                  {!loadingPresets && (!presetStoreDraft || presetStoreDraft.presets.length === 0) && (
                    <Card className="p-8 text-center rounded-xl border border-dashed border-[#dacdbe] bg-white space-y-4">
                      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-[#2d6a4f] flex items-center justify-center">
                        <Sliders size={24} />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold text-[#2c2523]">尚未导入或创建预设</h3>
                        <p className="text-xs text-[#7d6b59] max-w-md mx-auto leading-relaxed">
                          本项目已升级为纯预设驱动的提示词架构。您可以直接导入 SillyTavern (酒馆) 的预设 JSON 文件（系统将自动完成宏替换与去杂质），或者新建一套空白预设。
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-3 pt-2">
                        <Button onClick={() => fileInputRef.current?.click()} className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs">
                          <Upload size={13} className="mr-1.5" />导入酒馆预设 (.json)
                        </Button>
                        <Button variant="outline" onClick={handleCreateBlankPreset} className="text-xs border-[#dacdbe]">
                          <Plus size={13} className="mr-1.5" />新建空白预设
                        </Button>
                      </div>
                    </Card>
                  )}

                  {/* 活跃预设的 Block 列表 */}
                  {!loadingPresets && activePreset && (
                    <div className="space-y-3">
                      {/* 预设名称与描述卡片 */}
                      <Card className="p-4 rounded-xl border-[#dacdbe] bg-white space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-[#2c2523]">预设名称</label>
                            <Input
                              value={activePreset.name}
                              disabled={savingPresets}
                              onChange={(e) => updateActivePreset((p) => ({ ...p, name: e.target.value }))}
                              placeholder="预设名称..."
                              className="text-xs border-[#dacdbe]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-[#2c2523]">描述说明</label>
                            <Input
                              value={activePreset.description ?? ''}
                              disabled={savingPresets}
                              onChange={(e) => updateActivePreset((p) => ({ ...p, description: e.target.value }))}
                              placeholder="预设用途描述..."
                              className="text-xs border-[#dacdbe]"
                            />
                          </div>
                        </div>
                      </Card>

                      <div className="flex items-center justify-between text-xs text-[#7d6b59] px-1">
                        <span className="font-semibold text-[#2c2523]">提示词 Block 列表 ({activePreset.blocks.length} 项)</span>
                        <span>按顺序注入；设置会话深度注入时将在对应历史位置插入</span>
                      </div>

                      {activePreset.blocks.map((block, index) => {
                        const isExpanded = expandedBlocks[block.id] ?? false
                        const isStructuralMarker = block.marker === 'marker.history' || block.marker === 'marker.task'
                        return (
                          <Card key={block.id} className="p-3.5 rounded-xl border-[#dacdbe] bg-white space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                                <input
                                  id={`prompt-block-${block.id}`}
                                  type="checkbox"
                                  role="switch"
                                  aria-label={block.name}
                                  checked={block.enabled}
                                  disabled={savingPresets}
                                  onChange={(e) => handleUpdateBlock(block.id, { enabled: e.target.checked })}
                                  className="h-4 w-4 accent-[#2d6a4f] cursor-pointer"
                                />
                                <Input
                                  value={block.name}
                                  disabled={savingPresets}
                                  onChange={(e) => handleUpdateBlock(block.id, { name: e.target.value })}
                                  className="h-7 text-xs font-medium w-44 border-[#dacdbe]"
                                  placeholder="Block 名称"
                                />
                                {block.marker && (
                                  <Badge variant="outline" className="text-[10px] border-[#2d6a4f]/30 text-[#2d6a4f] bg-emerald-50">
                                    {PRESET_MARKER_OPTIONS.find((m) => m.value === block.marker)?.label ?? block.marker}
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Select
                                  value={block.role}
                                  disabled={savingPresets}
                                  onValueChange={(val) => handleUpdateBlock(block.id, { role: val as any })}
                                >
                                  <SelectTrigger className="h-7 text-xs w-28 border-[#dacdbe]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PRESET_ROLE_OPTIONS.map((r) => (
                                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                <Select
                                  value={isStructuralMarker ? 'relative' : block.position}
                                  disabled={savingPresets || isStructuralMarker}
                                  onValueChange={(val) => handleUpdateBlock(block.id, { position: val as any })}
                                >
                                  <SelectTrigger className="h-7 text-xs w-32 border-[#dacdbe]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PRESET_POSITION_OPTIONS.map((pos) => (
                                      <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                {block.position === 'in_chat' && !isStructuralMarker && (
                                  <div className="flex items-center gap-1 text-[11px] text-[#7d6b59]">
                                    <span>深度:</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={block.depth}
                                      disabled={savingPresets}
                                      onChange={(e) => handleUpdateBlock(block.id, { depth: Math.max(0, parseInt(e.target.value) || 0) })}
                                      className="h-7 w-14 text-xs border-[#dacdbe]"
                                    />
                                  </div>
                                )}

                                <Select
                                  value={block.marker ?? 'none'}
                                  disabled={savingPresets}
                                  onValueChange={(val) => {
                                    const marker = typeof val === 'string' && val !== 'none' ? val : undefined
                                    handleUpdateBlock(block.id, {
                                      marker,
                                      ...(marker === 'marker.history' || marker === 'marker.task'
                                        ? { position: 'relative', depth: 0 }
                                        : {})
                                    })
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs w-36 border-[#dacdbe]">
                                    <SelectValue placeholder="选择资料插槽..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PRESET_MARKER_OPTIONS.map((m) => (
                                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                <div className="flex items-center gap-0.5 border-l border-[#dacdbe] pl-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={index === 0 || savingPresets}
                                    onClick={() => handleMoveBlock(index, 'up')}
                                    className="h-7 w-7 p-0 text-[#7d6b59]"
                                    title="上移"
                                  >
                                    <ArrowUp size={13} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={index === activePreset.blocks.length - 1 || savingPresets}
                                    onClick={() => handleMoveBlock(index, 'down')}
                                    className="h-7 w-7 p-0 text-[#7d6b59]"
                                    title="下移"
                                  >
                                    <ArrowDown size={13} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={savingPresets}
                                    onClick={() => handleDeleteBlock(block.id)}
                                    className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                                    title="删除此 Block"
                                  >
                                    <Trash2 size={13} />
                                  </Button>
                                </div>
                              </div>
                            </div>

                            <div>
                              <button
                                type="button"
                                onClick={() => setExpandedBlocks((prev) => ({ ...prev, [block.id]: !isExpanded }))}
                                className="text-xs text-[#2d6a4f] hover:underline flex items-center gap-0.5 cursor-pointer py-0.5"
                              >
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {isExpanded ? '收起正文' : `查看/编辑正文 (${block.content.length} 字)`}
                              </button>

                              {isExpanded && (
                                <div className="mt-2 space-y-1">
                                  <textarea
                                    className="w-full h-28 p-2.5 text-xs font-serif leading-relaxed rounded-lg border border-[#dacdbe] bg-[#faf8f5] focus:bg-white focus:border-[#2d6a4f] focus:outline-none resize-y text-[#2c2523]"
                                    value={block.content}
                                    disabled={savingPresets}
                                    placeholder="输入该 Block 的提示词正文..."
                                    onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                                  />
                                  <p className="text-[10px] text-[#7d6b59]">
                                    宏提示：&#123;&#123;user&#125;&#125; (作者), &#123;&#123;char&#125;&#125; (叙述者), &lt;world_info&gt; (设定库), &lt;chat_history&gt; (历史), &lt;input&gt; (任务)
                                  </p>
                                </div>
                              )}
                            </div>
                          </Card>
                        )
                      })}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddBlock}
                        disabled={savingPresets}
                        className="text-xs border-[#dacdbe] border-dashed hover:bg-[#efe6da] w-full py-2"
                      >
                        <Plus size={13} className="mr-1" />添加提示词 Block
                      </Button>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-between shrink-0 pt-2 border-t border-[#e5ddd3]">
                <span role="status" className="text-xs text-[#7d6b59]">
                  {savingPresets ? '正在保存预设库…' : presetsDirty ? '修改尚未生效，请保存。' : presetWarnings.length > 0 ? presetWarnings[0] : savedPresetStore ? '显示的是当前生效设置。' : ''}
                </span>
                <Button
                  size="sm"
                  disabled={loadingPresets || savingPresets || !presetStoreDraft || !presetsNeedSave}
                  onClick={() => void savePresetStore()}
                  className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
                >
                  <Check size={14} className="mr-1" />{savingPresets ? '保存中…' : '保存全局设置'}
                </Button>
              </div>
            </TabsContent>

          <TabsContent value="rules" className="flex flex-1 min-h-0 gap-3 py-2.5 overflow-hidden">
            <aside className="flex w-52 flex-col gap-1.5 border-r border-[#e5ddd3] pr-3 shrink-0 overflow-hidden h-full min-h-0">
              <span className="text-[11px] font-bold text-[#54473b] shrink-0">大纲导航</span>
              <ScrollArea className="flex-1 min-h-0 w-full">
                {rulesOutline.length === 0 ? (
                  <p className="text-[11px] text-[#a89887] leading-relaxed pr-2">
                    用 <span className="font-mono text-[#7d6b59]">## 小标题</span> 组织准则后，这里会自动生成可跳转的目录。
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5 pr-1">
                    {rulesOutline.map((heading, index) => (
                      <button
                        key={`${heading.offset}-${index}`}
                        type="button"
                        onClick={() => rulesEditorRef.current?.scrollToOffset(heading.offset)}
                        title={heading.text}
                        style={{ paddingLeft: `${(heading.level - 1) * 8 + 6}px` }}
                        className="text-left text-[11px] leading-snug rounded py-1 pr-1.5 text-[#7d6b59] hover:bg-[#efe6da] hover:text-[#2d6a4f] transition-colors truncate cursor-pointer"
                      >
                        {heading.text}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </aside>

            <main className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden h-full">
              <div className="flex flex-wrap items-center gap-1.5 shrink-0 text-xs text-[#7d6b59]">
                <span
                  className="font-semibold text-[#2c2523] whitespace-nowrap mr-1"
                  title="这些规则只用于当前作品的创作上下文"
                >
                  全书创作规则
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#efe6da] text-[#54473b] whitespace-nowrap">
                  项目级 · 仅本作品
                </span>
                <span className="font-mono text-[11px] bg-[#efe6da]/60 px-2 py-0.5 rounded border border-[#dacdbe]/60 whitespace-nowrap">
                  {rulesContent.length} 字
                </span>

                {showRuleTools && (
                  <div className="flex flex-wrap items-center gap-1.5 w-full order-last mt-1">
                    <MacroReferenceList />
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-[200px] rounded-xl border border-[#dacdbe] bg-white overflow-hidden shadow-inner">
                <ProseEditor
                  value={rulesContent}
                  onChange={setRulesContent}
                  onSave={() => void saveRules()}
                  readOnly={isReadOnly}
                  handle={rulesEditorRef}
                  placeholderText="输入本作品的创作规则（支持 Markdown，支持 Tab 缩进，Ctrl+F 查找）..."
                  className="flex-1 min-h-0"
                />
              </div>

              <div className="flex items-center justify-between shrink-0 pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowRuleTools(!showRuleTools)}
                    className="text-xs text-[#7d6b59] hover:bg-[#efe6da]"
                  >
                    {showRuleTools ? '隐藏可用宏' : '查看可用宏'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsFocusMode(!isFocusMode)}
                    className="text-xs text-[#7d6b59] hover:bg-[#efe6da]"
                    title="切换全屏沉浸专注编辑模式"
                  >
                    {isFocusMode ? <Minimize2 size={13} className="mr-1" /> : <Maximize2 size={13} className="mr-1" />}
                    {isFocusMode ? '退出专注' : '专注模式'}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  {onPreview && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingRules || isReadOnly}
                      onClick={() => void saveRulesAndPreview()}
                      className="text-xs border-[#dacdbe] hover:bg-[#efe6da]"
                      title="保存规则并打开当前任务的上下文预览"
                    >
                      保存并预览效果
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={savingRules || isReadOnly || !rulesDirty}
                    onClick={() => void saveRules()}
                    className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
                  >
                    <Check size={14} className="mr-1" />
                    {savingRules ? '保存中...' : '保存全书准则'}
                  </Button>
                </div>
              </div>
            </main>
          </TabsContent>

          {/* ========================================================= */}
          {/* 3. 指令预设库 (项目级) */}
          {/* ========================================================= */}
          <TabsContent value="presets" className="flex flex-1 min-h-0 gap-3 py-2.5 overflow-hidden">
            <aside className="flex w-64 flex-col gap-2 border-r border-[#e5ddd3] pr-3 shrink-0 overflow-hidden h-full min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-[#54473b]">指令预设</span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsResetConfirmOpen(true)}
                    disabled={isReadOnly || resettingPresets}
                    className="h-6 text-[11px] px-2 border-[#dacdbe] hover:bg-[#efe6da]"
                    title="用最新默认指令预设替换当前项目中的全部预设"
                  >
                    <RefreshCw size={11} className={`mr-1 ${resettingPresets ? 'animate-spin' : ''}`} />
                    恢复默认
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={startNewPreset}
                    disabled={isReadOnly}
                    className="h-6 text-[11px] px-2 border-[#dacdbe] hover:bg-[#efe6da]"
                  >
                    <Plus size={12} className="mr-1" />
                    新建
                  </Button>
                </div>
              </div>

              <Select
                value={taskFilter}
                onValueChange={(val) => setTaskFilter(val as typeof taskFilter)}
              >
                <SelectTrigger className="h-7 text-xs bg-white border-[#dacdbe] shrink-0">
                  <SelectValue placeholder="筛选任务类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部任务类型</SelectItem>
                  <SelectItem value="continue">续写 (continue)</SelectItem>
                  <SelectItem value="rewrite">改写 (rewrite)</SelectItem>
                  <SelectItem value="polish">润色 (polish)</SelectItem>
                  <SelectItem value="chat">问答 (chat)</SelectItem>
                  <SelectItem value="knowledge">知识抽取 (knowledge)</SelectItem>
                  <SelectItem value="report">文学报告 (report)</SelectItem>
                  <SelectItem value="style_distill">文风蒸馏 (style_distill)</SelectItem>
                  <SelectItem value="book_summary">全书总结 (book_summary)</SelectItem>
                </SelectContent>
              </Select>

              <ScrollArea className="flex-1 min-h-0 w-full pr-1">
                <div className="flex flex-col gap-1.5">
                  {filteredPresets.map((preset) => {
                    const isSelected = selectedPresetId === preset.id
                    return (
                      <Card
                        key={preset.id}
                        onClick={() => selectPreset(preset)}
                        className={`cursor-pointer p-2 transition-all text-xs border rounded-xl ${
                          isSelected
                            ? 'border-[#2d6a4f] bg-[#f2ebe0] shadow-xs'
                            : 'border-[#dacdbe]/70 hover:bg-[#f7f2ea] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <strong className="truncate font-medium text-[#2c2523] text-xs">
                            {preset.name}
                          </strong>
                          <span className="text-[10px] px-1 py-0.5 rounded bg-[#efe6da] text-[#54473b] shrink-0">
                            {taskTypeLabel[preset.taskType] || preset.taskType}
                          </span>
                        </div>
                      </Card>
                    )
                  })}
                  {filteredPresets.length === 0 && (
                    <p className="text-[11px] text-[#a89887] p-2">暂无该分类的指令预设。</p>
                  )}
                </div>
              </ScrollArea>
            </aside>

            <main className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden h-full">
              {isNewPreset || selectedPreset ? (
                <>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="预设名称..."
                      className="text-xs bg-white border-[#dacdbe] rounded-lg max-w-sm h-8"
                      disabled={isReadOnly}
                    />
                    <Select
                      value={presetType}
                      onValueChange={(val) => setPresetType(val as typeof presetType)}
                      disabled={isReadOnly || !isNewPreset}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs bg-white border-[#dacdbe]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="continue">正文续写</SelectItem>
                        <SelectItem value="rewrite">选区改写</SelectItem>
                        <SelectItem value="polish">选区润色</SelectItem>
                        <SelectItem value="chat">工作台问答</SelectItem>
                        <SelectItem value="knowledge">设定提取</SelectItem>
                        <SelectItem value="report">文学分析</SelectItem>
                        <SelectItem value="style_distill">文风蒸馏</SelectItem>
                        <SelectItem value="book_summary">全书总结</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-h-[200px] rounded-xl border border-[#dacdbe] bg-white overflow-hidden shadow-inner">
                    <ProseEditor
                      value={presetInstruction}
                      onChange={setPresetInstruction}
                      onSave={() => void savePreset()}
                      readOnly={isReadOnly}
                      handle={presetEditorRef}
                      placeholderText="输入指令提示词正文..."
                      className="flex-1 min-h-0"
                    />
                  </div>

                  <div className="flex items-center justify-between shrink-0 pt-1">
                    {!isNewPreset && selectedPresetId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() => void deletePreset()}
                        className="text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={13} className="mr-1" />
                        删除预设
                      </Button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={savingPreset || isReadOnly}
                        onClick={() => void savePreset()}
                        className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
                      >
                        <Check size={14} className="mr-1" />
                        {savingPreset ? '保存中...' : '保存预设'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="m-auto text-xs text-[#7d6b59]">请选择或新建一个指令预设</div>
              )}
            </main>
          </TabsContent>

          {/* ========================================================= */}
          {/* 4. 文风样本库 (项目级) */}
          {/* ========================================================= */}
          <TabsContent value="samples" className="flex flex-1 min-h-0 gap-3 py-2.5 overflow-hidden">
            <aside className="flex w-64 flex-col gap-2 border-r border-[#e5ddd3] pr-3 shrink-0 overflow-hidden h-full min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-[#54473b]">文风样本</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startNewSample}
                  disabled={isReadOnly}
                  className="h-6 text-[11px] px-2 border-[#dacdbe] hover:bg-[#efe6da]"
                >
                  <Plus size={12} className="mr-1" />
                  新建
                </Button>
              </div>

              <ScrollArea className="flex-1 min-h-0 w-full pr-1">
                <div className="flex flex-col gap-1.5">
                  {samples.map((sample) => {
                    const isSelected = selectedSampleId === sample.id
                    return (
                      <Card
                        key={sample.id}
                        onClick={() => selectSample(sample)}
                        className={`cursor-pointer p-2 transition-all text-xs border rounded-xl ${
                          isSelected
                            ? 'border-[#2d6a4f] bg-[#f2ebe0] shadow-xs'
                            : 'border-[#dacdbe]/70 hover:bg-[#f7f2ea] bg-white'
                        }`}
                      >
                        <strong className="truncate font-medium text-[#2c2523] block text-xs">
                          {sample.name}
                        </strong>
                        {sample.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sample.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1 py-0.2 rounded bg-[#efe6da] text-[#54473b]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>
                    )
                  })}
                  {samples.length === 0 && (
                    <p className="text-[11px] text-[#a89887] p-2">暂无文风样本。</p>
                  )}
                </div>
              </ScrollArea>
            </aside>

            <main className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden h-full">
              {isNewSample || selectedSample ? (
                <>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      value={sampleName}
                      onChange={(e) => setSampleName(e.target.value)}
                      placeholder="样本名称..."
                      className="text-xs bg-white border-[#dacdbe] rounded-lg max-w-xs h-8"
                      disabled={isReadOnly}
                    />
                    <Input
                      value={sampleTags}
                      onChange={(e) => setSampleTags(e.target.value)}
                      placeholder="标签 (逗号分隔)..."
                      className="text-xs bg-white border-[#dacdbe] rounded-lg max-w-xs h-8"
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="flex-1 min-h-[200px] rounded-xl border border-[#dacdbe] bg-white overflow-hidden shadow-inner">
                    <ProseEditor
                      value={sampleContent}
                      onChange={setSampleContent}
                      onSave={() => void saveSample()}
                      readOnly={isReadOnly}
                      handle={sampleEditorRef}
                      placeholderText="输入示范片段正文..."
                      className="flex-1 min-h-0"
                    />
                  </div>

                  <div className="flex items-center justify-between shrink-0 pt-1">
                    {!isNewSample && selectedSampleId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() => void deleteSample()}
                        className="text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={13} className="mr-1" />
                        删除样本
                      </Button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={savingSample || isReadOnly}
                        onClick={() => void saveSample()}
                        className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs"
                      >
                        <Check size={14} className="mr-1" />
                        {savingSample ? '保存中...' : '保存样本'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="m-auto text-xs text-[#7d6b59]">请选择或新建一个文风样本</div>
              )}
            </main>
          </TabsContent>

          </Tabs>
          <DialogFooter className="px-4 py-2 border-t border-[#e5ddd3] bg-[#f7f2ea] flex items-center justify-between shrink-0 text-xs text-[#7d6b59]">
            <span className={rulesDirty || presetsDirty ? 'text-amber-700' : ''}>{rulesDirty || presetsDirty ? '有未保存的修改' : loading ? '正在加载作品资料…' : isReadOnly && sessionId ? '当前作品为只读，全局模块仍可设置。' : '全局设置与作品资料分别保存。'}</span>
            <Button variant="ghost" disabled={savingPresets} onClick={requestClose} className="text-xs">完成并关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog isOpen={isDiscardConfirmOpen} title="放弃未保存的修改" message="全局提示词设置或全书创作规则有未保存的修改，直接关闭会丢失这些改动。" confirmText="放弃并关闭" cancelText="返回继续编辑" confirmVariant="warning" onConfirm={() => { setIsDiscardConfirmOpen(false); onClose() }} onCancel={() => setIsDiscardConfirmOpen(false)} />
      <ConfirmActionDialog
        isOpen={Boolean(presetToDelete)}
        title="删除预设"
        message={`确定要删除预设「${presetStoreDraft?.presets.find((p) => p.id === presetToDelete)?.name ?? ''}」吗？删除后需点击「保存全局设置」方可持久化生效。`}
        confirmText="删除预设"
        cancelText="取消"
        confirmVariant="danger"
        onConfirm={() => {
          if (presetToDelete) {
            handleDeleteActivePreset(presetToDelete)
            setPresetToDelete(null)
          }
        }}
        onCancel={() => setPresetToDelete(null)}
      />
      <ConfirmActionDialog
        isOpen={isResetConfirmOpen}
        title="用默认预设替换全部预设"
        message="此操作会删除当前项目中的全部指令预设，包括自定义和已编辑的内容，并载入最新默认预设。此操作不可恢复。"
        confirmText="替换全部预设"
        cancelText="取消"
        confirmVariant="warning"
        isLoading={resettingPresets}
        onConfirm={async () => {
          await resetDefaultPresets()
          setIsResetConfirmOpen(false)
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </>
  )
}
