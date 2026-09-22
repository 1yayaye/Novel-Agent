import { create } from 'zustand'
import type { Chapter } from '../../shared/project'
import { count } from '../../shared/text-counter'
import type { EditorPreferences, SaveState, SelectionInfo } from '../types/editor'

export interface EditorStoreState {
  activeChapter: Chapter | null
  content: string
  saveState: SaveState
  wordCount: number
  selection: SelectionInfo | null
  preferences: EditorPreferences
  isLoading: boolean
  isReadOnly: boolean

  loadChapter: (chapter: Chapter | null, isReadOnly?: boolean) => void
  setContent: (content: string) => void
  setSaveState: (saveState: SaveState) => void
  setSelection: (selection: SelectionInfo | null) => void
  setPreferences: (prefs: Partial<EditorPreferences>) => void
  setIsReadOnly: (readOnly: boolean) => void
  saveChapter: (sessionId: string) => Promise<boolean>
}

const DEFAULT_PREFERENCES: EditorPreferences = {
  theme: 'light',
  fontSize: 18,
  fontFamily: 'serif',
  contentWidth: 'normal',
  indentParagraphs: true,
  highlightLine: true
}

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  activeChapter: null,
  content: '',
  saveState: 'saved',
  wordCount: 0,
  selection: null,
  preferences: DEFAULT_PREFERENCES,
  isLoading: false,
  isReadOnly: false,

  loadChapter: (chapter, isReadOnly = false) => {
    if (!chapter) {
      set({
        activeChapter: null,
        content: '',
        saveState: 'saved',
        wordCount: 0,
        selection: null,
        isReadOnly
      })
      return
    }
    const initialContent = chapter.content || ''
    set({
      activeChapter: chapter,
      content: initialContent,
      saveState: isReadOnly ? 'read_only' : 'saved',
      wordCount: count(initialContent),
      selection: null,
      isReadOnly
    })
  },

  setContent: (content: string) => {
    const { isReadOnly, saveState } = get()
    if (isReadOnly) return

    set({
      content,
      wordCount: count(content),
      saveState: saveState === 'saving' ? 'saving' : 'dirty'
    })
  },

  setSaveState: (saveState) => set({ saveState }),
  setSelection: (selection) => set({ selection }),
  setIsReadOnly: (isReadOnly) => set({ isReadOnly, saveState: isReadOnly ? 'read_only' : get().saveState }),

  setPreferences: (prefs) => {
    set((state) => ({
      preferences: {
        ...state.preferences,
        ...prefs
      }
    }))
  },

  saveChapter: async (sessionId: string) => {
    const { activeChapter, content, isReadOnly, saveState } = get()
    if (!activeChapter || isReadOnly || saveState === 'saved') return true

    set({ saveState: 'saving' })
    try {
      const updated = await window.novelAgent.chapter.update({
        sessionId,
        chapterId: activeChapter.id,
        content,
        expectedVersion: activeChapter.version
      })
      set({
        activeChapter: updated,
        saveState: 'saved'
      })
      return true
    } catch (err: any) {
      console.error('Failed to save chapter', err)
      if (err?.code === 'CONFLICT' || err?.message?.includes('conflict') || err?.message?.includes('VERSION_CONFLICT')) {
        set({ saveState: 'conflict' })
      } else {
        set({ saveState: 'error' })
      }
      return false
    }
  }
}))
