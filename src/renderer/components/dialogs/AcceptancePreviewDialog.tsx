import { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import { AiFactSuggestion, KnowledgeEntry, KnowledgeKind } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { knowledgeKindLabel } from '../../utils/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { Checkbox } from '@appica/ui-react/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

export function AcceptancePreviewDialog({
  sessionId,
  suggestion,
  onClose,
  onAccepted
}: {
  sessionId: string
  suggestion: AiFactSuggestion
  onClose: () => void
  onAccepted: (entry: KnowledgeEntry) => void
}) {
  const [mode, setMode] = useState<'new' | 'merge'>('new')
  const [activeEntries, setActiveEntries] = useState<KnowledgeEntry[]>([])
  const [targetEntryId, setTargetEntryId] = useState<string>('')
  const [draftTitle, setDraftTitle] = useState(suggestion.normalizedSubject)
  const [draftKind, setDraftKind] = useState<KnowledgeKind>(suggestion.knowledgeKind)
  const [draftContent, setDraftContent] = useState(suggestion.displayText)
  const [targetExpectedVersion, setTargetExpectedVersion] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.novelAgent.knowledge
      .list({ sessionId, state: 'active' })
      .then((list) => {
        setActiveEntries(list)
        if (list.length > 0 && !targetEntryId) {
          setTargetEntryId(list[0].id)
        }
      })
      .catch(() => {})
  }, [sessionId, targetEntryId])

  const updatePreview = useCallback(async (currentMode: 'new' | 'merge', targetId?: string) => {
    try {
      setError('')
      const preview = await window.novelAgent.knowledge.previewSuggestionAcceptance({
        sessionId,
        suggestionId: suggestion.id,
        targetEntryId: currentMode === 'merge' ? (targetId || undefined) : undefined
      })
      setDraftTitle(preview.draft.title)
      setDraftKind(preview.draft.kind)
      setDraftContent(preview.draft.authorContent)
      setTargetExpectedVersion(preview.targetExpectedVersion)
    } catch (err) {
      setError(errorText(err, '生成预览失败'))
    }
  }, [sessionId, suggestion.id])

  const handleModeChange = (newMode: 'new' | 'merge') => {
    setMode(newMode)
    void updatePreview(newMode, newMode === 'merge' ? targetEntryId : undefined)
  }

  const handleTargetChange = (entryId: string) => {
    setTargetEntryId(entryId)
    if (mode === 'merge') {
      void updatePreview('merge', entryId)
    }
  }

  const handleConfirm = async () => {
    try {
      setSubmitting(true)
      setError('')
      const entry = await window.novelAgent.knowledge.acceptSuggestion({
        sessionId,
        suggestionId: suggestion.id,
        expectedSuggestionVersion: suggestion.version,
        targetEntryId: mode === 'merge' ? targetEntryId : undefined,
        targetExpectedVersion: mode === 'merge' ? (targetExpectedVersion ?? undefined) : undefined,
        draft: {
          title: draftTitle,
          kind: draftKind,
          authorContent: draftContent
        }
      })
      onAccepted(entry)
    } catch (err) {
      setError(errorText(err, '采纳失败，可能发生了版本冲突'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-2xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>采纳 AI 事实建议</DialogTitle>
          <DialogDescription>
            作者审核预览并确认后，将原子写入知识条目并更新建议状态。
          </DialogDescription>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600">{error}</p>}

        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex gap-6 rounded-xl border border-[#e5ddd3] bg-[#f5efe6] p-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={mode === 'new'}
                onCheckedChange={() => handleModeChange('new')}
              />
              <span className="text-[#2c2523] font-medium">新建独立知识条目</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={mode === 'merge'}
                disabled={activeEntries.length === 0}
                onCheckedChange={() => handleModeChange('merge')}
              />
              <span className="text-[#2c2523] font-medium">
                合并追加至现有条目 {activeEntries.length === 0 && '(暂无活跃条目)'}
              </span>
            </label>
          </div>

          {mode === 'merge' && (
            <div className="flex flex-col gap-1 text-xs">
              <label className="text-[#7d6b59] font-medium">目标知识条目</label>
              <Select
                value={targetEntryId}
                onValueChange={(val) => handleTargetChange(val as string)}
              >
                <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeEntries.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      [{knowledgeKindLabel[e.knowledgeKind]}] {e.title} (v{e.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 text-xs">
              <label className="text-[#7d6b59] font-medium">条目标题</label>
              <Input
                className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none disabled:bg-[#f5efe6]"
                value={draftTitle}
                disabled={mode === 'merge'}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <label className="text-[#7d6b59] font-medium">知识类型</label>
              <Select
                value={draftKind}
                disabled={mode === 'merge'}
                onValueChange={(val) => setDraftKind(val as KnowledgeKind)}
              >
                <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none disabled:bg-[#f5efe6]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="character">人物</SelectItem>
                  <SelectItem value="world">世界观</SelectItem>
                  <SelectItem value="timeline">时间线</SelectItem>
                  <SelectItem value="foreshadow">伏笔</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <label className="text-[#7d6b59] font-medium">最终写入作者正文 (可手工修订)</label>
            <Textarea
              className="min-h-[140px] rounded-lg border border-[#dacdbe] bg-white p-3 font-serif text-sm leading-relaxed text-[#2c2523] outline-none focus:border-[#2d6a4f]"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="正文内容..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || !draftTitle.trim()}
            onClick={() => void handleConfirm()}
          >
            <Check size={15} />
            {submitting ? '写入中...' : '确认采纳并写入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
