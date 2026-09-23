import React, { useRef, useEffect, useCallback, useState } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, dropCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import type { Chapter } from '../../../shared/project'
import type { SaveState, EditorHandle, EditorPreferences, SelectionInfo } from '../../types/editor'
import { count } from '../../../shared/text-counter'
import { formatNovelParagraphs, cleanRedundantBlankLines } from './novel-typesetting'
import { EditorHeader } from './EditorHeader'
import { EditorStatusBar } from './EditorStatusBar'
import { EditorFloatingMenu } from './EditorFloatingMenu'
import { useEditorStore } from '../../stores/useEditorStore'

export interface EditorHostProps {
  sessionId: string
  chapter: Chapter | null
  isReadOnly?: boolean
  preferences: EditorPreferences
  isZenMode: boolean
  onToggleZenMode: () => void
  onSaved: (chapter: Chapter) => void
  onPreferencesChange: (prefs: Partial<EditorPreferences>) => void
  setHandle?: (handle: EditorHandle | null) => void
  onUpdateChapterTitle?: (newTitle: string) => void
  onPolishSelection?: (text: string) => void
  onExpandSelection?: (text: string) => void
  onSummarizeSelection?: (text: string) => void
}

export function EditorHost({
  sessionId,
  chapter,
  isReadOnly = false,
  preferences,
  isZenMode,
  onToggleZenMode,
  onSaved,
  onPreferencesChange,
  setHandle,
  onUpdateChapterTitle,
  onPolishSelection,
  onExpandSelection,
  onSummarizeSelection
}: EditorHostProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const version = useRef(chapter?.version ?? 1)
  const saved = useRef(chapter?.content ?? '')
  const timer = useRef<number | undefined>(undefined)
  const countTimer = useRef<number | undefined>(undefined)
  const writing = useRef<Promise<boolean> | null>(null)
  const queued = useRef(false)
  const blocked = useRef<SaveState | null>(null)
  const applying = useRef(false)
  const selectionInfoRef = useRef<SelectionInfo | null>(null)

  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [docLength, setDocLength] = useState(() => count(chapter?.content ?? ''))
  const [saveState, setSaveState] = useState<SaveState>(() =>
    isReadOnly ? 'read_only' : 'saved'
  )

  const persist = useCallback((): Promise<boolean> => {
    if (!chapter || isReadOnly) {
      setSaveState('read_only')
      return Promise.resolve(false)
    }
    if (blocked.current) return Promise.resolve(false)
    if (writing.current) {
      queued.current = true
      return writing.current
    }
    writing.current = (async () => {
      do {
        queued.current = false
        const content = viewRef.current?.state.doc.toString() ?? saved.current
        if (content === saved.current) break
        setSaveState('saving')
        useEditorStore.setState({ saveState: 'saving' })
        try {
          const updated = await window.novelAgent.chapter.update({
            sessionId,
            chapterId: chapter.id,
            content,
            expectedVersion: version.current
          })
          version.current = updated.version
          saved.current = updated.content
          useEditorStore.setState({
            activeChapter: updated,
            saveState: 'saved',
            content: updated.content,
            wordCount: count(updated.content)
          })
          onSaved(updated)
        } catch (error: any) {
          blocked.current =
            error?.code === 'VERSION_CONFLICT' || error?.message?.includes('conflict')
              ? 'conflict'
              : 'error'
          setSaveState(blocked.current)
          useEditorStore.setState({ saveState: blocked.current })
          return false
        }
      } while (queued.current || viewRef.current?.state.doc.toString() !== saved.current)
      setSaveState('saved')
      useEditorStore.setState({ saveState: 'saved' })
      return true
    })().finally(() => {
      writing.current = null
    })
    return writing.current
  }, [chapter, isReadOnly, onSaved, sessionId])

  const formatDoc = useCallback(
    (formatter: (text: string) => string) => {
      const editor = viewRef.current
      if (!editor || isReadOnly) return
      const currentDoc = editor.state.doc.toString()
      const newDoc = formatter(currentDoc)
      if (newDoc === currentDoc) return
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: newDoc },
        selection: editor.state.selection
      })
      editor.focus()
    },
    [isReadOnly]
  )

  const wrapSelection = useCallback(
    (left: string, right: string) => {
      const editor = viewRef.current
      if (!editor || isReadOnly) return
      const sel = editor.state.selection.main
      const selectedText = editor.state.doc.sliceString(sel.from, sel.to)
      const wrapped = `${left}${selectedText}${right}`
      editor.dispatch({
        changes: { from: sel.from, to: sel.to, insert: wrapped },
        selection: {
          anchor: sel.from + left.length,
          head: sel.from + left.length + selectedText.length
        }
      })
      editor.focus()
    },
    [isReadOnly]
  )

  const persistRef = useRef(persist)
  const setHandleRef = useRef(setHandle)
  const formatDocRef = useRef(formatDoc)
  persistRef.current = persist
  setHandleRef.current = setHandle
  formatDocRef.current = formatDoc

  useEffect(() => {
    if (!chapter) {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      return
    }

    selectionInfoRef.current = null
    version.current = chapter.version
    saved.current = chapter.content
    blocked.current = null
    const initialWords = count(chapter.content)
    window.clearTimeout(countTimer.current)
    setDocLength(initialWords)
    useEditorStore.setState({
      activeChapter: chapter,
      content: chapter.content,
      wordCount: initialWords,
      saveState: isReadOnly ? 'read_only' : 'saved'
    })

    const customShortcuts = Prec.highest(
      keymap.of([
        {
          key: 'Mod-s',
          run: (view) => {
            window.clearTimeout(timer.current)
            window.clearTimeout(countTimer.current)
            const currentDoc = view.state.doc.toString()
            const words = count(currentDoc)
            setDocLength(words)
            useEditorStore.setState({
              content: currentDoc,
              wordCount: words
            })
            void persistRef.current()
            return true
          }
        }
      ])
    )

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        window.clearTimeout(countTimer.current)
        countTimer.current = window.setTimeout(() => {
          if (viewRef.current) {
            const currentDoc = viewRef.current.state.doc.toString()
            const words = count(currentDoc)
            setDocLength(words)
            useEditorStore.setState({
              content: currentDoc,
              wordCount: words,
              saveState: blocked.current ?? (writing.current ? 'saving' : 'dirty')
            })
          }
        }, 300)
        if (!isReadOnly && !applying.current && !blocked.current) {
          setSaveState('dirty')
          useEditorStore.setState({ saveState: 'dirty' })
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            void persistRef.current()
          }, 800)
        }
      }

      if (update.selectionSet || update.docChanged) {
        const sel = update.state.selection.main
        const doc = update.state.doc
        const line = doc.lineAt(sel.head)
        const lineNum = line.number
        const colNum = sel.head - line.from + 1
        const selText = sel.from !== sel.to ? doc.sliceString(sel.from, sel.to) : ''

        let rect: SelectionInfo['rect'] = null
        if (selText.trim() && update.view) {
          try {
            const fromCoords = update.view.coordsAtPos(sel.from)
            const toCoords = update.view.coordsAtPos(sel.to)
            if (fromCoords) {
              rect = {
                top: fromCoords.top,
                left: fromCoords.left,
                right: toCoords ? toCoords.right : fromCoords.right,
                bottom: toCoords ? toCoords.bottom : fromCoords.bottom
              }
            }
          } catch {}
        }

        const info: SelectionInfo | null =
          selText || rect
            ? {
                from: sel.from,
                to: sel.to,
                text: selText,
                line: lineNum,
                column: colNum,
                rect
              }
            : null

        selectionInfoRef.current = info
        setSelectionInfo(info)
        useEditorStore.setState({ selection: info })
      }
    })

    const extensions = [
      highlightActiveLine(),
      dropCursor(),
      history(),
      searchKeymap ? keymap.of(searchKeymap) : [],
      keymap.of(defaultKeymap),
      keymap.of(historyKeymap),
      customShortcuts,
      updateListener,
      EditorView.lineWrapping
    ]

    const state = EditorState.create({
      doc: chapter.content,
      extensions
    })

    const view = new EditorView({
      state,
      parent: host.current ?? undefined
    })

    viewRef.current = view

    const handle: EditorHandle = {
      flush: () => {
        window.clearTimeout(timer.current)
        return persistRef.current()
      },
      retry: () => {
        blocked.current = null
        return persistRef.current()
      },
      cursor: () => view.state.selection.main.head,
      command: (name) => {
        if (name === 'undo') undo(view)
        if (name === 'redo') redo(view)
        if (name === 'find') openSearchPanel(view)
      },
      reload: async () => {
        try {
          const latest = await window.novelAgent.chapter.get({
            sessionId,
            chapterId: chapter.id
          })
          applying.current = true
          version.current = latest.version
          saved.current = latest.content
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: latest.content }
          })
          blocked.current = null
          setSaveState('saved')
          setDocLength(count(latest.content))
        } finally {
          applying.current = false
        }
      },
      copy: async () => {
        const text = view.state.doc.toString()
        await navigator.clipboard.writeText(text)
      },
      selectRange: (offset, length = 0) => {
        const docLen = view.state.doc.length
        const anchor = Math.min(Math.max(0, offset), docLen)
        const head = Math.min(anchor + length, docLen)
        view.dispatch({
          selection: { anchor, head },
          scrollIntoView: true
        })
        view.focus()
      },
      formatDocument: (formatter) => formatDocRef.current(formatter),
      replaceSelection: (text) => {
        const sel = view.state.selection.main
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from, head: sel.from + text.length }
        })
        view.focus()
      },
      getSelectedText: () => {
        const sel = view.state.selection.main
        return sel.from !== sel.to ? view.state.doc.sliceString(sel.from, sel.to) : ''
      },
      getSelectionInfo: () =>
        selectionInfoRef.current ?? { from: 0, to: 0, text: '', line: 1, column: 1, rect: null }
    }

    setHandleRef.current?.(handle)

    return () => {
      window.clearTimeout(timer.current)
      window.clearTimeout(countTimer.current)
      view.destroy()
      viewRef.current = null
      setHandleRef.current?.(null)
    }
    // persist / setHandle / formatDoc stay in refs. Those callbacks are recreated
    // whenever the workbench re-renders, and this effect writes the editor store,
    // so listing them here rebuilds CodeMirror until React aborts the tree.
  }, [chapter?.id, isReadOnly, sessionId])

  const contentWidthClass =
    preferences.contentWidth === 'wide'
      ? 'max-w-4xl'
      : preferences.contentWidth === 'full'
      ? 'max-w-6xl'
      : 'max-w-2xl'

  return (
    <div
      data-tour="editor-area"
      className={`chapter-editor-container flex flex-col flex-1 h-full overflow-hidden bg-[#faf8f5] relative font-${preferences.fontFamily} theme-${preferences.theme}`}
    >
      {/* Editor Header */}
      <EditorHeader
        chapter={chapter}
        preferences={preferences}
        isZenMode={isZenMode}
        onToggleZenMode={onToggleZenMode}
        onUpdateTitle={(title) => onUpdateChapterTitle?.(title)}
        onFormatDocument={() => formatDoc(formatNovelParagraphs)}
        onOpenFind={() => {
          if (viewRef.current) openSearchPanel(viewRef.current)
        }}
        onPreferencesChange={onPreferencesChange}
      />

      {/* CodeMirror Host Container */}
      <div className="flex-1 overflow-y-auto relative flex justify-center">
        <div
          ref={host}
          className={`w-full ${contentWidthClass} px-8 h-full cm-editor font-${preferences.fontFamily} ${
            preferences.indentParagraphs ? 'indent-paragraphs' : ''
          }`}
          style={{ fontSize: `${preferences.fontSize}px` }}
        />
      </div>

      {/* Floating Selection Menu for quick AI polish */}
      <EditorFloatingMenu
        selection={selectionInfo}
        onPolish={onPolishSelection}
        onExpand={onExpandSelection}
        onSummarize={onSummarizeSelection}
        onWrapQuotes={(type) => {
          if (type === 'double') wrapSelection('“', '”')
          if (type === 'angle') wrapSelection('《', '》')
        }}
        onClose={() => setSelectionInfo(null)}
      />

      {/* Status Bar */}
      <EditorStatusBar
        theme={preferences.theme}
        totalWords={docLength}
        selection={selectionInfo}
        saveState={saveState}
        onForceSave={() => void persist()}
      />
    </div>
  )
}
