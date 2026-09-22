import React from 'react'
import { useWorkbenchStore } from '../../stores/useWorkbenchStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useEditorStore } from '../../stores/useEditorStore'
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
  const { isReadOnly } = useEditorStore()

  if (!project) return null

  const sessionId = project.sessionId

  return (
    <>
      {activeDialog === 'connection' && (
        <ConnectionDialog
          sessionId={sessionId}
          initialRoutes={project.taskRoutes || []}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onRoutesChanged={() => {}}
        />
      )}

      {activeDialog === 'creative' && (
        <CreativeSettingsDialog
          sessionId={sessionId}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
        />
      )}

      {activeDialog === 'backup' && (
        <BackupDialog
          sessionId={sessionId}
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

      {activeDialog === 'candidate' && (
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
            closeDialog()
            onCandidateApplied?.(res)
          }}
        />
      )}

      {activeDialog === 'chat' && (
        <ChatWorkbenchDialog
          sessionId={sessionId}
          chapters={chapters}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onChapterCreated={(chap) => {
            onChapterCreated?.(chap)
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
          initialChapterId={selectedChapterId || undefined}
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

      {activeDialog === 'issues' && (
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

      {activeDialog === 'suggestion' && (
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
          currentChapterId={selectedChapterId || undefined}
          onClose={closeDialog}
          onStartCreation={() => {}}
          onOpenConnections={() => openDialog('connection')}
        />
      )}

      {activeDialog === 'analysis' && (
        <StartAnalysisDialog
          sessionId={sessionId}
          chapters={chapters}
          isReadOnly={isReadOnly}
          onClose={closeDialog}
          onStarted={() => closeDialog()}
        />
      )}
    </>
  )
}
