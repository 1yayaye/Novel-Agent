import {
  AlignLeft,
  Baseline,
  BookOpen,
  Check,
  Maximize2,
  Minimize2,
  Moon,
  Pencil,
  Quote,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Type,
  Undo2,
  Wand2
} from 'lucide-react'
import type { EditorPreferences, WritingTheme } from '../../types/editor'
import {
  formatNovelParagraphs,
  normalizeChinesePunctuation,
  cleanRedundantBlankLines
} from './novel-typesetting'
import { WindowControls } from '../common/WindowControls'
import { Button } from '@appica/ui-react/button'
import { NumberField } from '@appica/ui-react/number-field'

export function EditorToolbar({
  preferences,
  isReadOnly,
  isZenMode,
  onPreferencesChange,
  onToggleZenMode,
  onFormatDocument,
  onWrapSelection,
  onUndo,
  onRedo,
  onFind
}: {
  preferences: EditorPreferences
  isReadOnly: boolean
  isZenMode: boolean
  onPreferencesChange: (updater: (prev: EditorPreferences) => EditorPreferences) => void
  onToggleZenMode: () => void
  onFormatDocument: (formatter: (doc: string) => string) => void
  onWrapSelection: (left: string, right: string) => void
  onUndo: () => void
  onRedo: () => void
  onFind: () => void
}) {
  const handleThemeChange = (theme: WritingTheme) => {
    onPreferencesChange((prev) => ({ ...prev, theme }))
  }

  const handleFontSizeChange = (delta: number) => {
    onPreferencesChange((prev) => ({
      ...prev,
      fontSize: Math.min(26, Math.max(13, prev.fontSize + delta))
    }))
  }

  const handleFontFamilyToggle = () => {
    onPreferencesChange((prev) => ({
      ...prev,
      fontFamily: prev.fontFamily === 'serif' ? 'sans' : 'serif'
    }))
  }

  const handleWidthToggle = () => {
    onPreferencesChange((prev) => {
      const nextWidth =
        prev.contentWidth === 'normal' ? 'wide' : prev.contentWidth === 'wide' ? 'full' : 'normal'
      return { ...prev, contentWidth: nextWidth }
    })
  }

  return (
    <div className={`novel-toolbar ${preferences.theme}`}>
      <div className="toolbar-group">
        <Button
          variant="ghost"
          size="icon-sm"
          className="tool-btn"
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
          disabled={isReadOnly}
          onClick={onUndo}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="tool-btn"
          title="重做 (Ctrl+Y)"
          aria-label="重做"
          disabled={isReadOnly}
          onClick={onRedo}
        >
          <Redo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="tool-btn"
          title="查找与替换 (Ctrl+F)"
          aria-label="查找与替换"
          onClick={onFind}
        >
          <Search size={15} />
        </Button>
      </div>

      <div className="toolbar-divider" />

      {/* 排版工具组 */}
      <div className="toolbar-group">
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn highlight h-auto"
          title="一键小说排版 (每段缩进2格并整理空行)"
          disabled={isReadOnly}
          onClick={() => onFormatDocument(formatNovelParagraphs)}
        >
          <Wand2 size={14} />
          <span>一键排版</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn h-auto"
          title="标点规范化 (英标点转中文全角标点)"
          disabled={isReadOnly}
          onClick={() => onFormatDocument(normalizeChinesePunctuation)}
        >
          <Quote size={14} />
          <span>标点规范</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn h-auto"
          title="压缩多余空行"
          disabled={isReadOnly}
          onClick={() => onFormatDocument(cleanRedundantBlankLines)}
        >
          <AlignLeft size={14} />
          <span>规范空行</span>
        </Button>
      </div>

      <div className="toolbar-divider" />

      {/* 快捷标点包裹组 */}
      <div className="toolbar-group wrap-group">
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn pill h-auto"
          title="包裹对话引号 “ ”"
          disabled={isReadOnly}
          onClick={() => onWrapSelection('“', '”')}
        >
          “”
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn pill h-auto"
          title="包裹书名号 《 》"
          disabled={isReadOnly}
          onClick={() => onWrapSelection('《', '》')}
        >
          《》
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn pill h-auto"
          title="包裹引号/心理 「 」"
          disabled={isReadOnly}
          onClick={() => onWrapSelection('「', '」')}
        >
          「」
        </Button>
      </div>

      <div className="toolbar-divider" />

      {/* 字体与字号调节 */}
      <div className="toolbar-group">
        <NumberField
          size="sm"
          value={preferences.fontSize}
          min={13}
          max={26}
          onValueChange={(val) => {
            if (val !== null && val !== undefined) {
              onPreferencesChange((prev) => ({
                ...prev,
                fontSize: Math.min(26, Math.max(13, val))
              }))
            }
          }}
          className="w-20"
        />
        <Button
          variant="ghost"
          size="sm"
          className={`tool-btn h-auto ${preferences.fontFamily === 'serif' ? 'active' : ''}`}
          title={`切换字体风格 (当前: ${preferences.fontFamily === 'serif' ? '优雅宋体' : '现代黑体'})`}
          onClick={handleFontFamilyToggle}
        >
          <Type size={14} />
          <span>{preferences.fontFamily === 'serif' ? '宋体' : '黑体'}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tool-btn h-auto"
          title={`版心宽度切换 (当前: ${
            preferences.contentWidth === 'normal'
              ? '标准(840px)'
              : preferences.contentWidth === 'wide'
                ? '宽屏(1020px)'
                : '铺满(100%)'
          })`}
          onClick={handleWidthToggle}
        >
          <Baseline size={14} />
          <span>
            {preferences.contentWidth === 'normal'
              ? '标准'
              : preferences.contentWidth === 'wide'
                ? '宽屏'
                : '铺满'}
          </span>
        </Button>
      </div>

      <div className="toolbar-divider" />

      {/* 主题切换与全屏 */}
      <div className="toolbar-group right-group">
        <div className="theme-toggle-chips">
          <Button
            variant="ghost"
            size="icon-sm"
            className={`theme-chip light ${preferences.theme === 'light' ? 'active' : ''}`}
            title="明亮模式"
            aria-label="明亮模式"
            onClick={() => handleThemeChange('light')}
          >
            <Sun size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={`theme-chip sepia ${preferences.theme === 'sepia' ? 'active' : ''}`}
            title="羊皮纸护眼模式"
            aria-label="羊皮纸模式"
            onClick={() => handleThemeChange('sepia')}
          >
            <BookOpen size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={`theme-chip dark ${preferences.theme === 'dark' ? 'active' : ''}`}
            title="深夜暗黑模式"
            aria-label="暗黑模式"
            onClick={() => handleThemeChange('dark')}
          >
            <Moon size={13} />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={`tool-btn zen-btn h-auto ${isZenMode ? 'active' : ''}`}
          title={isZenMode ? '退出沉浸写作模式 (Esc)' : '进入沉浸全屏写作模式 (Zen Mode)'}
          onClick={onToggleZenMode}
        >
          {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          <span>{isZenMode ? '退出沉浸' : '沉浸模式'}</span>
        </Button>
      </div>

      {isZenMode && (
        <div className="zen-window-controls" data-testid="zen-window-controls">
          <WindowControls />
        </div>
      )}
    </div>
  )
}
