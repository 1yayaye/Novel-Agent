import React from 'react'
import { Sparkles } from 'lucide-react'

export function ThinkingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-slate-600 dark:text-slate-300">
      <span className="flex shrink-0 animate-pulse text-emerald-600 dark:text-emerald-400">
        <Sparkles size={14} />
      </span>
      <span
        role="status"
        className="bg-clip-text text-[13px] font-medium whitespace-nowrap animate-pulse"
      >
        {label}
      </span>
    </div>
  )
}
