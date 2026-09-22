import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { LiteraryReportDetail, LiteraryReportSummary, ReportSectionType, ReportAnnotation, ReportSection } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { reportSectionTitle } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'
import { useToast } from '../common/Toast'
import { ConfirmActionDialog } from './ConfirmActionDialog'

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
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
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
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="report-dialog" role="dialog" aria-modal="true" aria-label="文学分析报告" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>文学分析报告</h2>
            <p>全书六大维度深度文学批评：主题、视角、文风、节奏结构、人物弧光与连续性</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="primary-button" disabled={isReadOnly} onClick={onLaunchNew}>
              <Sparkles size={14} />生成新报告
            </button>
            <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </header>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="report-dialog-body">
          <aside className="report-sidebar">
            <div className="panel-caption">历史分析报告 ({reports.length})</div>
            <div className="report-list">
              {reports.length === 0 ? (
                <p className="empty-hint">暂无报告，请点击右上角生成</p>
              ) : (
                reports.map((r) => (
                  <button
                    key={r.id}
                    className={`report-row ${r.id === selectedReportId ? 'selected' : ''}`}
                    onClick={() => setSelectedReportId(r.id)}
                  >
                    <div className="report-row-header">
                      <strong>文学深度分析</strong>
                      <span className={`badge-tag ${r.state === 'current' ? 'confirmed' : 'unconfirmed'}`}>
                        {r.state === 'current' ? '最新有效' : '已过时'}
                      </span>
                    </div>
                    <span className="report-time">{formatDate(r.createdAt)}</span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="report-main">
            {!reportDetail ? (
              <div className="empty-copy" style={{ textAlign: 'center', padding: '80px 0' }}>
                <p>请选择或生成一份文学分析报告</p>
              </div>
            ) : (
              <div className="report-detail-layout">
                <div className="dimension-tabs">
                  {sectionsList.map((secType) => (
                    <button
                      key={secType}
                      className={`dimension-tab ${selectedSection === secType ? 'active' : ''}`}
                      onClick={() => setSelectedSection(secType)}
                    >
                      {reportSectionTitle[secType]}
                    </button>
                  ))}
                </div>

                <div className="dimension-content-area">
                  {activeSectionData ? (
                    <div className="dimension-section-view">
                      <div className="conclusion-callout">
                        <div className="conclusion-label">
                          <CheckCircle2 size={16} />
                          <strong>核心结论提炼</strong>
                        </div>
                        <p>{activeSectionData.conclusion}</p>
                      </div>

                      <div className="markdown-report-content">
                        <h4>深度剖析与论证</h4>
                        <div className="report-text-render">{activeSectionData.content}</div>
                      </div>

                      {activeSectionData.evidences.length > 0 && (
                        <div className="report-evidences-box">
                          <h4>引用论据 ({activeSectionData.evidences.length})</h4>
                          <div className="evidence-grid">
                            {activeSectionData.evidences.map((ev) => (
                              <div key={ev.id} className="evidence-chip-card">
                                <span>第 {ev.chapterVersion} 版: "{ev.excerpt}"</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="annotations-section">
                        <h4>作者心得与批注 ({activeSectionData.annotations.length})</h4>
                        <div className="annotations-list">
                          {activeSectionData.annotations.map((ann) => (
                            <div key={ann.id} className="annotation-card">
                              {editingAnnotationId === ann.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                                  <textarea
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    rows={3}
                                    style={{ width: '100%', padding: 8, borderRadius: 3, border: '1px solid #d1d5db' }}
                                  />
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                    <button type="button" className="text-button" onClick={() => setEditingAnnotationId(null)}>取消</button>
                                    <button type="button" className="primary-button" onClick={() => void handleUpdateAnnotation(ann.id)}>保存</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="annotation-body">
                                    <p>{ann.content}</p>
                                    <span className="annotation-time">{formatDate(ann.updatedAt)}</span>
                                  </div>
                                  <div className="annotation-actions">
                                    <IconButton label="编辑批注" onClick={() => { setEditingAnnotationId(ann.id); setEditingText(ann.content) }}>
                                      <Pencil size={13} />
                                    </IconButton>
                                    <IconButton label="删除批注" onClick={() => void handleDeleteAnnotation(ann.id)}>
                                      <Trash2 size={13} />
                                    </IconButton>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="add-annotation-box">
                          <input
                            type="text"
                            placeholder="在此输入对此维度的作者批注或调整计划..."
                            value={newAnnotationText}
                            onChange={(e) => setNewAnnotationText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleAddAnnotation()
                            }}
                          />
                          <button
                            type="button"
                            className="primary-button"
                            disabled={isReadOnly || !newAnnotationText.trim()}
                            onClick={() => void handleAddAnnotation()}
                          >
                            <Plus size={13} />添加批注
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="empty-hint">该维度暂无分析数据</p>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className="dialog-footer">
          <span>报告覆盖全书六大维度，作者批注独立保存并持久关联到具体分析章节</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>

      <AnimatePresence>
        {deletingAnnotationId && (
          <ConfirmActionDialog
            key="confirm-delete-annotation"
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
      </AnimatePresence>
    </motion.div>
  )
}
