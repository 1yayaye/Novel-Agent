import React from 'react'
import { Send, StopCircle } from 'lucide-react'
import { Button } from '@appica/ui-react/button'

export interface PromptBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
  isStreaming?: boolean
  onCancel?: () => void
}

export function PromptBar({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = '输入问题... (Enter 发送，Shift+Enter 换行)',
  isStreaming = false,
  onCancel
}: PromptBarProps) {
  return (
    <div className="chat-input-box relative flex items-end gap-2 p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-sm transition-all focus-within:border-slate-400 dark:focus-within:border-slate-600">
      <textarea
        className="chat-input-textarea min-w-0 w-full resize-none bg-transparent text-[13px] leading-relaxed text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400"
        placeholder={placeholder}
        value={value}
        disabled={disabled || isStreaming}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!disabled && !isStreaming && value.trim()) {
              onSubmit()
            }
          }
        }}
      />
      {isStreaming ? (
        <Button
          variant="destructive"
          className="danger-button"
          style={{ height: 42, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={onCancel}
        >
          <StopCircle size={15} />
          <span>停止生成</span>
        </Button>
      ) : (
        <Button
          variant="primary"
          className="primary-button"
          style={{ height: 42, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6 }}
          disabled={disabled || !value.trim()}
          onClick={onSubmit}
        >
          <Send size={15} />
          <span>发送</span>
        </Button>
      )}
    </div>
  )
}
