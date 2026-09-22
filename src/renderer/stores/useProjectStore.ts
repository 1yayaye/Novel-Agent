import { create } from 'zustand'
import type { Chapter, ChapterHeader, OpenProjectResult, RecentProject } from '../../shared/project'
import { errorText } from '../utils/formatters'

export interface ProjectState {
  project: OpenProjectResult | null
  recentProjects: RecentProject[]
  chapters: ChapterHeader[]
  selectedChapterId: string | null
  isLoading: boolean
  error: string | null

  fetchRecent: () => Promise<void>
  setProject: (project: OpenProjectResult | null) => void
  setChapters: (chapters: ChapterHeader[]) => void
  selectChapter: (id: string | null) => void
  loadProject: (opened: OpenProjectResult) => Promise<void>
  openProjectByPath: (path: string) => Promise<void>
  chooseAndOpenProject: () => Promise<void>
  closeProject: () => void
  createChapter: (title?: string) => Promise<Chapter | null>
  deleteChapter: (id: string) => Promise<void>
  renameChapter: (id: string, title: string) => Promise<void>
  reorderChapters: (chapters: ChapterHeader[]) => Promise<void>
  setError: (error: string | null) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  recentProjects: [],
  chapters: [],
  selectedChapterId: null,
  isLoading: false,
  error: null,

  fetchRecent: async () => {
    try {
      const list = await window.novelAgent.project.listRecent()
      set({ recentProjects: list })
    } catch (err) {
      console.error('Failed to list recent projects', err)
    }
  },

  setProject: (project) => set({ project }),
  setChapters: (chapters) => set({ chapters }),
  selectChapter: (id) => set({ selectedChapterId: id }),

  loadProject: async (opened: OpenProjectResult) => {
    set({ isLoading: true, error: null })
    try {
      const list = await window.novelAgent.chapter.list({ sessionId: opened.sessionId })
      const firstId = list.length > 0 ? list[0].id : null
      set({
        project: opened,
        chapters: list,
        selectedChapterId: firstId,
        isLoading: false
      })
      void get().fetchRecent()
    } catch (err) {
      set({
        error: errorText(err, '加载章节列表失败'),
        isLoading: false
      })
    }
  },

  openProjectByPath: async (path: string) => {
    set({ isLoading: true, error: null })
    try {
      const opened = await window.novelAgent.project.open({ path })
      await get().loadProject(opened)
    } catch (err) {
      set({
        error: errorText(err, '无法打开选中的作品项目'),
        isLoading: false
      })
    }
  },

  chooseAndOpenProject: async () => {
    set({ isLoading: true, error: null })
    try {
      const opened = await window.novelAgent.project.chooseAndOpen()
      if (opened) {
        await get().loadProject(opened)
      } else {
        set({ isLoading: false })
      }
    } catch (err) {
      set({
        error: errorText(err, '无法打开所选项目文件'),
        isLoading: false
      })
    }
  },

  closeProject: () => {
    set({
      project: null,
      chapters: [],
      selectedChapterId: null,
      error: null
    })
    void get().fetchRecent()
  },

  createChapter: async (title?: string) => {
    const { project, chapters } = get()
    if (!project) return null

    const defaultTitle = title || `第${chapters.length + 1}章`
    try {
      const created = await window.novelAgent.chapter.create({
        sessionId: project.sessionId,
        title: defaultTitle,
        content: ''
      })
      const list = await window.novelAgent.chapter.list({ sessionId: project.sessionId })
      set({
        chapters: list,
        selectedChapterId: created.id
      })
      return created
    } catch (err) {
      set({ error: errorText(err, '新建章节失败') })
      return null
    }
  },

  deleteChapter: async (id: string) => {
    const { project, selectedChapterId, chapters } = get()
    if (!project) return

    const target = chapters.find((c) => c.id === id)
    try {
      await window.novelAgent.chapter.delete({
        sessionId: project.sessionId,
        chapterId: id,
        expectedVersion: target?.version ?? 1
      })
      const list = await window.novelAgent.chapter.list({ sessionId: project.sessionId })
      let nextSelected = selectedChapterId
      if (selectedChapterId === id) {
        nextSelected = list.length > 0 ? list[0].id : null
      }
      set({
        chapters: list,
        selectedChapterId: nextSelected
      })
    } catch (err) {
      set({ error: errorText(err, '删除章节失败') })
    }
  },

  renameChapter: async (id: string, title: string) => {
    const { project, chapters } = get()
    if (!project) return

    const target = chapters.find((c) => c.id === id)
    try {
      await window.novelAgent.chapter.rename({
        sessionId: project.sessionId,
        chapterId: id,
        title,
        expectedVersion: target?.version ?? 1
      })
      const list = await window.novelAgent.chapter.list({ sessionId: project.sessionId })
      set({ chapters: list })
    } catch (err) {
      set({ error: errorText(err, '重命名章节失败') })
    }
  },

  reorderChapters: async (newOrder: ChapterHeader[]) => {
    const { project } = get()
    if (!project) return

    set({ chapters: newOrder })
    try {
      await window.novelAgent.chapter.reorder({
        sessionId: project.sessionId,
        chapters: newOrder.map((c) => ({ id: c.id, expectedVersion: c.version }))
      })
    } catch (err) {
      set({ error: errorText(err, '章节排序更新失败') })
    }
  },

  setError: (error) => set({ error })
}))
