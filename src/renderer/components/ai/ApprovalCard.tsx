import React from 'react'
import { Button } from '@appica/ui-react/button'

export interface ApprovalCardProps {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  disabled?: boolean
}

export function ApprovalCard({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  disabled = false
}: ApprovalCardProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
      <div className="min-w-0 flex-1">
        <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
          {title}
        </h4>
        {description && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
