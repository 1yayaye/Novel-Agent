import React from 'react'
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter
} from '@appica/ui-react/alert-dialog'
import { Button } from '@appica/ui-react/button'
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

const variantIcon = {
  danger: <AlertOctagon size={20} className="text-red-600" />,
  warning: <AlertTriangle size={20} className="text-amber-600" />,
  primary: <Info size={20} className="text-emerald-600" />,
} as const

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
  const { dialogRef } = useDialogDismiss<HTMLDivElement>({
    isOpen,
    onClose: onCancel
  })

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent frame={false} ref={dialogRef} className="max-w-sm" role="alertdialog">
        <AlertDialogHeader className="pb-2">
          <div className="flex items-center gap-2.5">
            {variantIcon[confirmVariant]}
            <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <div className="px-6 text-[#4b5563] text-[13px] leading-[1.6]">
          {typeof message === 'string' ? <p className="m-0">{message}</p> : message}
        </div>

        <AlertDialogFooter>
          <Button variant="ghost" disabled={isLoading} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            variant={confirmVariant === 'danger' ? 'destructive' : 'primary'}
            disabled={isLoading}
            onClick={() => void onConfirm()}
            autoFocus
          >
            {isLoading ? '处理中...' : confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

