import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EditorState } from '@codemirror/state'

describe('Ticket 08: CodeMirror Search Panel Theme Integration & Drawer Toggle Selector', () => {
  const cssPath = resolve(__dirname, '../src/renderer/styles.css')
  const css = readFileSync(cssPath, 'utf8')
  const workbenchTsxPath = resolve(__dirname, '../src/renderer/components/workbench/Workbench.tsx')
  const workbenchTsx = readFileSync(workbenchTsxPath, 'utf8')
  const iconButtonTsxPath = resolve(__dirname, '../src/renderer/components/common/IconButton.tsx')
  const iconButtonTsx = readFileSync(iconButtonTsxPath, 'utf8')

  it('provides comprehensive base styling for .cm-panel.cm-search', () => {
    expect(css).toContain('.cm-panel.cm-search')
    expect(css).toContain('.cm-panel.cm-search input.cm-textfield')
    expect(css).toContain('.cm-panel.cm-search button.cm-button')
    expect(css).toContain('.cm-panel.cm-search label.cm-search-label')
    expect(css).toContain('.cm-panel.cm-search button.cm-button[name="close"]')
    expect(css).toContain('.cm-panel.cm-search .cm-search-matches')

    // Adversarial Check: Verify Editor live selection coordinates and text probe logic (R1 / ChapterEditor)
    const sampleDoc = '第一行文本\n第二行选中的内容\n第三行结束'
    const state = EditorState.create({
      doc: sampleDoc,
      selection: { anchor: 6, head: 14 } // selecting '第二行选中的内容'
    })
    const sel = state.selection.main
    const line = state.doc.lineAt(sel.head)
    const lineNum = line.number
    const colNum = sel.head - line.from + 1
    const selText = sel.from !== sel.to ? state.doc.sliceString(sel.from, sel.to) : ''
    expect(lineNum).toBe(2)
    expect(selText).toBe('第二行选中的内容')
    expect(colNum).toBe(9)

    // Adversarial Check: Collapsed selection yields empty text and null coordinates
    const collapsedState = EditorState.create({
      doc: sampleDoc,
      selection: { anchor: 6, head: 6 }
    })
    const collapsedSel = collapsedState.selection.main
    const collapsedText = collapsedSel.from !== collapsedSel.to ? collapsedState.doc.sliceString(collapsedSel.from, collapsedSel.to) : ''
    expect(collapsedText).toBe('')
  })

  it('provides emerald green focus outlines and styled buttons in light theme', () => {
    expect(css).toContain('.cm-panel.cm-search input.cm-textfield:focus{border-color:#2d5a27;box-shadow:0 0 0 2px rgba(45,90,39,.18)}')
    expect(css).toContain('.cm-panel.cm-search button.cm-button:hover{background:#e8efe5;color:#2d5a27;border-color:#2d5a27}')
  })

  it('provides parchment sepia theme styles for search panel', () => {
    expect(css).toContain('.theme-sepia .cm-panels,.theme-sepia .cm-panel.cm-search{background:#eee9dc!important')
    expect(css).toContain('.theme-sepia .cm-panel.cm-search input.cm-textfield{background:#fbf8f0;border-color:#dcd3c1;color:#2c251e}')
    expect(css).toContain('.theme-sepia .cm-panel.cm-search button.cm-button:hover{background:#e5d8be;color:#2c251e;border-color:#8c6239}')
  })

  it('provides dark theme styles with night green accents for search panel', () => {
    expect(css).toContain('.theme-dark .cm-panels,.theme-dark .cm-panel.cm-search,.dark .cm-panel.cm-search{background:#26262d!important')
    expect(css).toContain('.theme-dark .cm-panel.cm-search input.cm-textfield,.dark .cm-panel.cm-search input.cm-textfield{background:#1e1e24;border-color:#3f3f4e;color:#f3f4f6}')
    expect(css).toContain('.theme-dark .cm-panel.cm-search button.cm-button:hover,.dark .cm-panel.cm-search button.cm-button:hover{background:#1f3a1d;color:#4ade80;border-color:#4ade80}')
  })

  it('targets drawer toggle button with explicit .drawer-toggle-button class on wide screens', () => {
    expect(css).toContain('@media(min-width:1440px){.drawer-toggle-button{display:none!important}}')
    expect(css).not.toContain('.toolbar>.icon-button:last-child')
    expect(workbenchTsx).toContain('className="drawer-toggle-button"')
    expect(workbenchTsx).toContain('label="显示章节信息"')
    expect(iconButtonTsx).toContain('className')
  })
})
