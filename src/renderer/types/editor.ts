export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'read_only'

export type WritingTheme = 'light' | 'sepia' | 'dark'
export type FontFamily = 'serif' | 'sans'
export type ContentWidth = 'normal' | 'wide' | 'full'

export type EditorPreferences = {
  theme: WritingTheme
  fontSize: number
  fontFamily: FontFamily
  contentWidth: ContentWidth
  indentParagraphs: boolean
  highlightLine: boolean
}

export type SelectionInfo = {
  from: number
  to: number
  text: string
  line: number
  column: number
  rect?: { top: number; left: number; right: number; bottom: number } | null
}

export type EditorHandle = {
  flush: () => Promise<boolean>
  retry: () => Promise<boolean>
  cursor: () => number
  command: (name: 'undo' | 'redo' | 'find') => void
  reload: () => Promise<void>
  copy: () => Promise<void>
  selectRange: (offset: number, length?: number) => void
  formatDocument?: (formatter: (doc: string) => string) => void
  replaceSelection?: (text: string) => void
  getSelectedText?: () => string
  getSelectionInfo?: () => SelectionInfo
}

export type ChapterAction = { kind: 'create' | 'rename' | 'split'; title: string; offset?: number } | { kind: 'merge' | 'delete' }

