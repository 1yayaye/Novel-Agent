import { useState } from 'react'
import { motion } from 'motion/react'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function CreateSnapshotDialog({ error, onCancel, onConfirm }: { error: string; onCancel: () => void; onConfirm: (name: string) => void }) {
  const { dialogRef, backdropProps } = useDialogDismiss<HTMLFormElement>({ onClose: onCancel })
  const [name, setName] = useState('')
  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.form ref={dialogRef} className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="create-snapshot-title" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onConfirm(name.trim()) }} initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <h2 id="create-snapshot-title">创建章节快照</h2>
        <label>快照名称<input autoFocus placeholder="例如：大纲调整前、修改第2版" value={name} onChange={(event) => setName(event.target.value)} /></label>
        {error && <p className="inline-error">{error}</p>}
        <div className="action-dialog-buttons">
          <button type="button" className="text-button" onClick={onCancel}>取消</button>
          <button className="primary-button" disabled={!name.trim()}>创建快照</button>
        </div>
      </motion.form>
    </motion.div>
  )
}
