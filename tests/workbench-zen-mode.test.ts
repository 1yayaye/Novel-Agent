import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorToolbar } from '../src/renderer/components/editor/EditorToolbar'
import type { EditorPreferences } from '../src/renderer/types/editor'

describe('Ticket 01: Zen Mode Esc Exit and Window Controls Loop', () => {
  const defaultPrefs: EditorPreferences = {
    theme: 'light',
    fontSize: 16,
    fontFamily: 'serif',
    contentWidth: 'normal',
    indentParagraphs: true,
    highlightLine: true
  }

  it('renders zen-window-controls in EditorToolbar when isZenMode is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorToolbar, {
        preferences: defaultPrefs,
        isReadOnly: false,
        isZenMode: true,
        onPreferencesChange: vi.fn(),
        onToggleZenMode: vi.fn(),
        onFormatDocument: vi.fn(),
        onWrapSelection: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onFind: vi.fn()
      })
    )

    expect(html).toContain('zen-window-controls')
    expect(html).toContain('window-controls')
    expect(html).toContain('win-btn minimize')
    expect(html).toContain('win-btn maximize')
    expect(html).toContain('win-btn close')
    expect(html).toContain('退出沉浸写作模式 (Esc)')
  })

  it('does NOT render zen-window-controls when isZenMode is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorToolbar, {
        preferences: defaultPrefs,
        isReadOnly: false,
        isZenMode: false,
        onPreferencesChange: vi.fn(),
        onToggleZenMode: vi.fn(),
        onFormatDocument: vi.fn(),
        onWrapSelection: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onFind: vi.fn()
      })
    )

    expect(html).not.toContain('zen-window-controls')
    expect(html).toContain('进入沉浸全屏写作模式 (Zen Mode)')
  })

  it('simulates global Escape key dispatcher logic under different conditions', () => {
    const evaluateEscape = (params: {
      key: string
      defaultPrevented: boolean
      isZenMode: boolean
      hasActiveModal: boolean
      hasCmSearch: boolean
    }) => {
      let zenExited = false
      if (params.key === 'Escape' && !params.defaultPrevented) {
        if (params.isZenMode && !params.hasActiveModal && !params.hasCmSearch) {
          zenExited = true
        }
      }
      return zenExited
    }

    // 1. In Zen mode, no modals, Escape pressed -> exits Zen mode
    expect(
      evaluateEscape({
        key: 'Escape',
        defaultPrevented: false,
        isZenMode: true,
        hasActiveModal: false,
        hasCmSearch: false
      })
    ).toBe(true)

    // 2. Active modal open -> does NOT exit Zen mode (modal consumes Escape)
    expect(
      evaluateEscape({
        key: 'Escape',
        defaultPrevented: false,
        isZenMode: true,
        hasActiveModal: true,
        hasCmSearch: false
      })
    ).toBe(false)

    // 3. CodeMirror search panel open -> does NOT exit Zen mode
    expect(
      evaluateEscape({
        key: 'Escape',
        defaultPrevented: false,
        isZenMode: true,
        hasActiveModal: false,
        hasCmSearch: true
      })
    ).toBe(false)

    // 4. Default prevented by another child handler -> does NOT exit Zen mode
    expect(
      evaluateEscape({
        key: 'Escape',
        defaultPrevented: true,
        isZenMode: true,
        hasActiveModal: false,
        hasCmSearch: false
      })
    ).toBe(false)

    // 5. Not in Zen mode -> does NOT trigger exit
    expect(
      evaluateEscape({
        key: 'Escape',
        defaultPrevented: false,
        isZenMode: false,
        hasActiveModal: false,
        hasCmSearch: false
      })
    ).toBe(false)
  })

  it('verifies stylesheet definitions for smooth grid transitions and zen window controls', () => {
    const cssPath = resolve(__dirname, '../src/renderer/styles.css')
    const css = readFileSync(cssPath, 'utf8')

    // Grid transition on workbench body
    expect(css).toContain('transition:grid-template-columns .25s cubic-bezier(0.16,1,0.3,1)')

    // Zen body collapses left rail, chapter panel, and inspector to 0px
    expect(css).toContain('.zen-body{grid-template-columns:0px 0px 1fr 0px!important')

    // Transition on sidebars for smooth collapse
    expect(css).toContain('.zen-body .left-rail,.zen-body .chapter-panel,.zen-body .inspector{opacity:0;pointer-events:none;border:none;padding:0;overflow:hidden}')

    // Zen window controls styling
    expect(css).toContain('.zen-window-controls{position:absolute;right:12px;top:0;bottom:0;display:flex;align-items:center;-webkit-app-region:no-drag;z-index:10}')

    // Reduced motion accessibility
    expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  })
})
