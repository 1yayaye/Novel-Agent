import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  LiteraryReportDetail,
  LiteraryReportSummary,
  ReportSectionType
} from '../../../shared/project'
import { errorText, formatDate } from '../../utils/formatters'
import { reportSectionTitle, reportStateLabel } from '../../utils/constants'
import { useToast } from '../common/Toast'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'

export function LiteraryReportsDialog({
  sessionId,
  isReadOnly,
  onClose,
  onLaunchNew
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
  onLaunchNew: () => void
}) {
  const [reports, setReports] = useState<LiteraryReportSummary[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [reportDetail, setReportDetail] = useState<LiteraryReportDetail | null>(null)
  const [selectedSection, setSelectedSection] = useState<ReportSectionType>('theme')
  const [newAnnotationText, setNewAnnotationText] = useState('')
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [deletingAnnotationId, setDeletingAnnotationId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useToast()

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.novelAgent.report.list({ sessionId })
      setReports(list)
      if (list.length > 0 && !selectedReportId) {
        setSelectedReportId(list[0].id)
      }
    } catch (err) {
      setError(errorText(err, '加载报告列表失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId, selectedReportId])

  const loadReportDetail = useCallback(async (id: string) => {
    try {
      const detail = await window.novelAgent.report.get({ sessionId, reportId: id })
      setReportDetail(detail)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  useEffect(() => {
    if (selectedReportId) {
      void loadReportDetail(selectedReportId)
    }
  }, [selectedReportId, loadReportDetail])

  const activeSectionData = reportDetail?.sections.find((s) => s.sectionType === selectedSection)

  const handleAddAnnotation = async () => {
    if (!activeSectionData || !newAnnotationText.trim()) return
    try {
      await window.novelAgent.report.addAnnotation({
        sessionId,
        reportSectionId: activeSectionData.id,
        content: newAnnotationText.trim()
      })
      setNewAnnotationText('')
      if (selectedReportId) await loadReportDetail(selectedReportId)
    } catch (err) {
      setError(errorText(err, '添加批注失败'))
    }
  }

  const handleUpdateAnnotation = async (annotationId: string) => {
    if (!editingText.trim()) return
    try {
      await window.novelAgent.report.updateAnnotation({
        sessionId,
        annotationId,
        content: editingText.trim()
      })
      setEditingAnnotationId(null)
      setEditingText('')
      if (selectedReportId) await loadReportDetail(selectedReportId)
    } catch (err) {
      setError(errorText(err, '更新批注失败'))
    }
  }

  const handleDeleteAnnotation = (annotationId: string) => {
    setDeletingAnnotationId(annotationId)
  }

  const handleConfirmDeleteAnnotation = async () => {
    if (!deletingAnnotationId) return
    setDeleteLoading(true)
    try {
      await window.novelAgent.report.deleteAnnotation({
        sessionId,
        annotationId: deletingAnnotationId
      })
      showToast('已删除作者批注', 'success')
      setDeletingAnnotationId(null)
      if (selectedReportId) await loadReportDetail(selectedReportId)
    } catch (err) {
      setError(errorText(err, '删除批注失败'))
      setDeletingAnnotationId(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  const sectionsList: ReportSectionType[] = [
    'theme',
    'narrative_perspective',
    'style',
    'pacing_and_structure',
    'character_arc',
    'continuity_issues'
  ]

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col w-[90vw] max-w-[90vw] h-[90vh]" closeLabel="关闭">
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <div>
                <DialogTitle>文学分析报告</DialogTitle>
                <DialogDescription>
                  全书六大维度深度文学批评：主题、视角、文风、节奏结构、人物弧光与连续性
                </DialogDescription>
              </div>
              <Button size="sm" disabled={isReadOnly} onClick={onLaunchNew}>
                <Sparkles size={14} />
                生成新报告
              </Button>
            </div>
          </DialogHeader>

          {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

          <div className="flex flex-1 gap-4 overflow-hidden border-t border-[#e5ddd3] pt-3 px-6">
            {/* Sidebar */}
            <aside className="flex w-64 flex-col gap-2 border-r border-[#e5ddd3] pr-3 shrink-0">
              <span className="text-xs font-semibold text-[#7d6b59]">
                历史分析报告 ({reports.length})
              </span>
              <ScrollArea className="flex-1">
                {reports.length === 0 ? (
                  <p className="p-4 text-center text-xs text-[#7d6b59]">
                    {loading ? '加载中...' : '暂无报告，请点击右上角生成'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 p-1">
                    {reports.map((r) => (
                      <Card
                        key={r.id}
                        className={`flex flex-col gap-1.5 p-3 text-left transition-colors cursor-pointer border ${
                          r.id === selectedReportId
                            ? 'border-[#2d6a4f] bg-[#e8f3ee]'
                            : 'border-[#e5ddd3] bg-white hover:border-[#dacdbe]'
                        }`}
                        onClick={() => setSelectedReportId(r.id)}
                      >
                        <div className="flex items-center justify-between">
                          <strong className="text-xs text-[#2c2523]">文学深度分析</strong>
                          <Badge variant={r.state === 'current' ? 'primary' : 'secondary'}>
                            {reportStateLabel[r.state]}
                          </Badge>
                        </div>
                        <span className="text-[10px] text-[#9c8874]">
                          {formatDate(r.createdAt)}
                        </span>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </aside>

            {/* Main Content */}
            <main className="flex flex-1 flex-col overflow-hidden">
              {!reportDetail ? (
                <div className="flex flex-1 items-center justify-center text-xs text-[#7d6b59]">
                  请选择或生成一份文学分析报告
                </div>
              ) : (
                <div className="flex flex-1 flex-col overflow-hidden gap-3">
                  <div className="flex gap-1.5 border-b border-[#e5ddd3] pb-2 text-xs">
                    {sectionsList.map((secType) => (
                      <Button
                        key={secType}
                        type="button"
                        variant={selectedSection === secType ? 'primary' : 'ghost'}
                        size="sm"
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          selectedSection === secType
                            ? 'bg-[#2d6a4f] text-white'
                            : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                        }`}
                        onClick={() => setSelectedSection(secType)}
                      >
                        {reportSectionTitle[secType]}
                      </Button>
                    ))}
                  </div>

                  <ScrollArea className="flex-1 pr-3">
                    {activeSectionData ? (
                      <div className="flex flex-col gap-4 p-1">
                        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-600 mt-0.5" />
                          <div className="flex flex-col gap-1">
                            <strong className="font-semibold text-emerald-800">核心结论提炼</strong>
                            <p className="m-0 leading-relaxed">{activeSectionData.conclusion}</p>
                          </div>
                        </div>

                        <Card className="flex flex-col gap-2 p-4 bg-white border-[#e5ddd3]">
                          <h4 className="text-xs font-semibold text-[#7d6b59]">深度剖析与论证</h4>
                          <div className="font-serif text-sm leading-relaxed text-[#2c2523] whitespace-pre-wrap">
                            {activeSectionData.content}
                          </div>
                        </Card>

                        {activeSectionData.evidences.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <h4 className="text-xs font-semibold text-[#7d6b59]">
                              引用论据 ({activeSectionData.evidences.length})
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                              {activeSectionData.evidences.map((ev) => (
                                <div
                                  key={ev.id}
                                  className="rounded-lg border border-[#e5ddd3] bg-[#faf8f5] p-2.5 text-xs italic text-[#54473b]"
                                >
                                  第 {ev.chapterVersion} 版: "{ev.excerpt}"
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-2.5 border-t border-[#e5ddd3] pt-3">
                          <h4 className="text-xs font-semibold text-[#7d6b59]">
                            作者心得与批注 ({activeSectionData.annotations.length})
                          </h4>
                          <div className="flex flex-col gap-2">
                            {activeSectionData.annotations.map((ann) => (
                              <Card key={ann.id} className="p-3 bg-white border-[#e5ddd3]">
                                {editingAnnotationId === ann.id ? (
                                  <div className="flex flex-col gap-2">
                                    <Textarea
                                      value={editingText}
                                      onChange={(e) => setEditingText(e.target.value)}
                                      rows={3}
                                      className="rounded-lg border border-[#dacdbe] p-2 text-xs text-[#2c2523] outline-none focus:border-[#2d6a4f]"
                                    />
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditingAnnotationId(null)}
                                      >
                                        取消
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => void handleUpdateAnnotation(ann.id)}
                                      >
                                        保存
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex flex-col gap-1">
                                      <p className="m-0 text-xs text-[#2c2523] leading-relaxed">
                                        {ann.content}
                                      </p>
                                      <span className="text-[10px] text-[#9c8874]">
                                        {formatDate(ann.updatedAt)}
                                      </span>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        className="h-7 w-7 text-[#7d6b59]"
                                        onClick={() => {
                                          setEditingAnnotationId(ann.id)
                                          setEditingText(ann.content)
                                        }}
                                      >
                                        <Pencil size={13} />
                                      </Button>
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        className="h-7 w-7 text-red-600 hover:text-red-700"
                                        onClick={() => handleDeleteAnnotation(ann.id)}
                                      >
                                        <Trash2 size={13} />
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </Card>
                            ))}
                          </div>

                          <div className="flex gap-2">
                            <Input
                              type="text"
                              placeholder="在此输入对此维度的作者批注或调整计划..."
                              value={newAnnotationText}
                              onChange={(e) => setNewAnnotationText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleAddAnnotation()
                              }}
                              className="flex-1 rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none focus:border-[#2d6a4f]"
                            />
                            <Button
                              size="sm"
                              disabled={isReadOnly || !newAnnotationText.trim()}
                              onClick={() => void handleAddAnnotation()}
                            >
                              <Plus size={13} />
                              添加批注
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="p-8 text-center text-xs text-[#7d6b59]">该维度暂无分析数据</p>
                    )}
                  </ScrollArea>
                </div>
              )}
            </main>
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
            <span>报告覆盖全书六大维度，作者批注独立保存并持久关联到具体分析章节</span>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deletingAnnotationId && (
        <ConfirmActionDialog
          isOpen={Boolean(deletingAnnotationId)}
          title="确认删除作者批注"
          message="确定删除该作者批注吗？删除后不可恢复。"
          confirmText="删除批注"
          confirmVariant="danger"
          isLoading={deleteLoading}
          onConfirm={handleConfirmDeleteAnnotation}
          onCancel={() => setDeletingAnnotationId(null)}
        />
      )}
    </>
  )
}
