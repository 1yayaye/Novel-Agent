import { useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, dropCursor, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { openSearchPanel, searchKeymap, highlightSelectionMatches } from '@codemirror/search'

export type ProseEditorHandle = {
  focus: () => void
  /** 在光标处插入文本（宏按钮用），未聚焦时追加到末尾 */
  insert: (text: string) => void
  scrollToOffset: (offset: number) => void
  openSearch: () => void
  getView: () => EditorView | null
}

/**
 * 提示词编辑用的轻量 CodeMirror 封装。
 *
 * 不复用 ChapterEditor：那个和章节强耦合（自动保存防抖、版本乐观锁、工具栏/状态栏/浮动菜单），
 * 拆出来比新写还贵。这里只复用它的 CodeMirror 装配配方。
 */
export function ProseEditor({
  value,
  onChange,
  onSave,
  readOnly = false,
  placeholderText,
  handle,
  className
}: {
  value: string
  onChange: (next: string) => void
  onSave?: () => void
  readOnly?: boolean
  placeholderText?: string
  handle?: React.RefObject<ProseEditorHandle | null>
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 回调放 ref，挂载 effect 才能保持 [] 依赖、不重建 view
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!host.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          dropCursor(),
          EditorView.lineWrapping,
          placeholderText ? placeholder(placeholderText) : [],
          keymap.of([
            // Ctrl/Cmd+S 保存
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current?.()
                return true
              }
            },
            indentWithTab
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          })
        ]
      }),
      parent: host.current
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在挂载时创建一次：value / 回调的后续变化由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // 外部 value 变化（切换列表项、导入 JSON、重置默认）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
  }, [value])

  useImperativeHandle(
    handle,
    (): ProseEditorHandle => ({
      focus: () => viewRef.current?.focus(),
      insert: (text: string) => {
        const view = viewRef.current
        if (!view) return
        const sel = view.state.selection.main
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length }
        })
        view.focus()
      },
      scrollToOffset: (offset: number) => {
        const view = viewRef.current
        if (!view) return
        const pos = Math.max(0, Math.min(offset, view.state.doc.length))
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 })
        })
        view.focus()
      },
      openSearch: () => {
        const view = viewRef.current
        if (!view) return
        openSearchPanel(view)
        view.focus()
      },
      getView: () => viewRef.current
    }),
    []
  )

  return <div ref={host} className={`prose-editor ${className ?? ''}`} />
}
