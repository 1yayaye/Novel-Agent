import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Compass, ScrollText, FileBarChart } from 'lucide-react'
import type { Chapter, ChapterHeader, OpenProjectResult } from '../../../shared/project'
import type { EditorHandle } from '../../types/editor'
import { useProjectStore } from '../../stores/useProjectStore'
import { useEditorStore } from '../../stores/useEditorStore'
import { useWorkbenchStore } from '../../stores/useWorkbenchStore'
import { useTaskStore } from '../../stores/useTaskStore'
import { TopBar } from './TopBar'
import { NavRail } from './NavRail'
import { ChapterTree } from './ChapterTree'
import { ActionDock } from './ActionDock'
import { EditorHost } from '../editor/EditorHost'
import { EmptyChapterState } from '../editor/EmptyChapterState'
import { DrawerHost } from '../drawer/DrawerHost'
import { DialogHost } from '../dialogs/DialogHost'
import { WorkflowGuideBanner } from '../../components/workbench/WorkflowGuideBanner'
import { IconButton } from '../../components/common/IconButton'

export interface WorkbenchLayoutProps {
  project: OpenProjectResult
  initialChapters: ChapterHeader[]
  onProjectReloaded?: (reloaded: OpenProjectResult) => void
  onCloseProject?: () => void
}

export function WorkbenchLayout({
  project,
  initialChapters,
  onProjectReloaded,
  onCloseProject
}: WorkbenchLayoutProps) {
  const {
    chapters,
    selectedChapterId,
    selectChapter,
    createChapter,
    deleteChapter,
    renameChapter,
    reorderChapters,
    setChapters
  } = useProjectStore()

  const {
    activeChapter,
    loadChapter,
    preferences,
    setPreferences,
    isReadOnly
  } = useEditorStore()

  const {
    isNavExpanded,
    toggleNavExpanded,
    isZenMode,
    toggleZenMode,
    setZenMode,
    activeDrawer,
    toggleDrawer,
    activeDialog,
    openDialog
  } = useWorkbenchStore()

  const editorRef = useRef<EditorHandle | null>(null)
  const [activeTaskProgress, setActiveTaskProgress] = useState<{
    title?: string
    progress?: number
    state?: string
    taskId?: string
  } | null>(null)
  const [defaultConn, setDefaultConn] = useState<{
    name: string
    baseUrl: string
    confirmedContentTargetFingerprint?: string
  } | null>(null)

  const [summaryCount, setSummaryCount] = useState(0)
  const [reportCount, setReportCount] = useState(0)

  // Initialize chapters into project store on mount
  useEffect(() => {
    if (initialChapters.length > 0) {
      setChapters(initialChapters)
      if (!selectedChapterId) {
        selectChapter(initialChapters[0].id)
      }
    }
  }, [initialChapters])

  // Load active chapter from backend when selectedChapterId changes
  useEffect(() => {
    if (!selectedChapterId) {
      loadChapter(null, isReadOnly)
      return
    }

    let active = true
    window.novelAgent.chapter
      .get({
        sessionId: project.sessionId,
        chapterId: selectedChapterId
      })
      .then((chap) => {
        if (active) {
          loadChapter(chap, isReadOnly)
        }
      })
      .catch((err) => {
        console.error('Failed to load chapter content', err)
      })

    return () => {
      active = false
    }
  }, [selectedChapterId, project.sessionId, isReadOnly])

  // Fetch model connections & analysis summary on mount
  useEffect(() => {
    window.novelAgent.connection
      .list({ kind: 'generation' })
      .then((list: any[]) => {
        if (list && list.length > 0) {
          setDefaultConn(list[0])
        }
      })
      .catch(() => {})

    window.novelAgent.chapterSummary
      ?.list({ sessionId: project.sessionId })
      .then((list: any[]) => {
        if (Array.isArray(list)) setSummaryCount(list.length)
      })
      .catch(() => {})

    window.novelAgent.report
      ?.list({ sessionId: project.sessionId })
      .then((list: any[]) => {
        if (Array.isArray(list)) setReportCount(list.length)
      })
      .catch(() => {})
  }, [project.sessionId])

  // Subscribe to background tasks
  useEffect(() => {
    const unsub = window.novelAgent?.task?.onProgress?.((event: any) => {
      setActiveTaskProgress(event)
      if (event?.taskId) {
        useTaskStore.getState().updateOrAddTask({
          id: event.taskId,
          type: event.taskType || event.type || 'task',
          title: event.title || '后台任务',
          progress: event.progress ?? 0,
          status: event.state || event.status || 'running',
          stage: event.stage || '',
          message: event.message
        })
      }
      if (event.state === 'completed' || event.state === 'failed' || event.state === 'cancelled') {
        window.setTimeout(() => {
          setActiveTaskProgress((prev) => (prev?.taskId === event.taskId ? null : prev))
        }, 4000)
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  // Global Escape key listener for Zen Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const hasCmSearch =
          typeof document !== 'undefined' && Boolean(document.querySelector('.cm-panel.cm-search'))
        const hasActiveModal = activeDialog !== null
        if (isZenMode && !hasActiveModal && !hasCmSearch) {
          e.preventDefault()
          setZenMode(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isZenMode, activeDialog, setZenMode])

  const handleCreateChapter = async () => {
    await editorRef.current?.flush()
    const newChap = await createChapter()
    if (newChap) {
      loadChapter(newChap, isReadOnly)
    }
  }

  const handleSelectChapter = async (id: string) => {
    if (id === selectedChapterId) return
    await editorRef.current?.flush()
    selectChapter(id)
  }

  const handleMoveChapter = (id: string, direction: -1 | 1) => {
    const idx = chapters.findIndex((c) => c.id === id)
    if (idx < 0) return
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= chapters.length) return
    const newChapters = [...chapters]
    const [moved] = newChapters.splice(idx, 1)
    newChapters.splice(targetIdx, 0, moved)
    void reorderChapters(newChapters)
  }

  const handleDeleteChapter = (id: string) => {
    const chap = chapters.find((c) => c.id === id)
    openDialog('confirm', {
      title: '删除章节',
      message: `确定要删除「${chap?.title || '此章节'}」吗？删除后正文不会立即丢失，但将从目录中移除。`,
      confirmText: '删除章节',
      confirmVariant: 'danger',
      onConfirm: async () => {
        await deleteChapter(id)
      }
    })
  }

  const handleReturnToShelf = async () => {
    try {
      await editorRef.current?.flush()
      await window.novelAgent.project.close({ sessionId: project.sessionId })
    } catch {}
    onCloseProject?.()
  }

  return (
    <div className={`workbench flex flex-col h-screen w-screen overflow-hidden bg-[#faf8f5] ${isZenMode ? 'zen-mode-active' : ''}`}>
      {/* TopBar (Hidden in Zen Mode) */}
      {!isZenMode && (
        <TopBar
          onReturnToShelf={handleReturnToShelf}
          activeTaskProgress={activeTaskProgress}
          defaultConnection={defaultConn}
        />
      )}

      {/* Main Body */}
      <div className={`workbench-body flex-1 flex min-h-0 relative ${isZenMode ? 'zen-body' : ''}`}>
        {/* Left NavRail */}
        {!isZenMode && (
          <NavRail
            activeDialog={activeDialog}
            isExpanded={isNavExpanded}
            onToggleExpanded={toggleNavExpanded}
            onSelectAction={(actionKey) => {
              if (actionKey === 'write') {
                useWorkbenchStore.getState().closeDialog()
              } else if (actionKey === 'tasks') {
                toggleDrawer('tasks')
              } else if (actionKey === 'candidateReview' || actionKey === 'candidate') {
                openDialog('candidate')
              } else if (actionKey === 'consistency' || actionKey === 'issues') {
                openDialog('issues')
              } else if (actionKey === 'suggestions' || actionKey === 'suggestion') {
                openDialog('suggestion')
              } else {
                openDialog(actionKey as any)
              }
            }}
          />
        )}

        {/* Chapter Tree Sidebar */}
        {!isZenMode && (
          <div className="flex flex-col h-full shrink-0">
            <div className="hidden">
              <IconButton
                className="drawer-toggle-button"
                title="显示章节信息"
                label="显示章节信息"
                onClick={() => toggleDrawer('inspector')}
              >
                <FileBarChart size={14} />
              </IconButton>
              <IconButton
                title="项目大纲与脉络"
                label="项目大纲"
                onClick={() => openDialog('outline')}
              >
                <Compass size={14} />
              </IconButton>
              <IconButton
                title="全书大纲与故事梗概"
                label="全书大纲"
                onClick={() => openDialog('synopsis')}
              >
                <ScrollText size={14} />
              </IconButton>
            </div>
            <ChapterTree
              chapters={chapters}
              selectedChapterId={selectedChapterId}
              onSelectChapter={handleSelectChapter}
              onCreateChapter={handleCreateChapter}
              onRenameChapter={(id, newTitle) => {
                void renameChapter(id, newTitle)
              }}
              onDeleteChapter={handleDeleteChapter}
              onMoveChapter={handleMoveChapter}
            />
          </div>
        )}

        {/* Central Writing Canvas Area */}
        <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-[#faf8f5]">
          {/* Optional Pre-analysis onboarding guide banner */}
          {!isZenMode && chapters.length > 0 && summaryCount === 0 && (
            <WorkflowGuideBanner
              totalChapters={chapters.length}
              summaryCount={summaryCount}
              reportCount={reportCount}
              isReadOnly={isReadOnly}
              onStartKnowledgeAnalysis={() => openDialog('analysis')}
              onStartReportAnalysis={() => openDialog('analysis')}
            />
          )}

          {activeChapter ? (
            <EditorHost
              sessionId={project.sessionId}
              chapter={activeChapter}
              isReadOnly={isReadOnly}
              preferences={preferences}
              isZenMode={isZenMode}
              onToggleZenMode={toggleZenMode}
              onSaved={(updated) => {
                loadChapter(updated, isReadOnly)
              }}
              onPreferencesChange={setPreferences}
              setHandle={(h) => {
                editorRef.current = h
              }}
              onUpdateChapterTitle={(title) => {
                if (activeChapter) {
                  void renameChapter(activeChapter.id, title)
                }
              }}
              onPolishSelection={(text) => {
                openDialog('chat', { initialPrompt: `请对以下正文选段进行润色提升：\n\n${text}` })
              }}
              onExpandSelection={(text) => {
                openDialog('chat', { initialPrompt: `请对以下正文选段进行生动扩写与场景烘托：\n\n${text}` })
              }}
              onSummarizeSelection={(text) => {
                openDialog('chat', { initialPrompt: `请精简以下正文选段，去除多余冗词：\n\n${text}` })
              }}
            />
          ) : (
            <EmptyChapterState
              isReadOnly={isReadOnly}
              onCreateChapter={handleCreateChapter}
            />
          )}

          {/* Floating Action Dock at bottom */}
          <ActionDock
            onToggleZenMode={toggleZenMode}
            isZenMode={isZenMode}
          />
        </main>

        {/* Right slide-over reference drawer */}
        {!isZenMode && (
          <DrawerHost
            currentChapter={activeChapter}
            onSelectChapter={handleSelectChapter}
            onCreateSnapshot={() => openDialog('backup')}
          />
        )}
      </div>

      {/* Modal Dialogs Host */}
      <DialogHost
        onChapterCreated={(created) => {
          handleSelectChapter(created.id)
        }}
        onNavigateSearch={(chapId, offset, length) => {
          if (chapId) {
            void handleSelectChapter(chapId).then(() => {
              window.setTimeout(() => {
                editorRef.current?.selectRange(offset ?? 0, length ?? 0)
              }, 60)
            })
          }
        }}
      />
    </div>
  )
}
