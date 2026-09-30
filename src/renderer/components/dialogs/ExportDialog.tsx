import { useState } from 'react'
import { Check, Download } from 'lucide-react'
import { ChapterHeader, ExportFormat } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Checkbox } from '@appica/ui-react/checkbox'

export function ExportDialog({
  sessionId,
  chapters,
  canExportAnalysis,
  onClose
}: {
  sessionId: string
  chapters: ChapterHeader[]
  canExportAnalysis: boolean
  onClose: () => void
}) {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [scope, setScope] = useState<'all' | 'custom'>('all')
  const [includeAnalysis, setIncludeAnalysis] = useState(canExportAnalysis)
  const [selectedIds, setSelectedIds] = useState<string[]>(chapters.map((c) => c.id))
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [successPath, setSuccessPath] = useState<string | null>(null)

  const toggleChapter = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const runExport = async () => {
    try {
      setExporting(true)
      setError('')
      const chapterIds = scope === 'custom' ? selectedIds : undefined
      if (scope === 'custom' && (!chapterIds || chapterIds.length === 0)) {
        setError('请至少勾选一个章节')
        setExporting(false)
        return
      }
      const result = await window.novelAgent.project.export({ sessionId, format, chapterIds, includeAnalysis })
      if (result) {
        setSuccessPath(result.savedPath)
      }
    } catch (err) {
      setError(errorText(err, '导出失败，请重试'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="max-w-xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>导出小说作品</DialogTitle>
          <DialogDescription>
            导出纯文本或 Markdown，可选择章节范围并附加已生成的总结与文风样本。
          </DialogDescription>
        </DialogHeader>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        {successPath ? (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check size={24} />
            </div>
            <h3 className="text-base font-medium text-[#2c2523]">导出成功！</h3>
            <p className="max-w-md break-all rounded-lg bg-[#f5efe6] p-2 text-xs text-[#7d6b59]">
              {successPath}
            </p>
            <DialogFooter className="w-full pt-4">
              <Button onClick={onClose}>完成</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 overflow-y-auto pr-1 px-6">
              <div className="flex flex-col gap-3 rounded-xl border border-[#e5ddd3] bg-[#f5efe6] p-4 text-xs">
                <label className="font-semibold text-[#2c2523]">导出格式</label>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={format === 'txt'}
                      onCheckedChange={() => setFormat('txt')}
                    />
                    <span>纯文本 (.txt) — 标题与正文空行分隔</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={format === 'md'}
                      onCheckedChange={() => setFormat('md')}
                    />
                    <span>Markdown (.md) — 章节作为一级标题</span>
                  </label>
                </div>

                <label className="font-semibold text-[#2c2523] pt-2">导出范围</label>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={scope === 'all'}
                      onCheckedChange={() => setScope('all')}
                    />
                    <span>全书导出 (共 {chapters.length} 章)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={scope === 'custom'}
                      onCheckedChange={() => setScope('custom')}
                    />
                    <span>勾选指定章节 ({selectedIds.length} / {chapters.length})</span>
                  </label>
                </div>
                <label className={`flex items-center gap-2 pt-2 ${canExportAnalysis ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                  <Checkbox disabled={!canExportAnalysis} checked={includeAnalysis} onCheckedChange={(checked) => setIncludeAnalysis(checked === true)} />
                  <span>附加已生成的全书总结与文风样本</span>
                </label>
              </div>

              {scope === 'custom' && (
                <div className="flex flex-col gap-2 rounded-xl border border-[#e5ddd3] bg-white p-3">
                  <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2 text-xs">
                    <span className="font-medium text-[#2c2523]">选择导出章节</span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedIds(chapters.map((c) => c.id))}
                      >
                        全选
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedIds([])}
                      >
                        清空
                      </Button>
                    </div>
                  </div>
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pt-1">
                    {chapters.map((c, index) => {
                      const chapterNumber = getChapterNumber(chapters, index)
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#2c2523] hover:bg-[#f5efe6] cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedIds.includes(c.id)}
                            onCheckedChange={() => toggleChapter(c.id)}
                          />
                          <span className="truncate">
                            {chapterNumber === undefined ? '' : `${chapterNumber}. `}
                            {c.title}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button
                type="button"
                disabled={exporting || (scope === 'custom' && selectedIds.length === 0)}
                onClick={() => void runExport()}
              >
                <Download size={15} />
                {exporting ? '导出中...' : '选择位置并导出'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
