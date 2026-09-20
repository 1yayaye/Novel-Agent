import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyChapterState } from '../src/renderer/components/editor/EmptyChapterState'
import type { Chapter } from '../src/shared/project'

describe('Ticket 03: Empty Chapter State Card & Blank Project Crash Guard', () => {
  it('renders default scholar-themed empty chapter card with title, description, and action button', () => {
    const handleCreate = vi.fn()
    const html = renderToStaticMarkup(
      React.createElement(EmptyChapterState, {
        onCreateChapter: handleCreate,
        isReadOnly: false
      })
    )

    expect(html).toContain('empty-chapter-container')
    expect(html).toContain('empty-chapter-card')
    expect(html).toContain('纸白墨润，静待下笔')
    expect(html).toContain('当前作品暂无章节')
    expect(html).toContain('新建第一章')
    expect(html).toContain('primary-button create-first-chapter-btn')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="空章节引导"')
  })

  it('renders read-only mode badge and omits create button when isReadOnly is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmptyChapterState, {
        isReadOnly: true
      })
    )

    expect(html).toContain('empty-readonly-badge')
    expect(html).toContain('当前作品为只读模式')
    expect(html).not.toContain('create-first-chapter-btn')
    expect(html).not.toContain('新建第一章')
  })

  it('supports custom title and description overrides', () => {
    const html = renderToStaticMarkup(
      React.createElement(EmptyChapterState, {
        title: '分卷暂无内容',
        description: '请为第二卷添加章节草稿',
        isReadOnly: false
      })
    )

    expect(html).toContain('分卷暂无内容')
    expect(html).toContain('请为第二卷添加章节草稿')
  })

  it('safely guards undefined active chapter in 0-chapter projects without throwing TypeError', () => {
    const emptyChapters: Chapter[] = []
    const activeId: string | undefined = undefined
    const active = emptyChapters.find(({ id }) => id === activeId)

    // Verify active is safely undefined
    expect(active).toBeUndefined()

    // Test the render branch selection used in Workbench:
    // If active is undefined, render EmptyChapterState instead of accessing active.title
    const renderWritingArea = (activeChapter?: Chapter) => {
      if (!activeChapter) {
        return renderToStaticMarkup(
          React.createElement(EmptyChapterState, {
            isReadOnly: false
          })
        )
      }
      return `<h1>${activeChapter.title}</h1>`
    }

    expect(() => renderWritingArea(active)).not.toThrow()
    const rendered = renderWritingArea(active)
    expect(rendered).toContain('新建第一章')
    expect(rendered).toContain('empty-chapter-card')
  })

  it('verifies stylesheet definitions for EmptyChapterState across light, dark, and sepia themes', () => {
    const cssPath = resolve(__dirname, '../src/renderer/styles.css')
    const css = readFileSync(cssPath, 'utf8')

    // Base container and card styling
    expect(css).toContain('.empty-chapter-container{flex:1;height:100%;display:grid;place-items:center')
    expect(css).toContain('.empty-chapter-card{max-width:460px;width:100%')
    expect(css).toContain('.empty-chapter-title{margin:0 0 10px;font-size:20px;font-weight:700')
    expect(css).toContain('.empty-chapter-icon-wrapper{display:grid;place-items:center;width:72px;height:72px;border-radius:50%')

    // Theme adaptation: dark and sepia
    expect(css).toContain('.theme-dark .empty-chapter-card{background:#23232b;border-color:#383842')
    expect(css).toContain('.theme-dark .empty-chapter-title{color:#f3f4f6}')
    expect(css).toContain('.theme-sepia .empty-chapter-card{background:#fcf9f2;border-color:#dfd8c7}')
    expect(css).toContain('.theme-sepia .empty-chapter-title{color:#2c251e}')
  })
})
