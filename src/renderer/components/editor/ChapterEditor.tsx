import { useRef, useEffect, useCallback, useState } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, dropCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import type { Chapter } from '../../../shared/project'
import type { SaveState, EditorHandle, EditorPreferences, SelectionInfo } from '../../types/editor'
import { count } from '../../utils/formatters'
import { EditorToolbar } from './EditorToolbar'
import { EditorStatusBar } from './EditorStatusBar'
import { FloatingSelectionMenu } from './FloatingSelectionMenu'

export function ChapterEditor({
  sessionId,
  chapter,
  isReadOnly,
  preferences,
  isZenMode,
  saveState,
  onSaved,
  onState,
  setHandle,
  onPreferencesChange,
  onToggleZenMode,
  onPolishSelection,
  onRewriteSelection,
  onContinueSelection,
  onSearchSelection
}: {
  sessionId: string
  chapter: Chapter
  isReadOnly: boolean
  preferences: EditorPreferences
  isZenMode: boolean
  saveState?: SaveState
  onSaved: (chapter: Chapter) => void
  onState: (state: SaveState) => void
  setHandle: (handle: EditorHandle | null) => void
  onPreferencesChange: (updater: (prev: EditorPreferences) => EditorPreferences) => void
  onToggleZenMode: () => void
  onPolishSelection?: (text: string) => void
  onRewriteSelection?: (text: string) => void
  onContinueSelection?: (text: string) => void
  onSearchSelection?: (text: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const version = useRef(chapter.version)
  const saved = useRef(chapter.content)
  const timer = useRef<number | undefined>(undefined)
  const countTimer = useRef<number | undefined>(undefined)
  const writing = useRef<Promise<boolean> | null>(null)
  const queued = useRef(false)
  const blocked = useRef<SaveState | null>(null)
  const applying = useRef(false)
  const selectionInfoRef = useRef<SelectionInfo | null>(null)

  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [docLength, setDocLength] = useState(() => count(chapter.content))
  const [localSaveState, setLocalSaveState] = useState<SaveState>(() =>
    isReadOnly ? 'read_only' : saveState ?? 'saved'
  )

  const updateSaveState = useCallback(
    (state: SaveState) => {
      setLocalSaveState(state)
      onState(state)
    },
    [onState]
  )

  useEffect(() => {
    if (saveState && saveState !== localSaveState) {
      setLocalSaveState(saveState)
    }
  }, [saveState, localSaveState])

  const persist = useCallback((): Promise<boolean> => {
    if (isReadOnly) {
      updateSaveState('read_only')
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
        updateSaveState('saving')
        try {
          const updated = await window.novelAgent.chapter.update({
            sessionId,
            chapterId: chapter.id,
            content,
            expectedVersion: version.current
          })
          version.current = updated.version
          saved.current = updated.content
          onSaved(updated)
        } catch (error) {
          blocked.current =
            (error as { code?: string }).code === 'VERSION_CONFLICT' ? 'conflict' : 'error'
          updateSaveState(blocked.current)
          return false
        }
      } while (queued.current || viewRef.current?.state.doc.toString() !== saved.current)
      updateSaveState('saved')
      return true
    })().finally(() => {
      writing.current = null
    })
    return writing.current
  }, [chapter.id, isReadOnly, onSaved, updateSaveState, sessionId])

  useEffect(() => {
    const editor = viewRef.current
    if (editor && editor.state.doc.toString() === saved.current) {
      version.current = chapter.version
      saved.current = chapter.content
    }
  }, [chapter.content, chapter.version])

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

  const replaceSelectionText = useCallback(
    (text: string) => {
      const editor = viewRef.current
      if (!editor || isReadOnly) return
      const sel = editor.state.selection.main
      editor.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from, head: sel.from + text.length }
      })
      editor.focus()
    },
    [isReadOnly]
  )

  useEffect(() => {
    selectionInfoRef.current = null
    version.current = chapter.version
    saved.current = chapter.content
    blocked.current = null
    queued.current = false
    window.clearTimeout(countTimer.current)
    setDocLength(count(chapter.content))

    const customShortcuts = Prec.highest(
      keymap.of([
        {
          key: 'Mod-s',
          run: (view) => {
            window.clearTimeout(timer.current)
            window.clearTimeout(countTimer.current)
            setDocLength(count(view.state.doc.toString()))
            void persist()
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
            setDocLength(count(viewRef.current.state.doc.toString()))
          }
        }, 300)
        if (!isReadOnly && !applying.current && !blocked.current) {
          updateSaveState('dirty')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            void persist()
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

        const info: SelectionInfo = {
          from: sel.from,
          to: sel.to,
          text: selText,
          line: lineNum,
          column: colNum,
          rect
        }
        selectionInfoRef.current = info
        setSelectionInfo(info)
      }
    })

    const editor = new EditorView({
      state: EditorState.create({
        doc: chapter.content,
        extensions: [
          history(),
          customShortcuts,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.lineWrapping,
          highlightActiveLine(),
          dropCursor(),
          updateListener
        ]
      }),
      parent: host.current!
    })

    viewRef.current = editor

    let scrollRaf: number | null = null
    const handleScroll = () => {
      const currentView = viewRef.current
      if (!currentView) return
      const sel = currentView.state.selection.main
      if (sel.from === sel.to) return
      const doc = currentView.state.doc
      const selText = doc.sliceString(sel.from, sel.to)
      if (!selText.trim()) return

      try {
        const scrollerRect = currentView.scrollDOM.getBoundingClientRect()
        const fromCoords = currentView.coordsAtPos(sel.from)
        const toCoords = currentView.coordsAtPos(sel.to)
        if (
          fromCoords &&
          toCoords &&
          toCoords.bottom >= scrollerRect.top &&
          fromCoords.top <= scrollerRect.bottom
        ) {
          const rect: SelectionInfo['rect'] = {
            top: fromCoords.top,
            left: fromCoords.left,
            right: toCoords.right,
            bottom: toCoords.bottom
          }
          const info: SelectionInfo = {
            from: sel.from,
            to: sel.to,
            text: selText,
            line: doc.lineAt(sel.head).number,
            column: sel.head - doc.lineAt(sel.head).from + 1,
            rect
          }
          selectionInfoRef.current = info
          setSelectionInfo(info)
        } else {
          // Hide floating bubble when selection is scrolled out of viewport
          if (selectionInfoRef.current?.rect === null) return
          const info: SelectionInfo = {
            from: sel.from,
            to: sel.to,
            text: selText,
            line: doc.lineAt(sel.head).number,
            column: sel.head - doc.lineAt(sel.head).from + 1,
            rect: null
          }
          selectionInfoRef.current = info
          setSelectionInfo(info)
        }
      } catch {
        if (selectionInfoRef.current?.rect !== null) {
          const info: SelectionInfo = {
            from: sel.from,
            to: sel.to,
            text: selText,
            line: doc.lineAt(sel.head).number,
            column: sel.head - doc.lineAt(sel.head).from + 1,
            rect: null
          }
          selectionInfoRef.current = info
          setSelectionInfo(info)
        }
      }
    }

    const onScroll = () => {
      if (scrollRaf !== null) return
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = null
        handleScroll()
      })
    }

    editor.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    setHandle({
      flush: () => {
        window.clearTimeout(timer.current)
        window.clearTimeout(countTimer.current)
        setDocLength(count(editor.state.doc.toString()))
        return persist()
      },
      cursor: () => editor.state.selection.main.head,
      retry: () => {
        blocked.current = null
        return persist()
      },
      command: (name) => {
        if (name === 'undo') undo(editor)
        if (name === 'redo') redo(editor)
        if (name === 'find') openSearchPanel(editor)
      },
      reload: async () => {
        const current = await window.novelAgent.chapter.get({ sessionId, chapterId: chapter.id })
        version.current = current.version
        saved.current = current.content
        blocked.current = null
        applying.current = true
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: current.content }
        })
        applying.current = false
        onSaved(current)
        onState('saved')
        window.clearTimeout(countTimer.current)
        setDocLength(count(current.content))
      },
      copy: () => navigator.clipboard.writeText(editor.state.doc.toString()),
      selectRange: (offset: number, length = 0) => {
        const docLen = editor.state.doc.length
        const safeFrom = Math.max(0, Math.min(offset, docLen))
        const safeTo = Math.max(0, Math.min(offset + length, docLen))
        editor.dispatch({
          selection: { anchor: safeFrom, head: safeTo },
          scrollIntoView: true
        })
        editor.focus()
      },
      formatDocument: formatDoc,
      replaceSelection: replaceSelectionText,
      getSelectedText: () => {
        const sel = editor.state.selection.main
        return editor.state.doc.sliceString(sel.from, sel.to)
      },
      getSelectionInfo: () => {
        const currentView = viewRef.current
        if (currentView) {
          const sel = currentView.state.selection.main
          const doc = currentView.state.doc
          const line = doc.lineAt(sel.head)
          const lineNum = line.number
          const colNum = sel.head - line.from + 1
          const selText = sel.from !== sel.to ? doc.sliceString(sel.from, sel.to) : ''

          let rect: SelectionInfo['rect'] = null
          if (selText.trim()) {
            try {
              const fromCoords = currentView.coordsAtPos(sel.from)
              const toCoords = currentView.coordsAtPos(sel.to)
              if (fromCoords) {
                rect = {
                  top: fromCoords.top,
                  left: fromCoords.left,
                  right: toCoords ? toCoords.right : fromCoords.right,
                  bottom: toCoords ? toCoords.bottom : fromCoords.bottom
                }
              }
            } catch {}
            if (!rect && selectionInfoRef.current?.text === selText) {
              rect = selectionInfoRef.current.rect
            }
          }

          const liveInfo: SelectionInfo = {
            from: sel.from,
            to: sel.to,
            text: selText,
            line: lineNum,
            column: colNum,
            rect
          }
          selectionInfoRef.current = liveInfo
          return liveInfo
        }

        return (
          selectionInfoRef.current ?? {
            from: 0,
            to: 0,
            text: '',
            line: 1,
            column: 1,
            rect: null
          }
        )
      }
    })

    // 15-minute interval ordinary snapshot timer
    const snapshotInterval = window.setInterval(() => {
      if (!isReadOnly) {
        void window.novelAgent.chapter
          .createOrdinarySnapshot({
            sessionId,
            chapterId: chapter.id,
            expectedVersion: version.current
          })
          .catch(() => {})
      }
    }, 15 * 60 * 1000)

    let closing = false
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closing || isReadOnly || editor.state.doc.toString() === saved.current) return
      event.preventDefault()
      event.returnValue = ''
      void persist().then((ok) => {
        if (ok) {
          void window.novelAgent.chapter
            .createOrdinarySnapshot({
              sessionId,
              chapterId: chapter.id,
              expectedVersion: version.current
            })
            .catch(() => {})
          closing = true
          window.close()
        }
      })
    }
    window.addEventListener('beforeunload', beforeUnload)

    return () => {
      editor.scrollDOM.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (scrollRaf !== null) {
        window.cancelAnimationFrame(scrollRaf)
      }
      window.removeEventListener('beforeunload', beforeUnload)
      window.clearTimeout(timer.current)
      window.clearTimeout(countTimer.current)
      window.clearInterval(snapshotInterval)
      if (!isReadOnly && editor.state.doc.toString() !== saved.current) {
        void window.novelAgent.chapter
          .createOrdinarySnapshot({
            sessionId,
            chapterId: chapter.id,
            expectedVersion: version.current
          })
          .catch(() => {})
      }
      editor.destroy()
      viewRef.current = null
      setHandle(null)
    }
  }, [chapter.id])

  return (
    <div
      className={`chapter-editor-container theme-${preferences.theme} font-${preferences.fontFamily} width-${preferences.contentWidth}`}
      style={{
        // Dynamic typography styles via CSS variables
        ['--editor-font-size' as string]: `${preferences.fontSize}px`
      }}
    >
      <EditorToolbar
        preferences={preferences}
        isReadOnly={isReadOnly}
        isZenMode={isZenMode}
        onPreferencesChange={onPreferencesChange}
        onToggleZenMode={onToggleZenMode}
        onFormatDocument={formatDoc}
        onWrapSelection={wrapSelection}
        onUndo={() => {
          if (viewRef.current) undo(viewRef.current)
        }}
        onRedo={() => {
          if (viewRef.current) redo(viewRef.current)
        }}
        onFind={() => {
          if (viewRef.current) openSearchPanel(viewRef.current)
        }}
      />

      <div className="editor-scroller-wrapper">
        <div className="editor-host" ref={host} aria-label="正文编辑器" />

        <FloatingSelectionMenu
          selection={selectionInfo}
          isReadOnly={isReadOnly}
          onPolish={(text) => onPolishSelection?.(text)}
          onRewrite={(text) => onRewriteSelection?.(text)}
          onContinue={(text) => onContinueSelection?.(text)}
          onSearch={(text) => onSearchSelection?.(text)}
          onWrapQuotes={() => wrapSelection('“', '”')}
          onCopy={(text) => void navigator.clipboard.writeText(text)}
        />
      </div>

      <EditorStatusBar
        theme={preferences.theme}
        totalWords={docLength}
        selection={selectionInfo}
        saveState={isReadOnly ? 'read_only' : (saveState ?? localSaveState)}
        onForceSave={() => {
          window.clearTimeout(timer.current)
          void persist()
        }}
      />
    </div>
  )
}
