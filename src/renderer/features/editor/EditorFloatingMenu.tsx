import React from 'react'
import { Sparkles, Wand2, Scissors, Quote, Check, X } from 'lucide-react'
import { Button } from '@appica/ui-react/button'
import type { SelectionInfo } from '../../types/editor'

export interface EditorFloatingMenuProps {
  selection: SelectionInfo | null
  onPolish?: (selectedText: string) => void
  onExpand?: (selectedText: string) => void
  onSummarize?: (selectedText: string) => void
  onWrapQuotes?: (type: 'double' | 'single' | 'angle') => void
  onClose?: () => void
}

export function EditorFloatingMenu({
  selection,
  onPolish,
  onExpand,
  onSummarize,
  onWrapQuotes,
  onClose
}: EditorFloatingMenuProps) {
  if (!selection || !selection.text.trim() || !selection.rect) {
    return null
  }

  // Calculate coordinates anchored to cursor selection
  const top = Math.max(10, selection.rect.top - 46)
  const left = Math.max(10, Math.min(window.innerWidth - 320, selection.rect.left))

  return (
    <div
      style={{ top: `${top}px`, left: `${left}px` }}
      className="fixed z-50 flex items-center gap-1 p-1 bg-[#faf8f5]/95 backdrop-blur-md border border-[#e5ddd3] shadow-lg rounded-xl select-none animate-in fade-in zoom-in-95 duration-150"
    >
      {onPolish && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPolish(selection.text)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#2d6a4f] hover:bg-[#e8f3ee] rounded-lg transition-colors h-auto"
          title="润色修辞与文学造句"
        >
          <Sparkles size={13} />
          <span>润色</span>
        </Button>
      )}

      {onExpand && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onExpand(selection.text)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#b45309] hover:bg-[#fef3c7] rounded-lg transition-colors h-auto"
          title="细节扩写与氛围渲染"
        >
          <Wand2 size={13} />
          <span>扩写</span>
        </Button>
      )}

      {onSummarize && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSummarize(selection.text)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#54473b] hover:bg-[#efe6da] rounded-lg transition-colors h-auto"
          title="精简冗余字词"
        >
          <Scissors size={13} />
          <span>精简</span>
        </Button>
      )}

      {onWrapQuotes && (
        <>
          <div className="h-4 w-px bg-[#e5ddd3] mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onWrapQuotes('double')}
            className="px-2 py-1 text-xs text-[#54473b] hover:bg-[#efe6da] rounded-lg transition-colors font-serif font-bold h-auto"
            title="添加双引号 “ ”"
          >
            “”
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onWrapQuotes('angle')}
            className="px-2 py-1 text-xs text-[#54473b] hover:bg-[#efe6da] rounded-lg transition-colors font-serif font-bold h-auto"
            title="添加书名号 《 》"
          >
            《》
          </Button>
        </>
      )}

      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="p-1 text-[#baa997] hover:text-[#54473b] hover:bg-[#efe6da] rounded-lg transition-colors"
          title="关闭"
          aria-label="关闭"
        >
          <X size={12} />
        </Button>
      )}
    </div>
  )
}
