import React from 'react'

export interface SelectionActionsProps {
  children: React.ReactNode
  className?: string
}

export function SelectionActions({ children, className = '' }: SelectionActionsProps) {
  return (
    <div
      className={`flex h-9 w-fit max-w-[calc(100vw-48px)] items-center justify-center gap-0.5 overflow-hidden rounded-full bg-white dark:bg-slate-900 p-1 shadow-lg border border-slate-200 dark:border-slate-800 ${className}`}
    >
      {children}
    </div>
  )
}
