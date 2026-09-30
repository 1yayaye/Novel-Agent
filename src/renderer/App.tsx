import React, { Suspense, useEffect, useState } from 'react'
import type { ImportPreviewResult, OpenProjectResult } from '../shared/project'
import { errorText } from './utils/formatters'
import { WindowControls } from './components/common/WindowControls'
import { ToastProvider } from './components/common/Toast'
import { ProjectShelf } from './features/shelf/ProjectShelf'
import { ImportPreviewModal } from './features/shelf/ImportPreviewModal'
import { WorkbenchLayout } from './features/workbench/WorkbenchLayout'
import { useProjectStore } from './stores/useProjectStore'

export default function App() {
  const {
    project,
    recentProjects,
    chapters,
    error,
    fetchRecent,
    loadProject,
    openProjectByPath,
    chooseAndOpenProject,
    closeProject,
    setError
  } = useProjectStore()

  const [preview, setPreview] = useState<NonNullable<ImportPreviewResult> | null>(null)

  useEffect(() => {
    void fetchRecent()
  }, [fetchRecent])

  useEffect(() => {
    document.title = project
      ? `${project.metadata.title} - Novel Agent by matsuri`
      : 'Novel Agent by matsuri'
  }, [project])

  const startImport = async () => {
    try {
      const result = await window.novelAgent.project.previewImport({})
      if (result) setPreview(result)
      setError(null)
    } catch (err) {
      setError(errorText(err, '无法预览原文'))
    }
  }

  return (
    <ToastProvider>
        {project ? (
          <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#faf8f5]" aria-busy="true" />}>
            <WorkbenchLayout
              project={project}
              initialChapters={chapters}
              onProjectReloaded={(reopened) => void loadProject(reopened)}
              onCloseProject={closeProject}
            />
          </Suspense>
        ) : (
          <div className="flex flex-col h-screen w-screen bg-[#faf8f5] overflow-hidden select-none">
            {/* Shelf Topbar with drag region */}
            <header className="drag-region h-11 border-b border-[#e5ddd3] bg-[#faf8f5] flex items-center justify-between px-4 shrink-0">
              <div className="no-drag-region flex items-center gap-2">
                <span className="font-bold text-xs tracking-wider text-[#2c2523] font-serif">
                  Novel Agent
                </span>
                <span className="text-[10px] text-[#7d6b59] font-sans">by matsuri</span>
              </div>
              <div className="no-drag-region flex items-center gap-3 text-xs text-[#7d6b59]">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2d6a4f]" />
                  <span>本地离线存储</span>
                </div>
                <div className="h-3 w-px bg-[#e5ddd3]" />
                <WindowControls />
              </div>
            </header>

            {/* Shelf main content */}
            <ProjectShelf
              recentProjects={recentProjects}
              error={error}
              onOpenProject={(path) => void openProjectByPath(path)}
              onChooseOpen={() => void chooseAndOpenProject()}
              onStartImport={() => void startImport()}
            />
          </div>
        )}

        {preview && (
            <ImportPreviewModal
              preview={preview}
              onClose={() => setPreview(null)}
              onImported={(opened) => {
                setPreview(null)
                void loadProject(opened)
              }}
            />
          )}
      </ToastProvider>
  )
}
