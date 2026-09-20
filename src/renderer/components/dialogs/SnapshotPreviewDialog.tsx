import { useState } from 'react'
import { motion } from 'motion/react'
import { X, RotateCcw } from 'lucide-react'
import { ChapterSnapshotDetail } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { snapshotKindLabel } from '../../utils/constants'
import { formatDate, count } from '../../utils/formatters'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function SnapshotPreviewDialog({ snapshot, onClose, onRestore }: { snapshot: ChapterSnapshotDetail; onClose: () => void; onRestore: () => void }) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [confirming, setConfirming] = useState(false)
  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="snapshot-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshot-preview-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="snapshot-preview-title">{snapshot.name || snapshot.title}</h2>
            <p>
              <span className={`kind-tag ${snapshot.snapshotKind}`}>{snapshotKindLabel[snapshot.snapshotKind] || snapshot.snapshotKind}</span>
              &nbsp;v{snapshot.chapterVersion} · {formatDate(snapshot.createdAt)} · {count(snapshot.content)} 字
            </p>
          </div>
          <IconButton label="关闭快照预览" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="snapshot-preview-body">
          <textarea readOnly value={snapshot.content} aria-label="快照内容" />
        </div>
        {confirming && (
          <div className="encoding-confirm">
            <span>恢复快照将先备份当前正文并覆盖当前章节。是否继续？</span>
            <div>
              <button type="button" className="text-button" onClick={() => setConfirming(false)}>取消</button>
              <button type="button" className="primary-button" onClick={onRestore}>确认恢复</button>
            </div>
          </div>
        )}
        <footer className="dialog-footer">
          <button type="button" className="text-button" onClick={onClose}>返回</button>
          {!confirming && (
            <button type="button" className="primary-button" onClick={() => setConfirming(true)}>
              <RotateCcw size={15} />恢复此快照
            </button>
          )}
        </footer>
      </motion.div>
    </motion.div>
  )
}
