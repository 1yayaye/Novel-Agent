import { useEffect, useRef, useState } from 'react'
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
import type {
  Chapter,
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
import { IconButton } from '../common/IconButton'
import { WindowControls } from '../common/WindowControls'
import { useToast } from '../common/Toast'
import { ChapterEditor } from '../editor/ChapterEditor'
import { Inspector } from '../editor/Inspector'
import { EmptyChapterState } from '../editor/EmptyChapterState'
import { ChapterActionDialog } from '../dialogs/ChapterActionDialog'
import { SearchDialog } from '../dialogs/SearchDialog'
import { CandidateReviewDialog } from '../dialogs/CandidateReviewDialog'
import { TaskCenterDialog } from '../dialogs/TaskCenterDialog'
import { ConsistencyIssuesDialog } from '../dialogs/ConsistencyIssuesDialog'
import { LiteraryReportsDialog } from '../dialogs/LiteraryReportsDialog'
import { SynopsisDialog } from '../dialogs/SynopsisDialog'
import { StartAnalysisDialog } from '../dialogs/StartAnalysisDialog'
import { KnowledgeBaseDialog } from '../dialogs/KnowledgeBaseDialog'
import { CreativeSettingsDialog } from '../dialogs/CreativeSettingsDialog'
import { SuggestionReviewDialog } from '../dialogs/SuggestionReviewDialog'
import { ConnectionDialog } from '../dialogs/ConnectionDialog'
import { BackupDialog } from '../dialogs/BackupDialog'
import { ContextPreviewDialog } from '../dialogs/ContextPreviewDialog'
import { ExportDialog } from '../dialogs/ExportDialog'
import { ChatWorkbenchDialog } from '../dialogs/ChatWorkbenchDialog'
import { OutlineEditorDialog } from '../dialogs/OutlineEditorDialog'
import { SpotlightTour } from '../dialogs/SpotlightTour'

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
  initialChapters: Chapter[]
  onProjectReloaded: (opened: OpenProjectResult) => void
  onCloseProject?: () => void
}) {
  const { sessionId } = project
  const readOnly = project.mode === 'read_only'
  const [chapters, setChapters] = useState(initialChapters)
  const [activeId, setActiveId] = useState(initialChapters[0]?.id)
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
  const active = chapters.find(({ id }) => id === activeId)
  const activeIndex = active ? chapters.indexOf(active) : -1
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
        window.setTimeout(() => {
          setActiveProgress((prev) => prev?.taskId === event.taskId ? null : prev)
        }, 4000)
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

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

  const update = (chapter: Chapter) => setChapters((items) => items.map((item) => item.id === chapter.id ? chapter : item))
  const flush = () => editor.current?.flush() ?? Promise.resolve(true)
  const runStructure = async (action: (latest: Chapter[]) => Promise<Chapter[]>) => {
    if (!await flush()) return
    const result = await action(await window.novelAgent.chapter.list({ sessionId }))
    setChapters(result)
    if (!result.some(({ id }) => id === activeId)) setActiveId(result[0]?.id)
  }
  const select = async (id: string) => { if (id === activeId || await flush()) setActiveId(id) }

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
        setChapters((items) => [...items, added])
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

  const inspector = active ? (
    <Inspector
      sessionId={sessionId}
      chapter={active}
      state={saveState}
      isReadOnly={readOnly}
      canMerge={chapters.findIndex(({ id }) => id === activeId) < chapters.length - 1}
      canDelete={chapters.length > 1}
      onRename={() => { setActionError(''); setAction({ kind: 'rename', title: active.title }) }}
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
      <p style={{ color: '#6b7280', fontSize: 13, margin: '12px 0' }}>当前暂无选中章节</p>
    </div>
  )

  const handleReturnToShelf = async () => {
    try {
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
      <div className={`workbench-body ${isZenMode ? 'zen-body' : ''}`}>
        <aside className="left-rail" data-tour="left-rail">
          <div className="app-mark" title="Novel Agent">NA</div>
          
          {/* Group 1: 核心创作 */}
          <div className="rail-group">
            <button
              className={!searchOpen && !knowledgeOpen && !creativeOpen && !suggestionsOpen && !connectionOpen && !tasksOpen && !consistencyOpen && !reportsOpen && !synopsisOpen && !outlineOpen && !contextPreviewOpen && !candidateReviewOpen && !chatOpen && !backupOpen && !exportOpen ? 'rail-active' : ''}
              title="写作模式 (回到当前章节编辑器)"
              aria-label="写作"
              onClick={() => {
                setSearchOpen(false)
                setKnowledgeOpen(false)
                setCreativeOpen(false)
                setSuggestionsOpen(false)
                setConnectionOpen(false)
                setTasksOpen(false)
                setConsistencyOpen(false)
                setReportsOpen(false)
                setSynopsisOpen(false)
                setOutlineOpen(false)
                setContextPreviewOpen(false)
                setCandidateReviewOpen(false)
                setChatOpen(false)
                setBackupOpen(false)
                setExportOpen(false)
              }}
            >
              <Pencil size={17} />
            </button>
            <button
              className={outlineOpen ? 'rail-active' : ''}
              title="项目大纲 (全书/分卷/章三层大纲编辑器)"
              aria-label="项目大纲"
              onClick={() => setOutlineOpen(true)}
            >
              <Compass size={17} />
            </button>
            <button
              className={chatOpen ? 'rail-active' : ''}
              title="项目问答 (小说多轮对话与设定研讨)"
              aria-label="项目问答"
              onClick={() => setChatOpen(true)}
            >
              <MessageSquare size={17} />
            </button>
            <button
              className={candidateReviewOpen ? 'rail-active' : ''}
              title="差异审阅 (AI创作候选比对与写回)"
              aria-label="差异审阅"
              onClick={() => setCandidateReviewOpen(true)}
            >
              <GitCompare size={17} />
            </button>
            <button
              className={searchOpen ? 'rail-active' : ''}
              title="全文搜索 (Ctrl+Shift+F)"
              aria-label="全文搜索"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
            </button>
          </div>

          <div className="rail-divider" />

          {/* Group 2: AI分析与故事辅助 */}
          <div className="rail-group">
            <button
              className={contextPreviewOpen ? 'rail-active' : ''}
              title="上下文装配预览 (Token预算与Prompt)"
              aria-label="上下文装配预览"
              onClick={() => setContextPreviewOpen(true)}
            >
              <Layers size={17} />
            </button>
            <button
              className={tasksOpen ? 'rail-active' : ''}
              title="任务中心 (后台队列与批处理)"
              aria-label="任务中心"
              onClick={() => setTasksOpen(true)}
            >
              <ListOrdered size={17} />
            </button>
            <button
              className={consistencyOpen ? 'rail-active' : ''}
              title="故事一致性 (矛盾与逻辑检测)"
              aria-label="一致性检测"
              onClick={() => setConsistencyOpen(true)}
            >
              <AlertTriangle size={17} />
            </button>
            <button
              className={reportsOpen ? 'rail-active' : ''}
              title="文学分析报告 (六维度文学评估)"
              aria-label="文学分析报告"
              onClick={() => setReportsOpen(true)}
            >
              <FileBarChart size={17} />
            </button>
            <button
              className={synopsisOpen ? 'rail-active' : ''}
              title="全书大纲 (全局故事脉络与梗概)"
              aria-label="全书大纲"
              onClick={() => setSynopsisOpen(true)}
            >
              <ScrollText size={17} />
            </button>
            <button
              className={suggestionsOpen ? 'rail-active' : ''}
              title="AI建议审阅 (事实设定与实体建议)"
              aria-label="AI建议审阅"
              onClick={() => setSuggestionsOpen(true)}
            >
              <Sparkles size={17} />
            </button>
          </div>

          <div className="rail-divider" />

          {/* Group 3: 系统与配置管理 */}
          <div className="rail-group">
            <button
              className={knowledgeOpen ? 'rail-active' : ''}
              title="知识库管理 (人物、实体与设定)"
              aria-label="知识库"
              onClick={() => setKnowledgeOpen(true)}
            >
              <BookOpen size={17} />
            </button>
            <button
              className={creativeOpen ? 'rail-active' : ''}
              title="创作配置 (规则、样本、预设)"
              aria-label="创作配置"
              onClick={() => setCreativeOpen(true)}
            >
              <Sliders size={17} />
            </button>
            <button
              className={connectionOpen ? 'rail-active' : ''}
              title="模型连接与任务路由"
              aria-label="模型连接"
              onClick={() => setConnectionOpen(true)}
            >
              <Radio size={17} />
            </button>
            <button
              className={backupOpen ? 'rail-active' : ''}
              title="项目备份管理 (快照与恢复)"
              aria-label="项目备份"
              onClick={() => setBackupOpen(true)}
            >
              <Archive size={17} />
            </button>
            <button
              className={exportOpen ? 'rail-active' : ''}
              title="导出作品文档 (TXT / Markdown / EPUB)"
              aria-label="导出作品"
              onClick={() => setExportOpen(true)}
            >
              <FileDown size={17} />
            </button>
            <button
              className={tourOpen ? 'rail-active' : ''}
              title="新手使用指引 (分步功能演示)"
              aria-label="新手使用指引"
              onClick={() => setTourOpen(true)}
            >
              <HelpCircle size={17} />
            </button>
          </div>

          <span className="rail-footer-text">本机</span>
        </aside>
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
          {active ? (
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
                          setAction({ kind: 'rename', title: active.title })
                        }
                      }}
                    >
                      {active.title}
                    </h1>
                    {!readOnly && (
                      <button
                        type="button"
                        className="inline-rename-btn"
                        title="编辑章节名称"
                        onClick={() => {
                          setActionError('')
                          setAction({ kind: 'rename', title: active.title })
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
                chapter={active}
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
          <motion.aside className="inspector-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: .26 }}>
            <div className="drawer-close">
              <span>章节信息与快照</span>
              <IconButton label="关闭章节信息" onClick={() => setDrawer(false)}><X size={18} /></IconButton>
            </div>
            {inspector}
          </motion.aside>
        )}
        {action && (
          <ChapterActionDialog action={action} error={actionError} onTitle={(title) => setAction('title' in action ? { ...action, title } : action)} onCancel={() => { setAction(null); setActionError('') }} onConfirm={() => void submitAction()} />
        )}
        {searchOpen && (
          <SearchDialog
            sessionId={sessionId}
            onClose={() => setSearchOpen(false)}
            onNavigate={handleSearchNavigate}
          />
        )}
        {candidateReviewOpen && (
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
        )}
        {tasksOpen && (
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
        )}
        {consistencyOpen && (
          <ConsistencyIssuesDialog
            sessionId={sessionId}
            chapters={chapters}
            isReadOnly={readOnly}
            onClose={() => setConsistencyOpen(false)}
            onNavigateChapter={(chapId, offset, len) => {
              void handleNavigateChapterOffset(chapId, offset, len)
            }}
          />
        )}
        {reportsOpen && (
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
        )}
        {synopsisOpen && (
          <SynopsisDialog
            sessionId={sessionId}
            chapters={chapters}
            isReadOnly={readOnly}
            onClose={() => setSynopsisOpen(false)}
            onLaunchNew={() => {
              setSynopsisOpen(false)
              setStartAnalysisType('synopsis')
              setStartAnalysisOpen(true)
            }}
          />
        )}
        {outlineOpen && (
          <OutlineEditorDialog
            sessionId={sessionId}
            chapters={chapters}
            initialChapterId={activeId}
            isReadOnly={readOnly}
            onClose={() => setOutlineOpen(false)}
          />
        )}
        {startAnalysisOpen && (
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
        )}
        {knowledgeOpen && (
          <KnowledgeBaseDialog
            sessionId={sessionId}
            isReadOnly={readOnly}
            onClose={() => setKnowledgeOpen(false)}
          />
        )}
        {creativeOpen && (
          <CreativeSettingsDialog
            sessionId={sessionId}
            isReadOnly={readOnly}
            onClose={() => setCreativeOpen(false)}
          />
        )}
        {suggestionsOpen && (
          <SuggestionReviewDialog
            sessionId={sessionId}
            isReadOnly={readOnly}
            onClose={() => setSuggestionsOpen(false)}
          />
        )}
        {connectionOpen && (
          <ConnectionDialog
            sessionId={sessionId}
            initialRoutes={taskRoutes}
            isReadOnly={readOnly}
            onClose={() => setConnectionOpen(false)}
            onRoutesChanged={(newRoutes) => setTaskRoutes(newRoutes)}
          />
        )}
        {backupOpen && (
          <BackupDialog
            sessionId={sessionId}
            onClose={() => setBackupOpen(false)}
            onRestored={(reopened) => {
              setBackupOpen(false)
              onProjectReloaded(reopened)
            }}
          />
        )}
        {contextPreviewOpen && (
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
        )}
        {exportOpen && (
          <ExportDialog
            sessionId={sessionId}
            chapters={chapters}
            onClose={() => setExportOpen(false)}
          />
        )}
        {chatOpen && (
          <ChatWorkbenchDialog
            sessionId={sessionId}
            chapters={chapters}
            activeChapterId={activeId}
            isReadOnly={readOnly}
            onClose={() => setChatOpen(false)}
            onChapterCreated={(newChapter) => {
              setChapters((items) => [...items, newChapter])
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
        )}
      </AnimatePresence>
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
    </div>
  )
}
