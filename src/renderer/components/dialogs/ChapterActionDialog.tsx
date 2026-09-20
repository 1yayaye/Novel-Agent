import { motion } from 'motion/react'
import { ChapterAction } from '../../types/editor'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function ChapterActionDialog({ action, error, onTitle, onCancel, onConfirm }: { action: ChapterAction; error: string; onTitle: (title: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const { dialogRef, backdropProps } = useDialogDismiss<HTMLFormElement>({ onClose: onCancel })
  const labels = { create: '新建章节', rename: '重命名章节', split: '拆分章节', merge: '合并章节', delete: '删除章节' } as const
  const needsTitle = 'title' in action
  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.form ref={dialogRef} className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onSubmit={(event) => { event.preventDefault(); onConfirm() }} initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <h2 id="action-dialog-title">{labels[action.kind]}</h2>
        {needsTitle ? (
          <label>章节标题<input autoFocus value={action.title} onChange={(event) => onTitle(event.target.value)} /></label>
        ) : (
          <p>{action.kind === 'merge' ? '将当前章节与下一章合并。操作前将自动生成备份与快照。' : '章节将被软删除，正文不会立即从项目文件中清除。'}</p>
        )}
        {error && <p className="inline-error">{error}</p>}
        <div className="action-dialog-buttons">
          <button type="button" className="text-button" onClick={onCancel}>取消</button>
          <button className={action.kind === 'delete' ? 'danger-button' : 'primary-button'} disabled={needsTitle && !action.title.trim()}>
            {action.kind === 'delete' ? '删除章节' : '确认'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}
