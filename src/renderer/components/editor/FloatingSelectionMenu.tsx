import { useEffect, useRef } from 'react'
import { Copy, MessageSquare, Pencil, Quote, RotateCcw, Search, Sparkles } from 'lucide-react'
import { Button } from '@appica/ui-react/button'
import { SelectionActions } from '../ai/SelectionActions'
import type { SelectionInfo } from '../../types/editor'

export function FloatingSelectionMenu({
  selection,
  isReadOnly,
  onPolish,
  onRewrite,
  onContinue,
  onSearch,
  onWrapQuotes,
  onCopy
}: {
  selection: SelectionInfo | null
  isReadOnly: boolean
  onPolish: (text: string) => void
  onRewrite: (text: string) => void
  onContinue: (text: string) => void
  onSearch: (text: string) => void
  onWrapQuotes: () => void
  onCopy: (text: string) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  if (!selection || !selection.text.trim() || !selection.rect) {
    return null
  }

  const { top, left, right } = selection.rect
  const centerX = (left + right) / 2
  const bubbleTop = Math.max(10, top - 44) // 44px above selection top

  return (
    <div
      ref={menuRef}
      className="floating-selection-bubble"
      style={{
        top: `${bubbleTop}px`,
        left: `${centerX}px`
      }}
      onMouseDown={(e) => {
        // Prevent losing focus / selection when clicking floating buttons
        e.preventDefault()
      }}
    >
      <SelectionActions>
        <Button
          variant="ghost"
          size="sm"
          className="bubble-btn ai-btn h-auto"
          title="针对所选内容进行 AI 润色"
          disabled={isReadOnly}
          onClick={() => onPolish(selection.text)}
        >
          <Sparkles size={13} />
          <span>润色</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="bubble-btn ai-btn h-auto"
          title="针对所选内容进行 AI 重写"
          disabled={isReadOnly}
          onClick={() => onRewrite(selection.text)}
        >
          <RotateCcw size={13} />
          <span>重写</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="bubble-btn h-auto"
          title="在书中全文搜索该词句"
          onClick={() => onSearch(selection.text)}
        >
          <Search size={13} />
          <span>搜索</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="bubble-btn h-auto"
          title="给所选文字加上双引号 “ ”"
          disabled={isReadOnly}
          onClick={onWrapQuotes}
        >
          <Quote size={13} />
          <span>引号</span>
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="bubble-btn"
          title="复制所选文字"
          aria-label="复制所选文字"
          onClick={() => onCopy(selection.text)}
        >
          <Copy size={13} />
        </Button>
      </SelectionActions>
    </div>
  )
}
