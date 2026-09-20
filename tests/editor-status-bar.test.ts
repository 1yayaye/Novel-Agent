import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorStatusBar } from '../src/renderer/components/editor/EditorStatusBar'
import type { SaveState } from '../src/renderer/types/editor'

describe('Ticket 02: Status Bar Save Lifecycle and Dark Contrast', () => {
  it('renders word count, selection count, and cursor location accurately', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorStatusBar, {
        theme: 'light',
        totalWords: 3450,
        selection: {
          from: 10,
          to: 25,
          text: '白云缭绕，山道崎岖。',
          line: 4,
          column: 12,
          rect: null
        },
        saveState: 'saved',
        onForceSave: vi.fn()
      })
    )

    expect(html).toContain('3,450')
    expect(html).toContain('字')
    expect(html).toContain('已选')
    expect(html).toContain('10') // 10 non-whitespace characters in '白云缭绕，山道崎岖。'
    expect(html).toContain('第 4 行, 12 列')
    expect(html).toContain('约 9 分钟') // ceil(3450 / 400) = 9
  })

  it('renders correct status label and indicator class for all 6 SaveState values', () => {
    const states: Array<{ state: SaveState; label: string; dotClass: string }> = [
      { state: 'saved', label: '已保存', dotClass: 'save-dot saved' },
      { state: 'saving', label: '保存中', dotClass: 'save-dot saving' },
      { state: 'dirty', label: '未保存', dotClass: 'save-dot dirty' },
      { state: 'error', label: '保存失败', dotClass: 'save-dot error' },
      { state: 'conflict', label: '版本冲突', dotClass: 'save-dot conflict' },
      { state: 'read_only', label: '只读', dotClass: 'save-dot read_only' }
    ]

    for (const { state, label, dotClass } of states) {
      const html = renderToStaticMarkup(
        React.createElement(EditorStatusBar, {
          theme: 'light',
          totalWords: 1000,
          selection: null,
          saveState: state,
          onForceSave: vi.fn()
        })
      )

      expect(html).toContain(dotClass)
      expect(html).toContain(`save-label ${state}`)
      expect(html).toContain(label)
    }
  })

  it('applies theme class name properly to the status bar container', () => {
    const darkHtml = renderToStaticMarkup(
      React.createElement(EditorStatusBar, {
        theme: 'dark',
        totalWords: 200,
        selection: null,
        saveState: 'saved',
        onForceSave: vi.fn()
      })
    )
    expect(darkHtml).toContain('novel-status-bar dark')

    const sepiaHtml = renderToStaticMarkup(
      React.createElement(EditorStatusBar, {
        theme: 'sepia',
        totalWords: 200,
        selection: null,
        saveState: 'saved',
        onForceSave: vi.fn()
      })
    )
    expect(sepiaHtml).toContain('novel-status-bar sepia')
  })

  it('verifies stylesheet definitions for high contrast in dark mode', () => {
    const cssPath = resolve(__dirname, '../src/renderer/styles.css')
    const css = readFileSync(cssPath, 'utf8')

    // High contrast strong text for dark theme (#f3f4f6 has contrast > 12:1 against #26262d)
    expect(css).toContain('.novel-status-bar.dark .status-item strong{color:#f3f4f6}')

    // Dark mode save indicators
    expect(css).toContain('.novel-status-bar.dark .save-dot{background:#4ade80}')
    expect(css).toContain('.novel-status-bar.dark .save-dot.dirty,.novel-status-bar.dark .save-dot.saving{background:#fbbf24}')
    expect(css).toContain('.novel-status-bar.dark .save-dot.error,.novel-status-bar.dark .save-dot.conflict{background:#f87171}')
    expect(css).toContain('.novel-status-bar.dark .save-dot.read_only{background:#9ca3af}')

    // Sepia mode contrast
    expect(css).toContain('.novel-status-bar.sepia .status-item strong{color:#2c251e}')
  })
})
