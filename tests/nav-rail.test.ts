import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavRail } from '../src/renderer/components/workbench/NavRail'

describe('NavRail (Lifecycle 4-Section Workspaces & Expandable Label Support)', () => {
  it('renders 4 lifecycle sections in collapsed mode with mini-labels and icons', () => {
    const handleToggle = vi.fn()
    const handleAction = vi.fn()

    const html = renderToStaticMarkup(
      React.createElement(NavRail, {
        activeDialog: null,
        isExpanded: false,
        onToggleExpanded: handleToggle,
        onSelectAction: handleAction
      })
    )

    expect(html).toContain('left-rail collapsed')
    // Check brand
    expect(html).toContain('app-mark')
    expect(html).toContain('NA')
    // In collapsed mode, mini-labels are visible
    expect(html).toContain('rail-mini-label')
    expect(html).toContain('写作')
    expect(html).toContain('大纲')
    expect(html).toContain('设定')
    expect(html).toContain('文风')
    expect(html).toContain('模型')
    // Active state when activeDialog is null should highlight writing
    expect(html).toContain('rail-active')
  })

  it('renders group titles and full labels when isExpanded is true', () => {
    const handleToggle = vi.fn()
    const handleAction = vi.fn()

    const html = renderToStaticMarkup(
      React.createElement(NavRail, {
        activeDialog: 'outline',
        isExpanded: true,
        onToggleExpanded: handleToggle,
        onSelectAction: handleAction
      })
    )

    expect(html).toContain('left-rail expanded')
    expect(html).toContain('Novel Agent')
    // Check 4 section headers
    expect(html).toContain('创作中心')
    expect(html).toContain('大纲脉络')
    expect(html).toContain('设定与分析')
    expect(html).toContain('工具与配置')
    // Check full labels
    expect(html).toContain('正文写作')
    expect(html).toContain('大纲与故事脉络')
    expect(html).toContain('文学文风报告')
    expect(html).toContain('模型连接配置')
    expect(html).toContain('收起导航')
  })

  it('marks outline as active when activeDialog is outline or synopsis', () => {
    const htmlOutline = renderToStaticMarkup(
      React.createElement(NavRail, {
        activeDialog: 'outline',
        isExpanded: true,
        onToggleExpanded: vi.fn(),
        onSelectAction: vi.fn()
      })
    )
    expect(htmlOutline).toContain('rail-active')
    expect(htmlOutline).toContain('aria-label="大纲与故事脉络"')

    const htmlSynopsis = renderToStaticMarkup(
      React.createElement(NavRail, {
        activeDialog: 'synopsis',
        isExpanded: true,
        onToggleExpanded: vi.fn(),
        onSelectAction: vi.fn()
      })
    )
    expect(htmlSynopsis).toContain('rail-active')
  })

  it('marks settings items as active properly', () => {
    const htmlConn = renderToStaticMarkup(
      React.createElement(NavRail, {
        activeDialog: 'connection',
        isExpanded: true,
        onToggleExpanded: vi.fn(),
        onSelectAction: vi.fn()
      })
    )
    expect(htmlConn).toContain('rail-active')
    expect(htmlConn).toContain('aria-label="模型连接配置"')
  })
})
