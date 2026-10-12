import React from 'react'
import { useWorkbenchStore } from '../../stores/useWorkbenchStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTaskStore } from '../../stores/useTaskStore'
import { useEditorStore } from '../../stores/useEditorStore'
import { useToast } from '../../components/common/Toast'
import { errorText } from '../../utils/formatters'
import { taskTypeLabel } from '../../utils/constants'
import { ConnectionDialog } from '../../components/dialogs/ConnectionDialog'
import { CreativeSettingsDialog } from '../../components/dialogs/CreativeSettingsDialog'
import { BackupDialog } from '../../components/dialogs/BackupDialog'
import { ExportDialog } from '../../components/dialogs/ExportDialog'
import { CandidateReviewDialog } from '../../components/dialogs/CandidateReviewDialog'
import { SearchDialog } from '../../components/dialogs/SearchDialog'
import { ChatWorkbenchDialog } from '../../components/dialogs/ChatWorkbenchDialog'
import { SpotlightTour, DEFAULT_TOUR_STEPS } from '../../components/dialogs/SpotlightTour'
import { OutlineEditorDialog } from '../../components/dialogs/OutlineEditorDialog'
import { SynopsisDialog } from '../../components/dialogs/SynopsisDialog'
import { KnowledgeBaseDialog } from '../../components/dialogs/KnowledgeBaseDialog'
import { LiteraryReportsDialog } from '../../components/dialogs/LiteraryReportsDialog'
import { ConsistencyIssuesDialog } from '../../components/dialogs/ConsistencyIssuesDialog'
import { SuggestionReviewDialog } from '../../components/dialogs/SuggestionReviewDialog'
import { ContextPreviewDialog } from '../../components/dialogs/ContextPreviewDialog'
import { StartAnalysisDialog } from '../../components/dialogs/StartAnalysisDialog'
import { ConfirmActionDialog } from '../../components/dialogs/ConfirmActionDialog'
import type { TaskType, ContextPreviewInput } from '../../../shared/project'

type CreationDialogPayload = Partial<Pick<ContextPreviewInput, 'taskType' | 'stage' | 'workflowType' | 'outlineId' | 'outlineVersion' | 'chatSessionId' | 'target' | 'instruction' | 'connectionId'>> & {
  chapterId?: string
  contextPackageId?: string
}

export interface DialogHostProps {
  onChapterCreated?: (chapter: any) => void
  onNavigateSearch?: (chapterId?: string, offset?: number, length?: number) => void
  onCandidateApplied?: (result: any) => void
}

export function DialogHost({
  onChapterCreated,
  onNavigateSearch,
  onCandidateApplied
}: DialogHostProps) {
  const { activeDialog, closeDialog, dialogPayload, openDialog } = useWorkbenchStore()
  const { project, chapters, selectedChapterId, loadProject } = useProjectStore()
  const { showToast } = useToast()

  if (!project) return null

  const sessionId = project.sessionId
  const isReadOnly = project.mode === 'read_only'
  const creationPayload: CreationDialogPayload = typeof dialogPayload === 'object' && dialogPayload !== null ? dialogPayload as CreationDialogPayload : {}
  const refreshChapters = async () => {
    const list = await window.novelAgent.chapter.list({ sessionId })
    if (useProjectStore.getState().project?.sessionId === sessionId) useProjectStore.getState().setChapters(list)
  }
  const refreshTasks = async () => {
    const list = await window.novelAgent.task.list({ sessionId })
    if (useProjectStore.getState().project?.sessionId !== sessionId) return
    for (const task of list) {
      const existing = useTaskStore.getState().tasks.find((item) => item.id === task.id)
      useTaskStore.getState().updateOrAddTask({ id: task.id, type: task.type, title: existing?.title || taskTypeLabel[task.type] || task.type, status: task.state, progress: task.state === 'completed' ? 100 : existing?.progress ?? 0, message: task.errorMessage || undefined, createdAt: task.createdAt })
    }
  }
  const analysisInitialType =
    typeof dialogPayload === 'object' && dialogPayload !== null && 'initialType' in dialogPayload
      ? (dialogPayload as { initialType?: Extract<TaskType, 'knowledge' | 'report' | 'synopsis' | 'style_distill' | 'book_summary'> }).initialType
      : undefined

  return (
    <>
      {activeDialog === 'connection' && (
        <ConnectionDialog
          sessionId={sessionId}
          initialRoutes={project.taskRoutes || []}
          isReadOnly={isReadOnly}
           canUsePipelines={Boolean(project.capabilities?.analysisPipelines)}
          onClose={closeDialog}
          onRoutesChanged={() => {}}
        />
      )}

      {activeDialog === 'creative' && (
        <CreativeSettingsDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onPreview={() => openDialog('context')}
        />
      )}

      {activeDialog === 'backup' && (
        <BackupDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onRestored={(opened) => {
            closeDialog()
            void loadProject(opened)
          }}
        />
      )}

      {activeDialog === 'export' && (
        <ExportDialog
          sessionId={sessionId}
          chapters={chapters}
          canExportAnalysis={Boolean(project.capabilities?.analysisExport)}
          onClose={closeDialog}
        />
      )}

      {activeDialog === 'search' && (
        <SearchDialog
          sessionId={sessionId}
          onClose={closeDialog}
          onNavigate={(chapId, offset, length) => {
            closeDialog()
            onNavigateSearch?.(chapId, offset, length)
          }}
        />
      )}

      {(activeDialog === 'candidate' || (activeDialog as any) === 'candidateReview') && (
        <CandidateReviewDialog
          sessionId={sessionId}
          chapters={chapters}
          isReadOnly={isReadOnly}
          initialCandidateId={
            typeof dialogPayload === 'string'
              ? dialogPayload
              : (dialogPayload as any)?.candidateId
          }
          onClose={closeDialog}
          onApplied={(res) => {
            const editor = useEditorStore.getState()
            if (editor.activeChapter?.id === res.chapter.id && editor.saveState === 'saved') editor.loadChapter(res.chapter, isReadOnly)
            closeDialog()
            onCandidateApplied?.(res)
            void refreshChapters().catch((err) => showToast(errorText(err, '正文已写回，刷新章节列表失败'), 'warning'))
            void refreshTasks().catch((err) => showToast(errorText(err, '刷新任务列表失败'), 'warning'))
          }}
        />
      )}

      {activeDialog === 'chat' && (
        <ChatWorkbenchDialog
          sessionId={sessionId}
          chapters={chapters}
          activeChapterId={selectedChapterId || undefined}
          isReadOnly={isReadOnly}
          initialPrompt={
            typeof dialogPayload === 'object' && dialogPayload && 'initialPrompt' in dialogPayload
              ? (dialogPayload as any).initialPrompt
              : undefined
          }
          onClose={closeDialog}
          onNavigateChapter={(chapterId, offset, length) => { closeDialog(); onNavigateSearch?.(chapterId, offset, length) }}
          onInspectContext={(contextPackageId) => openDialog('context', { contextPackageId })}
          onOpenOutlineEditor={(chapterId) => openDialog('outline', { chapterId })}
          onOpenCandidateReview={(candidateId) => openDialog('candidate', { candidateId })}
          onOpenContextPreview={(taskType, chapterId, stage, outlineId, outlineVersion, chatSessionId) => openDialog('context', { taskType, target: { chapterId, chatId: chatSessionId }, stage, workflowType: 'creation_workflow', outlineId, outlineVersion, chatSessionId })}
          onChapterCreated={(chap) => {
            onChapterCreated?.(chap)
            void refreshChapters().catch((err) => showToast(errorText(err, '新章节已创建，刷新章节列表失败'), 'warning'))
          }}
        />
      )}

      {activeDialog === 'tour' && (
        <SpotlightTour
          isOpen={true}
          steps={DEFAULT_TOUR_STEPS}
          onClose={closeDialog}
        />
      )}

      {activeDialog === 'outline' && (
        <OutlineEditorDialog
          sessionId={sessionId}
          chapters={chapters}
          initialChapterId={creationPayload.chapterId || creationPayload.target?.chapterId || selectedChapterId || undefined}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onLaunchAnalysis={() => openDialog('analysis')}
        />
      )}

      {activeDialog === 'synopsis' && (
        <SynopsisDialog
          sessionId={sessionId}
          chapters={chapters}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onLaunchNew={() => {}}
          onLaunchAnalysis={() => openDialog('analysis')}
        />
      )}

      {activeDialog === 'knowledge' && (
        <KnowledgeBaseDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
        />
      )}

      {activeDialog === 'reports' && (
        <LiteraryReportsDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onLaunchNew={() => openDialog('analysis')}
        />
      )}

      {(activeDialog === 'issues' || (activeDialog as any) === 'consistency') && (
        <ConsistencyIssuesDialog
          sessionId={sessionId}
          chapters={chapters}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onNavigateChapter={(chapterId, startOffset, length) => {
            closeDialog()
            onNavigateSearch?.(chapterId, startOffset, length)
          }}
        />
      )}

      {(activeDialog === 'suggestion' || (activeDialog as any) === 'suggestions') && (
        <SuggestionReviewDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
        />
      )}

      {activeDialog === 'context' && (
        <ContextPreviewDialog
          sessionId={sessionId}
          chapters={chapters}
          currentChapterId={creationPayload.target?.chapterId || creationPayload.chapterId || selectedChapterId || undefined}
          initialTaskType={creationPayload.taskType}
          initialStage={creationPayload.stage}
          initialWorkflowType={creationPayload.workflowType}
          initialOutlineId={creationPayload.outlineId}
          initialOutlineVersion={creationPayload.outlineVersion}
          initialTarget={creationPayload.target}
          initialInstruction={creationPayload.instruction}
          initialConnectionId={creationPayload.connectionId}
          chatSessionId={creationPayload.chatSessionId || creationPayload.target?.chatId}
          contextPackageId={creationPayload.contextPackageId}
          onClose={closeDialog}
          onStartCreation={isReadOnly ? undefined : async (contextPackageId, taskType) => {
            const started = await window.novelAgent.creation.start({ sessionId, contextPackageId })
            useTaskStore.getState().addTask({ id: started.taskId, type: taskType, title: taskTypeLabel[taskType] || taskType, progress: 0, status: 'running' })
            openDialog('candidate', { candidateId: started.candidateId })
            void refreshTasks().catch((err) => showToast(errorText(err, '候选生成已启动，刷新任务列表失败'), 'warning'))
          }}
          onOpenConnections={() => openDialog('connection')}
          onOpenCreativeSettings={() => openDialog('creative')}
        />
      )}

      {activeDialog === 'analysis' && (
        <StartAnalysisDialog
          sessionId={sessionId}
          chapters={chapters}
          canUsePipelines={Boolean(project.capabilities?.analysisPipelines)}
          initialType={analysisInitialType ?? 'knowledge'}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onStarted={() => closeDialog()}
        />
      )}

      {activeDialog === 'confirm' && Boolean(dialogPayload) && (
        <ConfirmActionDialog
          {...(dialogPayload as any)}
          onCancel={() => {
            ;(dialogPayload as any)?.onCancel?.()
            closeDialog()
          }}
          onConfirm={async () => {
            await (dialogPayload as any)?.onConfirm?.()
            closeDialog()
          }}
        />
      )}
    </>
  )
}
