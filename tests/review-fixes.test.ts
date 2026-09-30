/**
 * @vitest-environment jsdom
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenProjectResult } from '../src/shared/project'
import { useEditorStore } from '../src/renderer/stores/useEditorStore'
import { useProjectStore } from '../src/renderer/stores/useProjectStore'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const project = (sessionId: string, mode: OpenProjectResult['mode']): OpenProjectResult => ({
  sessionId: sessionId as OpenProjectResult['sessionId'],
  mode,
  integrity: 'ok',
  metadata: {} as OpenProjectResult['metadata'],
  taskRoutes: [],
  capabilities: {
    analysisPipelines: mode === 'read_write',
    analysisExport: mode === 'read_write',
    taskControls: mode === 'read_write'
  }
})

afterEach(() => {
  useEditorStore.setState({
    activeChapter: null,
    content: '',
    saveState: 'saved',
    wordCount: 0,
    selection: null,
    isReadOnly: false
  })
  useProjectStore.setState({
    project: null,
    chapters: [],
    selectedChapterId: null,
    isLoading: false,
    error: null
  })
})

describe('review fixes', () => {
  it('blocks editor writes for a read-only project', async () => {
    const chapter = {
      id: 'chapter-1',
      title: '第一章',
      position: 0,
      content: '原正文',
      version: 1,
      createdAt: 1,
      updatedAt: 1
    }
    const store = useEditorStore.getState()
    store.loadChapter(chapter, true)
    store.setContent('不应写入')

    expect(useEditorStore.getState().content).toBe('原正文')
    expect(useEditorStore.getState().saveState).toBe('read_only')
    await expect(store.saveChapter('session-1')).resolves.toBe(true)
  })

  it('clears editor and chapter selection when loading a new or empty project', async () => {
    const previousAgent = (globalThis as any).window?.novelAgent
    const list = vi.fn()
      .mockResolvedValueOnce([{ id: 'old', title: '旧章节', position: 0, version: 1 }])
      .mockResolvedValueOnce([])
    Object.defineProperty(window, 'novelAgent', {
      configurable: true,
      value: {
        chapter: { list },
        project: { listRecent: vi.fn().mockResolvedValue([]) }
      }
    })

    useEditorStore.getState().loadChapter({
      id: 'old',
      title: '旧章节',
      position: 0,
      content: '旧正文',
      version: 1,
      createdAt: 1,
      updatedAt: 1
    })
    await useProjectStore.getState().loadProject(project('session-a', 'read_write'))
    expect(useEditorStore.getState().activeChapter).toBeNull()

    await useProjectStore.getState().loadProject(project('session-b', 'read_only'))
    expect(useProjectStore.getState().chapters).toEqual([])
    expect(useProjectStore.getState().selectedChapterId).toBeNull()
    expect(useEditorStore.getState().activeChapter).toBeNull()
    expect(useEditorStore.getState().isReadOnly).toBe(true)

    Object.defineProperty(window, 'novelAgent', { configurable: true, value: previousAgent })
  })

  it('routes analysis entry points and chapter filtering through the intended state', () => {
    const workbench = read('src/renderer/features/workbench/WorkbenchLayout.tsx')
    const dialogHost = read('src/renderer/features/dialogs/DialogHost.tsx')
    const chapterTree = read('src/renderer/features/workbench/ChapterTree.tsx')
    const projectStore = read('src/renderer/stores/useProjectStore.ts')

    expect(workbench).toContain("openDialog('analysis', { initialType: 'knowledge' })")
    expect(workbench).toContain("openDialog('analysis', { initialType: 'report' })")
    expect(dialogHost).toContain("initialType={analysisInitialType ?? 'knowledge'}")
    expect(dialogHost).toContain('isReadOnly={isReadOnly}')
    expect(projectStore).toContain("project.mode === 'read_only'")
    expect(chapterTree).toContain('isReadOnly?: boolean')
    expect(chapterTree).toContain('const originalIndex = chapters.findIndex')
    expect(chapterTree).toContain('getChapterNumber(chapters, originalIndex)')
    expect(chapterTree).toContain('originalIndex <= 0')
    expect(chapterTree).toContain('originalIndex === chapters.length - 1')
  })

  it('keeps the UI migration constraints explicit', () => {
    const dialogDir = resolve(root, 'src/renderer/components/dialogs')
    for (const name of readdirSync(dialogDir).filter((item) => item.endsWith('.tsx'))) {
      const source = readFileSync(resolve(dialogDir, name), 'utf8')
      for (const match of source.matchAll(/<(?:Alert)?DialogContent\b([\s\S]*?)>/g)) {
        expect(match[1], name).toContain('frame={false}')
        expect(match[1], name).not.toMatch(/\b(?:p|px|py)-[^\s"`]+/)
      }
    }

    expect(read('src/renderer/components/dialogs/StartAnalysisDialog.tsx')).not.toMatch(/<input\b/)
    expect(read('src/renderer/features/shelf/ProjectShelf.tsx')).not.toContain("from 'motion/react'")
    expect(read('src/renderer/features/shelf/ProjectShelf.tsx')).toContain('texts-reveal')
    expect(read('src/renderer/components/ai/TaskRows.tsx')).toContain('title="暂停任务" aria-label="暂停任务"')
    expect(read('src/renderer/components/ai/TaskRows.tsx')).toContain('title="取消正在执行的任务"')
    expect(read('src/renderer/features/editor/EditorStatusBar.tsx')).toContain('key={totalWords}')
    expect(read('src/renderer/components/dialogs/SpotlightTour.tsx')).not.toContain('motion/react')
    expect(read('src/renderer/components/dialogs/StartAnalysisDialog.tsx')).toContain('canUsePipelines')
    expect(existsSync(resolve(root, 'docs/project-compatibility-and-capabilities.md'))).toBe(true)
    expect(read('.gitignore')).not.toMatch(/^docs\/$/m)
    expect(existsSync(resolve(root, 'docs/frontend-architecture.md'))).toBe(true)
    expect(existsSync(resolve(root, 'docs/adr/0005-renderer-component-and-workspace-interaction-hierarchy.md'))).toBe(true)
  })
})
