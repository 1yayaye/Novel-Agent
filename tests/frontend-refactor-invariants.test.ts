/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTaskStore } from '../src/renderer/stores/useTaskStore'
import { useEditorStore } from '../src/renderer/stores/useEditorStore'
import { EditorHeader } from '../src/renderer/features/editor/EditorHeader'
import type { EditorPreferences } from '../src/renderer/types/editor'

describe('Frontend Refactoring Core Invariants & State Synchronization', () => {
  const defaultPrefs: EditorPreferences = {
    theme: 'light',
    fontSize: 18,
    fontFamily: 'serif',
    contentWidth: 'normal',
    indentParagraphs: true,
    highlightLine: true
  }

  describe('useTaskStore task streaming & lifecycle', () => {
    it('supports updateOrAddTask and setTasks correctly', () => {
      const store = useTaskStore.getState()
      store.clearCompleted()

      store.updateOrAddTask({
        id: 'task-1',
        title: '章节知识分析',
        type: 'knowledge',
        progress: 0.25,
        status: 'running',
        stage: '实体抽取'
      })

      let state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0].id).toBe('task-1')
      expect(state.tasks[0].progress).toBe(0.25)
      expect(state.activeTaskId).toBe('task-1')

      // Update existing task progress
      store.updateOrAddTask({
        id: 'task-1',
        progress: 0.8,
        stage: '关系推导'
      })

      state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0].progress).toBe(0.8)
      expect(state.tasks[0].stage).toBe('关系推导')

      // Mark completed
      store.updateTask('task-1', { status: 'completed', progress: 1 })
      state = useTaskStore.getState()
      expect(state.tasks[0].status).toBe('completed')

      // Clear completed
      store.clearCompleted()
      state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(0)
    })
  })

  describe('useEditorStore live wordCount & preferences', () => {
    it('calculates zero-allocation word count on setContent', () => {
      const store = useEditorStore.getState()
      store.loadChapter({
        id: 'chap-1',
        title: '第一章 启程',
        position: 0,
        content: '山路崎岖，夜色深沉。',
        version: 1,
        createdAt: 1,
        updatedAt: 1
      })

      let state = useEditorStore.getState()
      expect(state.wordCount).toBe(10)
      expect(state.saveState).toBe('saved')

      store.setContent('山路崎岖，夜色深沉。白衣剑客御风而行。')
      state = useEditorStore.getState()
      expect(state.wordCount).toBe(19)
      expect(state.saveState).toBe('dirty')
    })
  })

  describe('EditorHeader theme switching & zen window controls', () => {
    it('renders theme selector chips for light, sepia, and dark themes', () => {
      const onPrefsChange = vi.fn()
      const html = renderToStaticMarkup(
        React.createElement(EditorHeader, {
          chapter: {
            id: 'chap-1',
            title: '第一章',
            position: 0,
            content: '正文',
            version: 1,
            createdAt: 1,
            updatedAt: 1
          },
          preferences: defaultPrefs,
          isZenMode: false,
          onToggleZenMode: vi.fn(),
          onUpdateTitle: vi.fn(),
          onPreferencesChange: onPrefsChange
        })
      )

      expect(html).toContain('aria-label="明亮模式"')
      expect(html).toContain('aria-label="羊皮纸模式"')
      expect(html).toContain('aria-label="暗黑模式"')
      expect(html).not.toContain('zen-window-controls')
    })

    it('renders zen-window-controls when isZenMode is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(EditorHeader, {
          chapter: {
            id: 'chap-1',
            title: '第一章',
            position: 0,
            content: '正文',
            version: 1,
            createdAt: 1,
            updatedAt: 1
          },
          preferences: defaultPrefs,
          isZenMode: true,
          onToggleZenMode: vi.fn(),
          onUpdateTitle: vi.fn(),
          onPreferencesChange: vi.fn()
        })
      )

      expect(html).toContain('zen-window-controls')
      expect(html).toContain('window-controls')
      expect(html).toContain('win-btn minimize')
      expect(html).toContain('win-btn maximize')
      expect(html).toContain('win-btn close')
    })
  })

  describe('SpotlightTour targetSelector coverage across feature components', () => {
    it('verifies that all tour data attributes are present in DOM trees', () => {
      const topBarTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/workbench/TopBar.tsx'),
        'utf8'
      )
      const chapterTreeTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/workbench/ChapterTree.tsx'),
        'utf8'
      )
      const editorHostTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/editor/EditorHost.tsx'),
        'utf8'
      )
      const actionDockTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/workbench/ActionDock.tsx'),
        'utf8'
      )
      const drawerHostTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/drawer/DrawerHost.tsx'),
        'utf8'
      )
      const navRailTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/workbench/NavRail.tsx'),
        'utf8'
      )

      expect(topBarTsx).toContain('data-tour="connection-badge"')
      expect(chapterTreeTsx).toContain('data-tour="chapter-panel"')
      expect(editorHostTsx).toContain('data-tour="editor-area"')
      expect(actionDockTsx).toContain('data-tour="ai-actions"')
      expect(drawerHostTsx).toContain('data-tour="inspector"')
      expect(navRailTsx).toContain('data-tour="left-rail"')
    })
  })

  describe('DialogHost ConfirmActionDialog integration', () => {
    it('verifies DialogHost handles confirm dialog type', () => {
      const dialogHostTsx = readFileSync(
        resolve(__dirname, '../src/renderer/features/dialogs/DialogHost.tsx'),
        'utf8'
      )

      expect(dialogHostTsx).toContain('ConfirmActionDialog')
      expect(dialogHostTsx).toContain("activeDialog === 'confirm'")
    })
  })
})
