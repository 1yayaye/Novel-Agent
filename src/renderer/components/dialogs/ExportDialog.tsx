import { useState } from 'react'
import { motion } from 'motion/react'
import { Check, Download, X } from 'lucide-react'
import { Chapter, ExportFormat } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function ExportDialog({ sessionId, chapters, onClose }: { sessionId: string; chapters: Chapter[]; onClose: () => void }) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [scope, setScope] = useState<'all' | 'custom'>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>(chapters.map((c) => c.id))
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [successPath, setSuccessPath] = useState<string | null>(null)

  const toggleChapter = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id])
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
      const result = await window.novelAgent.project.export({ sessionId, format, chapterIds })
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
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="export-dialog-title">导出作品</h2>
            <p>将小说正文原子导出为 UTF-8 无 BOM 格式的文档。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        {error && <p className="inline-error dialog-error">{error}</p>}
        {successPath ? (
          <div className="export-success">
            <Check size={28} className="success-icon" />
            <h3>导出成功</h3>
            <p className="saved-path">{successPath}</p>
            <button className="primary-button" onClick={onClose}>完成</button>
          </div>
        ) : (
          <>
            <div className="export-body">
              <div className="export-options">
                <label className="option-group-label">导出格式</label>
                <div className="radio-group">
                  <label>
                    <input type="radio" name="format" value="txt" checked={format === 'txt'} onChange={() => setFormat('txt')} />
                    <span>纯文本 (.txt) — 标题与正文空行分隔</span>
                  </label>
                  <label>
                    <input type="radio" name="format" value="md" checked={format === 'md'} onChange={() => setFormat('md')} />
                    <span>Markdown (.md) — 章节作为一级标题</span>
                  </label>
                </div>
                <label className="option-group-label" style={{ marginTop: 14 }}>导出范围</label>
                <div className="radio-group">
                  <label>
                    <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />
                    <span>全书导出 (共 {chapters.length} 章)</span>
                  </label>
                  <label>
                    <input type="radio" name="scope" value="custom" checked={scope === 'custom'} onChange={() => setScope('custom')} />
                    <span>勾选指定章节 ({selectedIds.length} / {chapters.length})</span>
                  </label>
                </div>
              </div>
              {scope === 'custom' && (
                <div className="export-chapter-select">
                  <div className="select-all-row">
                    <span>选择导出章节</span>
                    <div>
                      <button type="button" className="text-button" onClick={() => setSelectedIds(chapters.map((c) => c.id))}>全选</button>
                      <button type="button" className="text-button" onClick={() => setSelectedIds([])}>清空</button>
                    </div>
                  </div>
                  <div className="chapter-checkbox-list">
                    {chapters.map((c, index) => {
                      const chapterNumber = getChapterNumber(chapters, index)
                      return (
                        <label key={c.id} className="chapter-check-item">
                          <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleChapter(c.id)} />
                          <span>{chapterNumber === undefined ? '' : `${chapterNumber}. `}{c.title}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <footer className="dialog-footer">
              <button type="button" className="text-button" onClick={onClose}>取消</button>
              <button type="button" className="primary-button" disabled={exporting || (scope === 'custom' && selectedIds.length === 0)} onClick={() => void runExport()}>
                <Download size={15} />{exporting ? '导出中...' : '选择位置并导出'}
              </button>
            </footer>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
