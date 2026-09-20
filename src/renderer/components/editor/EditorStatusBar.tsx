import { Check, Clock, FileText, Keyboard, MousePointer } from 'lucide-react'
import type { SaveState, SelectionInfo, WritingTheme } from '../../types/editor'
import { stateLabel } from '../../utils/constants'

export function EditorStatusBar({
  theme,
  totalWords,
  selection,
  saveState,
  onForceSave
}: {
  theme: WritingTheme
  totalWords: number
  selection: SelectionInfo | null
  saveState: SaveState
  onForceSave: () => void
}) {
  const selectedWords = selection?.text ? selection.text.replace(/\s+/g, '').length : 0
  // Standard reading speed: ~400 Chinese characters per minute
  const readMinutes = Math.max(1, Math.ceil(totalWords / 400))

  return (
    <div className={`novel-status-bar ${theme}`}>
      <div className="status-left">
        <span className="status-item word-count" title="本章字数">
          <FileText size={13} />
          <strong>{totalWords.toLocaleString()}</strong> 字
        </span>

        {selectedWords > 0 && (
          <span className="status-item selection-count" title="当前选中文本字数">
            已选 <strong>{selectedWords.toLocaleString()}</strong> 字
          </span>
        )}

        {selection && (
          <span className="status-item cursor-pos" title="光标位置 (行 : 列)">
            <MousePointer size={12} />
            第 {selection.line} 行, {selection.column} 列
          </span>
        )}

        <span className="status-item read-time" title="预计阅读时间 (按400字/分钟计算)">
          <Clock size={12} />
          约 {readMinutes} 分钟
        </span>
      </div>

      <div className="status-right">
        <button
          type="button"
          aria-label="强制保存"
          className="status-item save-hint"
          title="点击或按 Ctrl+S 立即强制保存"
          onClick={onForceSave}
        >
          <Keyboard size={12} />
          <span className={`save-dot ${saveState}`} />
          <span className={`save-label ${saveState}`}>{stateLabel[saveState]}</span>
        </button>
      </div>
    </div>
  )
}
