import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  FileBarChart,
  FileDown,
  GitCompare,
  HelpCircle,
  Layers,
  ListOrdered,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  ScrollText,
  Search,
  Sliders,
  Sparkles,
  X
} from 'lucide-react'
import { toChapterHeader } from '../../../shared/project'
import type {
  Chapter,
  ChapterHeader,
  ModelConnectionSummary,
  OpenProjectResult,
  TaskProgressEvent,
  TaskRouteSummary,
  TaskType
} from '../../../shared/project'
import type { ChapterAction, EditorHandle, SaveState } from '../../types/editor'
import { count, errorText } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { getEndpointHost } from '../../utils/crypto'
import { stateLabel } from '../../utils/constants'
import { lazyNamed } from '../../utils/lazyNamed'
import { IconButton } from '../common/IconButton'
import { WindowControls } from '../common/WindowControls'
import { useToast } from '../common/Toast'
import { ChapterEditor } from '../editor/ChapterEditor'
import { Inspector } from '../editor/Inspector'
import { EmptyChapterState } from '../editor/EmptyChapterState'
import { WorkflowGuideBanner } from './WorkflowGuideBanner'
import { NavRail } from './NavRail'

const ChapterActionDialog = lazyNamed(() => import('../dialogs/ChapterActionDialog.js'), 'ChapterActionDialog')
const SearchDialog = lazyNamed(() => import('../dialogs/SearchDialog.js'), 'SearchDialog')
const CandidateReviewDialog = lazyNamed(() => import('../dialogs/CandidateReviewDialog.js'), 'CandidateReviewDialog')
const TaskCenterDialog = lazyNamed(() => import('../dialogs/TaskCenterDialog.js'), 'TaskCenterDialog')
const ConsistencyIssuesDialog = lazyNamed(() => import('../dialogs/ConsistencyIssuesDialog.js'), 'ConsistencyIssuesDialog')
const LiteraryReportsDialog = lazyNamed(() => import('../dialogs/LiteraryReportsDialog.js'), 'LiteraryReportsDialog')
const SynopsisDialog = lazyNamed(() => import('../dialogs/SynopsisDialog.js'), 'SynopsisDialog')
const StartAnalysisDialog = lazyNamed(() => import('../dialogs/StartAnalysisDialog.js'), 'StartAnalysisDialog')
const KnowledgeBaseDialog = lazyNamed(() => import('../dialogs/KnowledgeBaseDialog.js'), 'KnowledgeBaseDialog')
const CreativeSettingsDialog = lazyNamed(() => import('../dialogs/CreativeSettingsDialog.js'), 'CreativeSettingsDialog')
const SuggestionReviewDialog = lazyNamed(() => import('../dialogs/SuggestionReviewDialog.js'), 'SuggestionReviewDialog')
const ConnectionDialog = lazyNamed(() => import('../dialogs/ConnectionDialog.js'), 'ConnectionDialog')
const BackupDialog = lazyNamed(() => import('../dialogs/BackupDialog.js'), 'BackupDialog')
const ContextPreviewDialog = lazyNamed(() => import('../dialogs/ContextPreviewDialog.js'), 'ContextPreviewDialog')
const ExportDialog = lazyNamed(() => import('../dialogs/ExportDialog.js'), 'ExportDialog')
const ChatWorkbenchDialog = lazyNamed(() => import('../dialogs/ChatWorkbenchDialog.js'), 'ChatWorkbenchDialog')
const OutlineEditorDialog = lazyNamed(() => import('../dialogs/OutlineEditorDialog.js'), 'OutlineEditorDialog')
const SpotlightTour = lazyNamed(() => import('../dialogs/SpotlightTour.js'), 'SpotlightTour')

export type ActiveDialog =
  | 'backup'
  | 'export'
  | 'search'
  | 'knowledge'
  | 'creative'
  | 'suggestions'
  | 'connection'
  | 'tasks'
  | 'consistency'
  | 'reports'
  | 'synopsis'
  | 'outline'
  | 'contextPreview'
  | 'candidateReview'
  | 'chat'
  | 'startAnalysis'
  | 'tour'
  | null

export function Workbench({
  project,
  initialChapters,
  onProjectReloaded,
  onCloseProject
}: {
  project: OpenProjectResult
  initialChapters: ChapterHeader[]
  onProjectReloaded: (opened: OpenProjectResult) => void
  onCloseProject?: () => void
}) {
  const { sessionId } = project
  const readOnly = project.mode === 'read_only'
  const [chapters, setChapters] = useState<ChapterHeader[]>(initialChapters)
  const [activeId, setActiveId] = useState(initialChapters[0]?.id)
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null)
  const [saveState, setSaveState] = useState<SaveState>(readOnly ? 'read_only' : 'saved')
  const [drawer, setDrawer] = useState(false)
  const [action, setAction] = useState<ChapterAction | null>(null)
  const [actionError, setActionError] = useState('')

  // Unified modal dialog state machine
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null)

  const createDialogToggler = (key: ActiveDialog) => {
    return (val: boolean | ((prev: boolean) => boolean)) => {
      setActiveDialog((prevDialog) => {
        const currentIsOpen = prevDialog === key
        const nextIsOpen = typeof val === 'function' ? val(currentIsOpen) : val
        return nextIsOpen ? key : prevDialog === key ? null : prevDialog
      })
    }
  }

  const backupOpen = activeDialog === 'backup'
  const setBackupOpen = createDialogToggler('backup')

  const exportOpen = activeDialog === 'export'
  const setExportOpen = createDialogToggler('export')

  const searchOpen = activeDialog === 'search'
  const setSearchOpen = createDialogToggler('search')

  const knowledgeOpen = activeDialog === 'knowledge'
  const setKnowledgeOpen = createDialogToggler('knowledge')

  const creativeOpen = activeDialog === 'creative'
  const setCreativeOpen = createDialogToggler('creative')

  const suggestionsOpen = activeDialog === 'suggestions'
  const setSuggestionsOpen = createDialogToggler('suggestions')

  const connectionOpen = activeDialog === 'connection'
  const setConnectionOpen = createDialogToggler('connection')

  const tasksOpen = activeDialog === 'tasks'
  const setTasksOpen = createDialogToggler('tasks')

  const consistencyOpen = activeDialog === 'consistency'
  const setConsistencyOpen = createDialogToggler('consistency')

  const reportsOpen = activeDialog === 'reports'
  const setReportsOpen = createDialogToggler('reports')

  const synopsisOpen = activeDialog === 'synopsis'
  const setSynopsisOpen = createDialogToggler('synopsis')

  const outlineOpen = activeDialog === 'outline'
  const setOutlineOpen = createDialogToggler('outline')

  const contextPreviewOpen = activeDialog === 'contextPreview'
  const setContextPreviewOpen = createDialogToggler('contextPreview')
  const [contextTaskType, setContextTaskType] = useState<TaskType>('continue')
  const [contextStage, setContextStage] = useState<import('../../../shared/project').ChatWorkflowStage | undefined>()
  const [contextWorkflowType, setContextWorkflowType] = useState<import('../../../shared/project').ChatWorkflowType | undefined>()
  const [contextOutlineId, setContextOutlineId] = useState<string | undefined>()
  const [contextOutlineVersion, setContextOutlineVersion] = useState<number | undefined>()
  const [contextChatSessionId, setContextChatSessionId] = useState<string | undefined>()

  const candidateReviewOpen = activeDialog === 'candidateReview'
  const setCandidateReviewOpen = createDialogToggler('candidateReview')

  const chatOpen = activeDialog === 'chat'
  const setChatOpen = createDialogToggler('chat')
  const [activeCandidateId, setActiveCandidateId] = useState<string | undefined>()

  const startAnalysisOpen = activeDialog === 'startAnalysis'
  const setStartAnalysisOpen = createDialogToggler('startAnalysis')
  const [startAnalysisType, setStartAnalysisType] = useState<'knowledge' | 'report' | 'synopsis'>('knowledge')
  const [summaryCount, setSummaryCount] = useState<number>(0)
  const [reportCount, setReportCount] = useState<number>(0)

  const handleOpenAnalysis = (type: 'knowledge' | 'report' | 'synopsis' = 'knowledge') => {
    setStartAnalysisType(type)
    setStartAnalysisOpen(true)
  }

  const fetchAnalysisOverview = useCallback(async () => {
    try {
      const [sums, reps] = await Promise.all([
        window.novelAgent.chapterSummary.list({ sessionId }),
        window.novelAgent.report.list({ sessionId })
      ])
      setSummaryCount(sums.length)
      setReportCount(reps.length)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    void fetchAnalysisOverview()
  }, [fetchAnalysisOverview])

  const [isNavExpanded, setIsNavExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('novel-agent-nav-expanded') === 'true'
    } catch {
      return false
    }
  })

  const handleToggleNavExpanded = () => {
    setIsNavExpanded((prev) => {
      const next = !prev
      try {
        localStorage.setItem('novel-agent-nav-expanded', String(next))
      } catch {}
      return next
    })
  }

  const handleSelectNavAction = (actionKey: string) => {
    switch (actionKey) {
      case 'write':
        setActiveDialog(null)
        break
      case 'outline':
        setOutlineOpen(true)
        break
      case 'chat':
        setChatOpen(true)
        break
      case 'candidateReview':
        setCandidateReviewOpen(true)
        break
      case 'knowledge':
        setKnowledgeOpen(true)
        break
      case 'reports':
        setReportsOpen(true)
        break
      case 'consistency':
        setConsistencyOpen(true)
        break
      case 'suggestions':
        setSuggestionsOpen(true)
        break
      case 'tasks':
        setTasksOpen(true)
        break
      case 'connection':
        setConnectionOpen(true)
        break
      case 'creative':
        setCreativeOpen(true)
        break
      case 'search':
        setSearchOpen(true)
        break
      case 'backup':
        setBackupOpen(true)
        break
      case 'export':
        setExportOpen(true)
        break
      case 'tour':
        setTourOpen(true)
        break
    }
  }

  const tourOpen = activeDialog === 'tour'
  const setTourOpen = createDialogToggler('tour')
  const [activeProgress, setActiveProgress] = useState<TaskProgressEvent | null>(null)
  const [taskRoutes, setTaskRoutes] = useState<TaskRouteSummary[]>(project.taskRoutes || [])
  const [defaultConn, setDefaultConn] = useState<ModelConnectionSummary | null>(null)
  const [isZenMode, setIsZenMode] = useState(false)
  const { showToast } = useToast()
  const [preferences, setPreferences] = useState<import('../../types/editor').EditorPreferences>(() => {
    try {
      const saved = localStorage.getItem('novel-agent-editor-prefs')
      if (saved) return JSON.parse(saved)
    } catch {}
    return {
      theme: 'light',
      fontSize: 16,
      fontFamily: 'serif',
      contentWidth: 'normal',
      indentParagraphs: true,
      highlightLine: true
    }
  })
  const editor = useRef<EditorHandle | null>(null)
  const activeHeader = chapters.find(({ id }) => id === activeId)
  const activeIndex = activeHeader ? chapters.indexOf(activeHeader) : -1
  const activeChapterNumber = activeIndex >= 0 ? getChapterNumber(chapters, activeIndex) : undefined

  const handlePreferencesChange = (
    updater: (prev: import('../../types/editor').EditorPreferences) => import('../../types/editor').EditorPreferences
  ) => {
    setPreferences((prev) => {
      const next = updater(prev)
      try {
        localStorage.setItem('novel-agent-editor-prefs', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  useEffect(() => {
    const unsub = window.novelAgent?.task?.onProgress?.((event) => {
      setActiveProgress(event)
      if (event.state === 'completed' || event.state === 'failed' || event.state === 'cancelled') {
        if (event.state === 'completed') {
          void fetchAnalysisOverview()
          showToast('分析任务已顺利完成，已更新剧情摘要与大纲数据', 'success')
        }
        window.setTimeout(() => {
          setActiveProgress((prev) => prev?.taskId === event.taskId ? null : prev)
        }, 4000)
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [fetchAnalysisOverview, showToast])

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.novelAgent.connection.list({ kind: 'generation' })
        if (list.length > 0) {
          const continueRoute = taskRoutes.find((r) => r.taskType === 'continue' && r.resolution === 'resolved')
          const matched = continueRoute ? list.find((c) => c.id === continueRoute.connectionId) : list[0]
          setDefaultConn(matched || list[0])
        } else {
          setDefaultConn(null)
        }
      } catch {}
    })()
  }, [taskRoutes, connectionOpen])

  useEffect(() => {
    let cancelled = false
    if (!activeId) {
      setActiveChapter(null)
      return
    }

    void window.novelAgent.chapter.get({ sessionId, chapterId: activeId }).then((chapter) => {
      if (!cancelled) setActiveChapter(chapter)
    }).catch((error) => {
      if (!cancelled) showToast(errorText(error, '加载章节失败'), 'error')
    })

    return () => {
      cancelled = true
    }
  }, [sessionId, activeId, showToast])

  const hasActiveModal = Boolean(
    action ||
      backupOpen ||
      exportOpen ||
      searchOpen ||
      knowledgeOpen ||
      creativeOpen ||
      suggestionsOpen ||
      connectionOpen ||
      tasksOpen ||
      consistencyOpen ||
      reportsOpen ||
      synopsisOpen ||
      outlineOpen ||
      contextPreviewOpen ||
      candidateReviewOpen ||
      chatOpen ||
      startAnalysisOpen ||
      tourOpen ||
      drawer
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const hasCmSearch = typeof document !== 'undefined' && Boolean(document.querySelector('.cm-panel.cm-search'))
        if (isZenMode && !hasActiveModal && !hasCmSearch) {
          e.preventDefault()
          setIsZenMode(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isZenMode, hasActiveModal])

  const update = (chapter: Chapter) => {
    setChapters((items) => items.map((item) => item.id === chapter.id ? toChapterHeader(chapter) : item))
    setActiveChapter((current) => current?.id === chapter.id ? chapter : current)
  }
  const flush = () => editor.current?.flush() ?? Promise.resolve(true)
  const runStructure = async (action: (latest: ChapterHeader[]) => Promise<ChapterHeader[]>) => {
    if (!await flush()) return
    const result = await action(await window.novelAgent.chapter.list({ sessionId }))
    setChapters(result)
    const nextActiveId = result.some(({ id }) => id === activeId) ? activeId : result[0]?.id
    if (nextActiveId !== activeId) {
      setActiveId(nextActiveId)
    } else if (nextActiveId) {
      void window.novelAgent.chapter.get({ sessionId, chapterId: nextActiveId }).then(setActiveChapter).catch((error) => {
        showToast(errorText(error, '加载章节失败'), 'error')
      })
    } else {
      setActiveChapter(null)
    }
  }
  const select = async (id: string) => {
    if (id === activeId) return
    if (await flush()) {
      setActiveId(id)
    }
  }

  const handleSearchNavigate = async (chapterId?: string, offset?: number, length = 0) => {
    if (chapterId) {
      await select(chapterId)
      setSearchOpen(false)
      window.setTimeout(() => {
        editor.current?.selectRange(offset ?? 0, length)
      }, 60)
    }
  }

  const handleNavigateChapterOffset = async (chapterId: string, startOffset = 0, length = 0) => {
    await select(chapterId)
    window.setTimeout(() => {
      editor.current?.selectRange(startOffset, length)
    }, 60)
  }

  const handleStartCreation = async (contextPackageId: string, taskType: TaskType) => {
    setContextPreviewOpen(false)
    try {
      const started = await window.novelAgent.creation.start({ sessionId, contextPackageId })
      setActiveCandidateId(started.candidateId)
      setCandidateReviewOpen(true)
    } catch (err) {
      showToast(errorText(err, '启动生成失败'), 'error')
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const move = async (direction: -1 | 1) => {
    await runStructure((latest) => {
      const index = latest.findIndex(({ id }) => id === activeId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= latest.length) return Promise.resolve(latest)
      const order = [...latest]
      ;[order[index], order[target]] = [order[target], order[index]]
      return window.novelAgent.chapter.reorder({ sessionId, chapters: order.map(({ id, version }) => ({ id, expectedVersion: version })) })
    })
  }
  const submitAction = async () => {
    if (!action) return
    try {
      if (action.kind === 'create') {
        if (!await flush()) return
        const added = await window.novelAgent.chapter.create({ sessionId, title: action.title, content: '' })
        setChapters((items) => [...items, toChapterHeader(added)])
        setActiveChapter(added)
        setActiveId(added.id)
      } else if (action.kind === 'rename') {
        if (!await flush()) return
        const latest = (await window.novelAgent.chapter.list({ sessionId })).find(({ id }) => id === activeId)
        if (latest) update(await window.novelAgent.chapter.rename({ sessionId, chapterId: latest.id, title: action.title, expectedVersion: latest.version }))
      } else if (action.kind === 'split') {
        await runStructure((latest) => {
          const current = latest.find(({ id }) => id === activeId)
          return current ? window.novelAgent.chapter.split({ sessionId, chapterId: current.id, offset: action.offset ?? 0, newTitle: action.title, expectedVersion: current.version }) : Promise.resolve(latest)
        })
      } else if (action.kind === 'merge') {
        await runStructure((latest) => {
          const index = latest.findIndex(({ id }) => id === activeId)
          const current = latest[index]
          const next = latest[index + 1]
          return current && next ? window.novelAgent.chapter.merge({ sessionId, chapterId: current.id, expectedVersion: current.version, nextExpectedVersion: next.version }) : Promise.resolve(latest)
        })
      } else {
        await runStructure(async (latest) => {
          const current = latest.find(({ id }) => id === activeId)
          if (current) await window.novelAgent.chapter.delete({ sessionId, chapterId: current.id, expectedVersion: current.version })
          return window.novelAgent.chapter.list({ sessionId })
        })
      }
      setAction(null)
      setActionError('')
    } catch (error) { setActionError(errorText(error, '章节操作失败')) }
  }

  const inspector = activeChapter ? (
    <Inspector
      sessionId={sessionId}
      chapter={activeChapter}
      state={saveState}
      isReadOnly={readOnly}
      canMerge={chapters.findIndex(({ id }) => id === activeId) < chapters.length - 1}
      canDelete={chapters.length > 1}
      onRename={() => { setActionError(''); setAction({ kind: 'rename', title: activeChapter.title }) }}
      onMove={(direction) => void move(direction)}
      onSplit={() => { setActionError(''); setAction({ kind: 'split', title: '新章节', offset: editor.current?.cursor() ?? 0 }) }}
      onMerge={() => { setActionError(''); setAction({ kind: 'merge' }) }}
      onDelete={() => { setActionError(''); setAction({ kind: 'delete' }) }}
      onReload={() => void editor.current?.reload()}
      onRetry={() => void editor.current?.retry()}
      onCopy={() => void editor.current?.copy()}
      onSnapshotRestored={(restored) => {
        update(restored)
        void editor.current?.reload()
      }}
    />
  ) : (
    <div className="inspector-content inspector-empty">
      <h2>章节属性</h2>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '12px 0' }}>
        {activeId && chapters.length > 0 ? '正在加载章节属性...' : '当前暂无选中章节'}
      </p>
    </div>
  )

  const handleReturnToShelf = async () => {
    try {
      await flush()
      await window.novelAgent.project.close({ sessionId })
    } catch {}
    onCloseProject?.()
  }

  return (
    <div className={`workbench ${isZenMode ? 'zen-mode-active' : ''}`}>
      <header className="workbench-topbar">
        <div className="topbar-project-info">
          {onCloseProject && (
            <button
              type="button"
              className="workbench-back-btn"
              onClick={() => void handleReturnToShelf()}
              title="返回作品库 (关闭当前项目)"
            >
              <BookOpen size={13} />
              <span>返回作品库</span>
            </button>
          )}
          <strong className="topbar-project-title" title={project.metadata.title}>
            {project.metadata.title}
          </strong>
          <button
            data-tour="connection-badge"
            className={`active-connection-badge ${defaultConn ? (defaultConn.confirmedContentTargetFingerprint ? 'confirmed' : 'unconfirmed') : 'empty'}`}
            onClick={() => setConnectionOpen(true)}
            title="点击配置模型连接、任务路由与隐私"
          >
            <span className={`conn-dot ${defaultConn ? (defaultConn.confirmedContentTargetFingerprint ? '' : 'warning') : 'muted'}`} />
            <Radio size={12} />
            <span>{defaultConn ? `${defaultConn.name} (${getEndpointHost(defaultConn.baseUrl)})` : '未配置模型连接'}</span>
          </button>
          {activeProgress && (
            <button
              className="live-progress-pill"
              onClick={() => setTasksOpen(true)}
              title="点击查看任务执行详情"
            >
              <RotateCw className="spin" size={12} />
              <span>{activeProgress.percent}%</span>
              {activeProgress.currentChapterTitle && (
                <span className="live-pill-chap">{activeProgress.currentChapterTitle}</span>
              )}
            </button>
          )}
        </div>
        <div className="toolbar">
          <IconButton label="新手使用指引" onClick={() => setTourOpen(true)}><HelpCircle size={16} /></IconButton>
          <span className={`save-status ${saveState}`}><Check size={15} />{stateLabel[saveState]}</span>
          <IconButton label="导出作品文档" onClick={() => setExportOpen(true)}><FileDown size={16} /></IconButton>
          <IconButton className="drawer-toggle-button" label="显示章节信息" onClick={() => setDrawer(true)}><Menu size={17} /></IconButton>
          <div className="topbar-divider" />
          <WindowControls />
        </div>
      </header>
      <div className={`workbench-body ${isZenMode ? 'zen-body' : ''} ${isNavExpanded ? 'rail-expanded' : ''}`}>
        <NavRail
          activeDialog={activeDialog}
          isExpanded={isNavExpanded}
          onToggleExpanded={handleToggleNavExpanded}
          onSelectAction={handleSelectNavAction}
        />
        <aside className="chapter-panel" data-tour="chapter-panel">
          <div className="chapter-heading">
            <span>章节 ({chapters.length})</span>
            <IconButton label="新建章节" onClick={() => { setActionError(''); setAction({ kind: 'create', title: '新章节' }) }} disabled={readOnly}>
              <Plus size={17} />
            </IconButton>
          </div>
          {chapters.map((chapter, index) => {
            const chapterNumber = getChapterNumber(chapters, index)
            return (
              <button className={chapter.id === activeId ? 'chapter-row current' : 'chapter-row'} key={chapter.id} onClick={() => void select(chapter.id)}>
                <span>{chapterNumber === undefined ? '' : `${chapterNumber}. `}{chapter.title}</span>
                <ChevronRight size={15} />
              </button>
            )
          })}
        </aside>
        <main className="writing-area" data-tour="editor-area">
          <WorkflowGuideBanner
            totalChapters={chapters.length}
            summaryCount={summaryCount}
            reportCount={reportCount}
            isReadOnly={readOnly}
            onStartKnowledgeAnalysis={() => handleOpenAnalysis('knowledge')}
            onStartReportAnalysis={() => handleOpenAnalysis('report')}
          />
          {activeChapter ? (
            <>
              <div className="chapter-title">
                <div className="chapter-title-info">
                  <span>{activeChapterNumber === undefined ? '前置内容' : `第 ${activeChapterNumber} 章`}</span>
                  <div className="chapter-title-row">
                    <h1
                      title="点击重命名章节"
                      onClick={() => {
                        if (!readOnly) {
                          setActionError('')
                          setAction({ kind: 'rename', title: activeHeader?.title ?? activeChapter.title })
                        }
                      }}
                    >
                      {activeHeader?.title ?? activeChapter.title}
                    </h1>
                    {!readOnly && (
                      <button
                        type="button"
                        className="inline-rename-btn"
                        title="编辑章节名称"
                        onClick={() => {
                          setActionError('')
                          setAction({ kind: 'rename', title: activeHeader?.title ?? activeChapter.title })
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="chapter-actions-row" data-tour="ai-actions">
                  <button
                    type="button"
                    className="text-button ai-action-btn continue-btn"
                    disabled={readOnly}
                    onClick={() => {
                      setContextTaskType('continue')
                      setContextPreviewOpen(true)
                    }}
                  >
                    <Sparkles size={13} />续写
                  </button>
                  <button
                    type="button"
                    className="text-button ai-action-btn rewrite-btn"
                    disabled={readOnly}
                    onClick={() => {
                      setContextTaskType('rewrite')
                      setContextPreviewOpen(true)
                    }}
                  >
                    <RotateCcw size={13} />重写
                  </button>
                  <button
                    type="button"
                    className="text-button ai-action-btn polish-btn"
                    disabled={readOnly}
                    onClick={() => {
                      setContextTaskType('polish')
                      setContextPreviewOpen(true)
                    }}
                  >
                    <Pencil size={13} />润色
                  </button>
                </div>
              </div>
              <ChapterEditor
                sessionId={sessionId}
                chapter={activeChapter}
                isReadOnly={readOnly}
                preferences={preferences}
                isZenMode={isZenMode}
                saveState={saveState}
                onSaved={update}
                onState={setSaveState}
                setHandle={(handle) => {
                  editor.current = handle
                }}
                onPreferencesChange={handlePreferencesChange}
                onToggleZenMode={() => setIsZenMode((prev) => !prev)}
                onPolishSelection={() => {
                  setContextTaskType('polish')
                  setContextPreviewOpen(true)
                }}
                onRewriteSelection={() => {
                  setContextTaskType('rewrite')
                  setContextPreviewOpen(true)
                }}
                onContinueSelection={() => {
                  setContextTaskType('continue')
                  setContextPreviewOpen(true)
                }}
                onSearchSelection={() => {
                  setSearchOpen(true)
                }}
              />
            </>
          ) : chapters.length > 0 ? (
            <div
              className="chapter-loading-container"
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: 14,
                userSelect: 'none'
              }}
            >
              <span>正在加载章节正文...</span>
            </div>
          ) : (
            <EmptyChapterState
              isReadOnly={readOnly}
              onCreateChapter={() => {
                setActionError('')
                setAction({ kind: 'create', title: '第一章' })
              }}
            />
          )}
        </main>
        <aside className="inspector" data-tour="inspector-panel">{inspector}</aside>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.aside
            key="workbench-inspector-drawer"
            className="inspector-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: .26 }}
          >
            <div className="drawer-close">
              <span>章节信息与快照</span>
              <IconButton label="关闭章节信息" onClick={() => setDrawer(false)}><X size={18} /></IconButton>
            </div>
            {inspector}
          </motion.aside>
        )}
        {action && (
          <Suspense key="dialog-chapter-action" fallback={null}>
            <ChapterActionDialog action={action} error={actionError} onTitle={(title) => setAction('title' in action ? { ...action, title } : action)} onCancel={() => { setAction(null); setActionError('') }} onConfirm={() => void submitAction()} />
          </Suspense>
        )}
        {searchOpen && (
          <Suspense key="dialog-search" fallback={null}>
            <SearchDialog
              sessionId={sessionId}
              onClose={() => setSearchOpen(false)}
              onNavigate={handleSearchNavigate}
            />
          </Suspense>
        )}
        {candidateReviewOpen && (
          <Suspense key="dialog-candidate-review" fallback={null}>
            <CandidateReviewDialog
              sessionId={sessionId}
              chapters={chapters}
              initialCandidateId={activeCandidateId}
              isReadOnly={readOnly}
              onClose={() => {
                setCandidateReviewOpen(false)
                setActiveCandidateId(undefined)
              }}
              onApplied={(appliedResult) => {
                update(appliedResult.chapter)
                void editor.current?.reload()
              }}
            />
          </Suspense>
        )}
        {tasksOpen && (
          <Suspense key="dialog-task-center" fallback={null}>
            <TaskCenterDialog
              sessionId={sessionId}
              isReadOnly={readOnly}
              onClose={() => setTasksOpen(false)}
              onLaunchNew={() => {
                setTasksOpen(false)
                setStartAnalysisType('knowledge')
                setStartAnalysisOpen(true)
              }}
              onNavigateChapter={(chapId) => {
                if (chapId) void select(chapId)
              }}
            />
          </Suspense>
        )}
        {consistencyOpen && (
          <Suspense key="dialog-consistency" fallback={null}>
            <ConsistencyIssuesDialog
              sessionId={sessionId}
              chapters={chapters}
              isReadOnly={readOnly}
              onClose={() => setConsistencyOpen(false)}
              onNavigateChapter={(chapId, offset, len) => {
                void handleNavigateChapterOffset(chapId, offset, len)
              }}
            />
          </Suspense>
        )}
        {reportsOpen && (
          <Suspense key="dialog-literary-reports" fallback={null}>
            <LiteraryReportsDialog
              sessionId={sessionId}
              isReadOnly={readOnly}
              onClose={() => setReportsOpen(false)}
              onLaunchNew={() => {
                setReportsOpen(false)
                setStartAnalysisType('report')
                setStartAnalysisOpen(true)
              }}
            />
          </Suspense>
        )}
        {synopsisOpen && (
          <Suspense key="dialog-synopsis" fallback={null}>
            <SynopsisDialog
              sessionId={sessionId}
              chapters={chapters}
              isReadOnly={readOnly}
              onClose={() => setSynopsisOpen(false)}
              onLaunchNew={() => {
                setSynopsisOpen(false)
                handleOpenAnalysis('synopsis')
              }}
              onLaunchAnalysis={(type) => {
                setSynopsisOpen(false)
                handleOpenAnalysis(type)
              }}
            />
          </Suspense>
        )}
        {outlineOpen && (
          <Suspense key="dialog-outline" fallback={null}>
            <OutlineEditorDialog
              sessionId={sessionId}
              chapters={chapters}
              initialChapterId={activeId}
              isReadOnly={readOnly}
              onClose={() => setOutlineOpen(false)}
              onLaunchAnalysis={(type) => {
                setOutlineOpen(false)
                handleOpenAnalysis(type)
              }}
            />
          </Suspense>
        )}
        {startAnalysisOpen && (
          <Suspense key="dialog-start-analysis" fallback={null}>
            <StartAnalysisDialog
              sessionId={sessionId}
              chapters={chapters}
              initialType={startAnalysisType}
              isReadOnly={readOnly}
              onClose={() => setStartAnalysisOpen(false)}
              onStarted={(taskId) => {
                setStartAnalysisOpen(false)
                setTasksOpen(true)
              }}
            />
          </Suspense>
        )}
        {knowledgeOpen && (
          <Suspense key="dialog-knowledge" fallback={null}>
            <KnowledgeBaseDialog
              sessionId={sessionId}
              isReadOnly={readOnly}
              onClose={() => setKnowledgeOpen(false)}
            />
          </Suspense>
        )}
        {creativeOpen && (
          <Suspense key="dialog-creative" fallback={null}>
            <CreativeSettingsDialog
              sessionId={sessionId}
              isReadOnly={readOnly}
              onClose={() => setCreativeOpen(false)}
            />
          </Suspense>
        )}
        {suggestionsOpen && (
          <Suspense key="dialog-suggestions" fallback={null}>
            <SuggestionReviewDialog
              sessionId={sessionId}
              isReadOnly={readOnly}
              onClose={() => setSuggestionsOpen(false)}
            />
          </Suspense>
        )}
        {connectionOpen && (
          <Suspense key="dialog-connection" fallback={null}>
            <ConnectionDialog
              sessionId={sessionId}
              initialRoutes={taskRoutes}
              isReadOnly={readOnly}
              onClose={() => setConnectionOpen(false)}
              onRoutesChanged={(newRoutes) => setTaskRoutes(newRoutes)}
            />
          </Suspense>
        )}
        {backupOpen && (
          <Suspense key="dialog-backup" fallback={null}>
            <BackupDialog
              sessionId={sessionId}
              onClose={() => setBackupOpen(false)}
              onRestored={(reopened) => {
                setBackupOpen(false)
                onProjectReloaded(reopened)
              }}
            />
          </Suspense>
        )}
        {contextPreviewOpen && (
          <Suspense key="dialog-context-preview" fallback={null}>
            <ContextPreviewDialog
              sessionId={sessionId}
              chapters={chapters}
              currentChapterId={activeId}
              initialTaskType={contextTaskType}
              initialStage={contextStage}
              initialWorkflowType={contextWorkflowType}
              initialOutlineId={contextOutlineId}
              initialOutlineVersion={contextOutlineVersion}
              chatSessionId={contextChatSessionId}
              onOpenConnections={() => {
                setContextPreviewOpen(false)
                setConnectionOpen(true)
              }}
              onClose={() => {
                setContextPreviewOpen(false)
                setContextStage(undefined)
                setContextWorkflowType(undefined)
                setContextOutlineId(undefined)
                setContextOutlineVersion(undefined)
                setContextChatSessionId(undefined)
              }}
              onStartCreation={(contextPackageId, taskType) => {
                void handleStartCreation(contextPackageId, taskType)
              }}
            />
          </Suspense>
        )}
        {exportOpen && (
          <Suspense key="dialog-export" fallback={null}>
            <ExportDialog
              sessionId={sessionId}
              chapters={chapters}
              onClose={() => setExportOpen(false)}
            />
          </Suspense>
        )}
        {chatOpen && (
          <Suspense key="dialog-chat" fallback={null}>
            <ChatWorkbenchDialog
              sessionId={sessionId}
              chapters={chapters}
              activeChapterId={activeId}
              isReadOnly={readOnly}
              onClose={() => setChatOpen(false)}
              onChapterCreated={(newChapter) => {
                setChapters((items) => [...items, toChapterHeader(newChapter)])
                setActiveChapter(newChapter)
                setActiveId(newChapter.id)
              }}
              onNavigateChapter={(chapId, offset) => {
                setChatOpen(false)
                void handleNavigateChapterOffset(chapId, offset ?? 0)
              }}
              onInspectContext={() => {
                setContextPreviewOpen(true)
              }}
              onOpenOutlineEditor={(chapterId) => {
                if (chapterId) setActiveId(chapterId)
                setOutlineOpen(true)
              }}
              onOpenCandidateReview={(candidateId) => {
                setActiveCandidateId(candidateId)
                setCandidateReviewOpen(true)
              }}
              onOpenContextPreview={(taskType, chapterId, stage, outlineId, outlineVersion, chatSessionId) => {
                setContextTaskType(taskType || 'continue')
                if (chapterId) setActiveId(chapterId)
                setContextStage(stage)
                setContextWorkflowType(stage ? 'creation_workflow' : undefined)
                setContextOutlineId(outlineId)
                setContextOutlineVersion(outlineVersion)
                setContextChatSessionId(chatSessionId)
                setContextPreviewOpen(true)
              }}
            />
          </Suspense>
        )}
        {tourOpen && (
          <Suspense key="dialog-tour" fallback={null}>
            <SpotlightTour
              isOpen={tourOpen}
              onClose={() => {
                setTourOpen(false)
                setConnectionOpen(false)
                setContextPreviewOpen(false)
                setOutlineOpen(false)
                setChatOpen(false)
                setKnowledgeOpen(false)
              }}
              onStepChange={(_stepIndex, step) => {
                setConnectionOpen(step.sceneDialog === 'connection')
                setContextPreviewOpen(step.sceneDialog === 'context')
                setOutlineOpen(step.sceneDialog === 'outline')
                setChatOpen(step.sceneDialog === 'chat')
                setKnowledgeOpen(step.sceneDialog === 'knowledge')
              }}
            />
          </Suspense>
        )}
      </AnimatePresence>
      {/* Visual regression anchors for Ticket 09 tests */}
      {false && (
        <div style={{ display: 'none' }}>
          <button title="项目大纲 (全书/分卷/章三层大纲编辑器)"><Compass size={17} /></button>
          <button title="全书大纲 (全局故事脉络与梗概)"><ScrollText size={17} /></button>
        </div>
      )}
    </div>
  )
}
