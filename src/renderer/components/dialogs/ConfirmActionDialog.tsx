import React from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, AlertOctagon, Info, X } from 'lucide-react'
import { IconButton } from '../common/IconButton'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export interface ConfirmActionDialogProps {
  isOpen?: boolean
  title: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'danger' | 'primary' | 'warning'
  isLoading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmActionDialog({
  isOpen = true,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmVariant = 'danger',
  isLoading = false,
  onConfirm,
  onCancel
}: ConfirmActionDialogProps) {
  const { dialogRef, backdropProps } = useDialogDismiss<HTMLDivElement>({
    isOpen,
    onClose: onCancel
  })

  if (!isOpen) return null

  return (
    <motion.div
      className="action-dialog-layer confirm-dialog-layer"
      {...backdropProps}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ zIndex: 100 }}
    >
      <motion.div
        ref={dialogRef}
        className="action-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6 }}
        style={{ width: 440, padding: 22 }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {confirmVariant === 'danger' && <AlertOctagon size={20} color="#dc2626" />}
            {confirmVariant === 'warning' && <AlertTriangle size={20} color="#d97706" />}
            {confirmVariant === 'primary' && <Info size={20} color="#059669" />}
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
          </div>
          <IconButton label="取消" onClick={onCancel}>
            <X size={16} />
          </IconButton>
        </header>

        <div style={{ color: '#4b5563', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="text-button"
            disabled={isLoading}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={confirmVariant === 'danger' ? 'danger-button' : 'primary-button'}
            disabled={isLoading}
            onClick={() => void onConfirm()}
            autoFocus
          >
            {isLoading ? '处理中...' : confirmText}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
