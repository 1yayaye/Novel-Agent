import { Suspense, useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import type { ChapterHeader, ImportPreviewResult, OpenProjectResult, RecentProject } from '../shared/project'
import { errorText } from './utils/formatters'
import { ImportPreview } from './components/dialogs/ImportPreview'
import { ProjectShelf } from './components/shelf/ProjectShelf'
import { WindowControls } from './components/common/WindowControls'
import { ToastProvider } from './components/common/Toast'
import { lazyNamed } from './utils/lazyNamed'

const Workbench = lazyNamed(() => import('./components/workbench/Workbench.js'), 'Workbench')

export default function App() {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [preview, setPreview] = useState<NonNullable<ImportPreviewResult> | null>(null)
  const [project, setProject] = useState<OpenProjectResult | null>(null)
  const [chapters, setChapters] = useState<ChapterHeader[]>([])
  const [error, setError] = useState('')

  const fetchRecent = async () => {
    try {
      const list = await window.novelAgent.project.listRecent()
      setRecentProjects(list)
    } catch (err) {
      console.error('Failed to load recent projects', err)
    }
  }

  useEffect(() => {
    void fetchRecent()
  }, [])

  useEffect(() => {
    document.title = project ? `${project.metadata.title} - Novel Agent by matsuri` : 'Novel Agent by matsuri'
  }, [project])

  const startImport = async () => {
    try {
      const result = await window.novelAgent.project.previewImport({})
      if (result) setPreview(result)
      setError('')
    } catch (error) {
      setError(errorText(error, '无法预览原文'))
    }
  }

  const loadProject = async (opened: OpenProjectResult) => {
    const list = await window.novelAgent.chapter.list({ sessionId: opened.sessionId })
    setChapters(list)
    setProject(opened)
    setPreview(null)
    setError('')
    void fetchRecent()
  }

  const openProjectByPath = async (path: string) => {
    try {
      setError('')
      const opened = await window.novelAgent.project.open({ path })
      await loadProject(opened)
    } catch (err) {
      setError(errorText(err, '无法打开选中的作品项目'))
    }
  }

  const chooseAndOpenProject = async () => {
    try {
      setError('')
      const opened = await window.novelAgent.project.chooseAndOpen()
      if (opened) await loadProject(opened)
    } catch (err) {
      setError(errorText(err, '无法打开所选项目文件'))
    }
  }

  const handleCloseProject = () => {
    setProject(null)
    setChapters([])
    void fetchRecent()
  }

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {project ? (
          <Suspense fallback={<div className="workbench" aria-busy="true" />}>
            <Workbench
              project={project}
              initialChapters={chapters}
              onProjectReloaded={(reopened) => void loadProject(reopened)}
              onCloseProject={handleCloseProject}
            />
          </Suspense>
        ) : (
          <div className="app-shell">
            <header className="topbar">
              <div className="brand"><strong>Novel Agent</strong><span>by matsuri</span></div>
              <div className="topbar-right">
                <div className="local-status"><span className="status-dot" />数据仅保存在本机</div>
                <div className="topbar-divider" />
                <WindowControls />
              </div>
            </header>
            <ProjectShelf
              recentProjects={recentProjects}
              error={error}
              onOpenProject={(path) => void openProjectByPath(path)}
              onChooseOpen={() => void chooseAndOpenProject()}
              onStartImport={() => void startImport()}
            />
          </div>
        )}
        <AnimatePresence>
          {preview && (
            <ImportPreview
              preview={preview}
              onClose={() => setPreview(null)}
              onImported={(opened) => void loadProject(opened)}
            />
          )}
        </AnimatePresence>
      </ToastProvider>
    </MotionConfig>
  )
}
