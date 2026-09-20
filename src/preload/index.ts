import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import {
  AcceptSuggestionInputSchema,
  AddReportAnnotationInputSchema,
  ArchiveKnowledgeEntryInputSchema,
  BackupInfoSchema,
  BookOutlineSchema,
  BookSynopsisSchema,
  CancelTaskInputSchema,
  ChapterOutlineSchema,
  ChapterSchema,
  ChapterSnapshotDetailSchema,
  ChapterSnapshotSchema,
  ChapterSummarySchema,
  CharacterRelationshipSchema,
  CloseProjectInputSchema,
  ConfirmBookOutlineInputSchema,
  ConfirmChapterOutlineInputSchema,
  ConsistencyIssueSchema,
  CreateBackupInputSchema,
  CreateChapterInputSchema,
  CreateCharacterRelationshipInputSchema,
  CreateInstructionPresetInputSchema,
  CreateKnowledgeEntryInputSchema,
  CreateOrdinarySnapshotInputSchema,
  CreateProjectInputSchema,
  CreateReportInputSchema,
  CreateSnapshotInputSchema,
  CreateStyleSampleInputSchema,
  CreateVolumeOutlineInputSchema,
  CreativeRuleSchema,
  DeleteChapterInputSchema,
  DeleteChapterOutlineInputSchema,
  DeleteCharacterRelationshipInputSchema,
  DeleteInstructionPresetInputSchema,
  DeleteKnowledgeEntryInputSchema,
  DeleteReportAnnotationInputSchema,
  DeleteStyleSampleInputSchema,
  DeleteVolumeOutlineInputSchema,
  ExportProjectInputSchema,
  ExportProjectResultSchema,
  GenerateBookOutlineDraftInputSchema,
  GetBookOutlineInputSchema,
  GetChapterInputSchema,
  GetChapterOutlineInputSchema,
  GetChapterSummaryInputSchema,
  GetCharacterRelationshipInputSchema,
  GetCreativeRuleInputSchema,
  GetIndexStatusInputSchema,
  GetInstructionPresetInputSchema,
  GetKnowledgeEntryInputSchema,
  GetLatestChapterOutlineInputSchema,
  GetReportInputSchema,
  GetSnapshotInputSchema,
  GetStyleSampleInputSchema,
  GetSuggestionInputSchema,
  GetSynopsisInputSchema,
  GetTaskInputSchema,
  GetTaskProgressInputSchema,
  GetVolumeOutlineInputSchema,
  ImportPreviewInputSchema,
  ImportPreviewResultSchema,
  ImportProjectInputSchema,
  ImportProjectResultSchema,
  IndexStatusResultSchema,
  InstructionPresetSchema,
  ipcResultSchema,
  KeywordSearchInputSchema,
  KeywordSearchResultSchema,
  KnowledgeEntrySchema,
  ListBackupsInputSchema,
  ListChapterOutlinesInputSchema,
  ListChapterSummariesInputSchema,
  ListChaptersInputSchema,
  ListCharacterRelationshipsInputSchema,
  ListConsistencyIssuesInputSchema,
  ListInstructionPresetsInputSchema,
  ListKnowledgeEntriesInputSchema,
  ListRecentProjectsResultSchema,
  ListReportsInputSchema,
  ListSnapshotsInputSchema,
  ListStyleSamplesInputSchema,
  ListSuggestionsInputSchema,
  ListTasksInputSchema,
  ListVolumeOutlinesInputSchema,
  LiteraryReportDetailSchema,
  LiteraryReportSummarySchema,
  MergeChapterInputSchema,
  OpenBackupLocationInputSchema,
  OpenProjectInputSchema,
  OpenProjectResultSchema,
  PreviewSuggestionAcceptanceInputSchema,
  ProjectSummarySchema,
  RebuildIndexInputSchema,
  RebuildIndexResultSchema,
  RenameChapterInputSchema,
  ReorderChaptersInputSchema,
  ReorderVolumeOutlinesInputSchema,
  ReportAnnotationSchema,
  RestoreBackupInputSchema,
  RestoreKnowledgeEntryInputSchema,
  RestoreSnapshotInputSchema,
  ResumeTaskInputSchema,
  RetryStepInputSchema,
  ReviewConsistencyIssueInputSchema,
  ReviewSuggestionInputSchema,
  SaveBookOutlineInputSchema,
  SaveChapterOutlineInputSchema,
  SaveCopyInputSchema,
  SaveCopyResultSchema,
  SkipStepInputSchema,
  SplitChapterInputSchema,
  StartAnalysisInputSchema,
  StartAnalysisResultSchema,
  StyleSampleSchema,
  SuccessResultSchema,
  SuggestionAcceptancePreviewSchema,
  UpdateVolumeOutlineInputSchema,
  VolumeOutlineSchema,
  AiFactSuggestionSchema,
  ConfirmContentTargetInputSchema,
  ConfirmContentTargetResultSchema,
  ConnectionTestResultSchema,
  CreateModelConnectionInputSchema,
  DeleteModelConnectionInputSchema,
  GetModelConnectionInputSchema,
  ListModelConnectionsInputSchema,
  ListRemoteModelsInputSchema,
  ListRemoteModelsResultSchema,
  LogStateResultSchema,
  ModelConnectionSummarySchema,
  SetDetailedLoggingInputSchema,
  SetTaskRouteInputSchema,
  TaskDetailSchema,
  TaskProgressEventSchema,
  TaskRouteSummarySchema,
  TaskSummarySchema,
  TestModelConnectionInputSchema,
  UpdateChapterInputSchema,
  UpdateCharacterRelationshipInputSchema,
  UpdateCreativeRuleInputSchema,
  UpdateInstructionPresetInputSchema,
  UpdateKnowledgeEntryInputSchema,
  UpdateModelConnectionInputSchema,
  UpdateReportAnnotationInputSchema,
  UpdateStyleSampleInputSchema,
  ContextPackageSchema,
  ContextPreviewInputSchema,
  GetContextPackageInputSchema,
  HybridSearchInputSchema,
  CandidateApplyResultSchema,
  CandidateDetailSchema,
  CandidateSummarySchema,
  CandidateDeltaEventSchema,
  CandidateDoneEventSchema,
  StartCreationInputSchema,
  StartCreationResultSchema,
  RegenerateCreationInputSchema,
  CancelCreationInputSchema,
  ListCandidatesInputSchema,
  GetCandidateInputSchema,
  UpdateCandidateTextInputSchema,
  StageCandidateHunkInputSchema,
  RetainCandidateInputSchema,
  ApplyCandidateInputSchema,
  RejectCandidateInputSchema,
  ChatSessionSchema,
  ChatMessageSchema,
  ChatSummarySchema,
  CreateChatSessionInputSchema,
  GetChatSessionInputSchema,
  UpdateChatWorkflowStageInputSchema,
  ListChatSessionsInputSchema,
  DeleteChatSessionInputSchema,
  SendChatMessageInputSchema,
  CancelChatInputSchema,
  CompactChatSessionInputSchema,
  ListChatMessagesInputSchema,
  GetChatSummaryInputSchema,
  UpdateChatSummaryInputSchema,
  ChatDeltaEventSchema,
  ChatDoneEventSchema,
  type NovelAgentApi,
  type TaskProgressEvent,
  type CandidateDeltaEvent,
  type CandidateDoneEvent,
  type ChatDeltaEvent,
  type ChatDoneEvent
} from '../shared/project'

const invoke = async <I, O>(channel: string, input: I, inputSchema: z.ZodType<I>, outputSchema: z.ZodType<O>): Promise<O> => {
  const result = ipcResultSchema(outputSchema).parse(await ipcRenderer.invoke(channel, inputSchema.parse(input)))
  if (!result.ok) throw { name: 'NovelAgentError', ...result.error }
  return result.value
}

const api: NovelAgentApi = {
  project: {
    create: (input) => invoke('project.create', input, CreateProjectInputSchema, ProjectSummarySchema),
    open: (input) => invoke('project.open', input, OpenProjectInputSchema, OpenProjectResultSchema),
    close: (input) => invoke('project.close', input, CloseProjectInputSchema, SuccessResultSchema),
    saveCopy: (input) => invoke('project.saveCopy', input, SaveCopyInputSchema, SaveCopyResultSchema),
    listRecent: () => invoke('project.listRecent', undefined, z.undefined(), ListRecentProjectsResultSchema),
    chooseAndOpen: () => invoke('project.chooseAndOpen', undefined, z.undefined(), OpenProjectResultSchema.nullable()),
    previewImport: (input = {}) => invoke('project.previewImport', input, ImportPreviewInputSchema, ImportPreviewResultSchema),
    import: (input) => invoke('project.import', input, ImportProjectInputSchema, ImportProjectResultSchema),
    export: (input) => invoke('project.export', input, ExportProjectInputSchema, ExportProjectResultSchema.nullable())
  },
  chapter: {
    list: (input) => invoke('chapter.list', input, ListChaptersInputSchema, z.array(ChapterSchema)),
    get: (input) => invoke('chapter.get', input, GetChapterInputSchema, ChapterSchema),
    update: (input) => invoke('chapter.update', input, UpdateChapterInputSchema, ChapterSchema),
    create: (input) => invoke('chapter.create', input, CreateChapterInputSchema, ChapterSchema),
    rename: (input) => invoke('chapter.rename', input, RenameChapterInputSchema, ChapterSchema),
    delete: (input) => invoke('chapter.delete', input, DeleteChapterInputSchema, SuccessResultSchema),
    reorder: (input) => invoke('chapter.reorder', input, ReorderChaptersInputSchema, z.array(ChapterSchema)),
    split: (input) => invoke('chapter.split', input, SplitChapterInputSchema, z.array(ChapterSchema)),
    merge: (input) => invoke('chapter.merge', input, MergeChapterInputSchema, z.array(ChapterSchema)),
    listSnapshots: (input) => invoke('chapter.listSnapshots', input, ListSnapshotsInputSchema, z.array(ChapterSnapshotSchema)),
    getSnapshot: (input) => invoke('chapter.getSnapshot', input, GetSnapshotInputSchema, ChapterSnapshotDetailSchema),
    createSnapshot: (input) => invoke('chapter.createSnapshot', input, CreateSnapshotInputSchema, ChapterSnapshotSchema),
    createOrdinarySnapshot: (input) => invoke('chapter.createOrdinarySnapshot', input, CreateOrdinarySnapshotInputSchema, ChapterSnapshotSchema.nullable()),
    restoreSnapshot: (input) => invoke('chapter.restoreSnapshot', input, RestoreSnapshotInputSchema, ChapterSchema)
  },
  backup: {
    list: (input) => invoke('backup.list', input, ListBackupsInputSchema, z.array(BackupInfoSchema)),
    create: (input) => invoke('backup.create', input, CreateBackupInputSchema, BackupInfoSchema),
    restore: (input) => invoke('backup.restore', input, RestoreBackupInputSchema, OpenProjectResultSchema),
    openLocation: (input) => invoke('backup.openLocation', input, OpenBackupLocationInputSchema, SuccessResultSchema)
  },
  search: {
    keyword: (input) => invoke('search.keyword', input, KeywordSearchInputSchema, KeywordSearchResultSchema),
    hybrid: (input) => invoke('search.hybrid', input, HybridSearchInputSchema, KeywordSearchResultSchema)
  },
  index: {
    getStatus: (input) => invoke('index.getStatus', input, GetIndexStatusInputSchema, IndexStatusResultSchema),
    rebuild: (input) => invoke('index.rebuild', input, RebuildIndexInputSchema, RebuildIndexResultSchema)
  },
  creativeRule: {
    get: (input) => invoke('creativeRule.get', input, GetCreativeRuleInputSchema, CreativeRuleSchema),
    update: (input) => invoke('creativeRule.update', input, UpdateCreativeRuleInputSchema, CreativeRuleSchema)
  },
  styleSample: {
    list: (input) => invoke('styleSample.list', input, ListStyleSamplesInputSchema, z.array(StyleSampleSchema)),
    get: (input) => invoke('styleSample.get', input, GetStyleSampleInputSchema, StyleSampleSchema),
    create: (input) => invoke('styleSample.create', input, CreateStyleSampleInputSchema, StyleSampleSchema),
    update: (input) => invoke('styleSample.update', input, UpdateStyleSampleInputSchema, StyleSampleSchema),
    delete: (input) => invoke('styleSample.delete', input, DeleteStyleSampleInputSchema, SuccessResultSchema)
  },
  preset: {
    list: (input) => invoke('preset.list', input, ListInstructionPresetsInputSchema, z.array(InstructionPresetSchema)),
    get: (input) => invoke('preset.get', input, GetInstructionPresetInputSchema, InstructionPresetSchema),
    create: (input) => invoke('preset.create', input, CreateInstructionPresetInputSchema, InstructionPresetSchema),
    update: (input) => invoke('preset.update', input, UpdateInstructionPresetInputSchema, InstructionPresetSchema),
    delete: (input) => invoke('preset.delete', input, DeleteInstructionPresetInputSchema, SuccessResultSchema)
  },
  knowledge: {
    list: (input) => invoke('knowledge.list', input, ListKnowledgeEntriesInputSchema, z.array(KnowledgeEntrySchema)),
    get: (input) => invoke('knowledge.get', input, GetKnowledgeEntryInputSchema, KnowledgeEntrySchema),
    create: (input) => invoke('knowledge.create', input, CreateKnowledgeEntryInputSchema, KnowledgeEntrySchema),
    update: (input) => invoke('knowledge.update', input, UpdateKnowledgeEntryInputSchema, KnowledgeEntrySchema),
    archive: (input) => invoke('knowledge.archive', input, ArchiveKnowledgeEntryInputSchema, KnowledgeEntrySchema),
    restore: (input) => invoke('knowledge.restore', input, RestoreKnowledgeEntryInputSchema, KnowledgeEntrySchema),
    delete: (input) => invoke('knowledge.delete', input, DeleteKnowledgeEntryInputSchema, SuccessResultSchema),
    listSuggestions: (input) => invoke('knowledge.listSuggestions', input, ListSuggestionsInputSchema, z.array(AiFactSuggestionSchema)),
    getSuggestion: (input) => invoke('knowledge.getSuggestion', input, GetSuggestionInputSchema, AiFactSuggestionSchema),
    reviewSuggestion: (input) => invoke('knowledge.reviewSuggestion', input, ReviewSuggestionInputSchema, AiFactSuggestionSchema),
    previewSuggestionAcceptance: (input) => invoke('knowledge.previewSuggestionAcceptance', input, PreviewSuggestionAcceptanceInputSchema, SuggestionAcceptancePreviewSchema),
    acceptSuggestion: (input) => invoke('knowledge.acceptSuggestion', input, AcceptSuggestionInputSchema, KnowledgeEntrySchema)
  },
  relationship: {
    list: (input) => invoke('relationship.list', input, ListCharacterRelationshipsInputSchema, z.array(CharacterRelationshipSchema)),
    get: (input) => invoke('relationship.get', input, GetCharacterRelationshipInputSchema, CharacterRelationshipSchema),
    create: (input) => invoke('relationship.create', input, CreateCharacterRelationshipInputSchema, CharacterRelationshipSchema),
    update: (input) => invoke('relationship.update', input, UpdateCharacterRelationshipInputSchema, CharacterRelationshipSchema),
    delete: (input) => invoke('relationship.delete', input, DeleteCharacterRelationshipInputSchema, SuccessResultSchema)
  },
  connection: {
    list: (input = {}) => invoke('connection.list', input, ListModelConnectionsInputSchema, z.array(ModelConnectionSummarySchema)),
    get: (input) => invoke('connection.get', input, GetModelConnectionInputSchema, ModelConnectionSummarySchema),
    create: (input) => invoke('connection.create', input, CreateModelConnectionInputSchema, ModelConnectionSummarySchema),
    update: (input) => invoke('connection.update', input, UpdateModelConnectionInputSchema, ModelConnectionSummarySchema),
    delete: (input) => invoke('connection.delete', input, DeleteModelConnectionInputSchema, SuccessResultSchema),
    test: (input) => invoke('connection.test', input, TestModelConnectionInputSchema, ConnectionTestResultSchema),
    listModels: (input) => invoke('connection.listModels', input, ListRemoteModelsInputSchema, ListRemoteModelsResultSchema),
    confirmContentTarget: (input) => invoke('connection.confirmContentTarget', input, ConfirmContentTargetInputSchema, ConfirmContentTargetResultSchema),
    setTaskRoute: (input) => invoke('connection.setTaskRoute', input, SetTaskRouteInputSchema, TaskRouteSummarySchema.nullable())
  },
  diagnostics: {
    getLogState: () => invoke('diagnostics.getLogState', undefined, z.undefined(), LogStateResultSchema),
    setDetailedLogging: (input) => invoke('diagnostics.setDetailedLogging', input, SetDetailedLoggingInputSchema, LogStateResultSchema),
    clearDetailedLogs: () => invoke('diagnostics.clearDetailedLogs', undefined, z.undefined(), SuccessResultSchema)
  },
  analysis: {
    start: (input) => invoke('analysis.start', input, StartAnalysisInputSchema, StartAnalysisResultSchema),
    cancel: (input) => invoke('analysis.cancel', input, CancelTaskInputSchema, SuccessResultSchema),
    resume: (input) => invoke('analysis.resume', input, ResumeTaskInputSchema, StartAnalysisResultSchema),
    getProgress: (input) => invoke('analysis.getProgress', input, GetTaskProgressInputSchema, TaskProgressEventSchema)
  },
  task: {
    list: (input) => invoke('task.list', input, ListTasksInputSchema, z.array(TaskSummarySchema)),
    get: (input) => invoke('task.get', input, GetTaskInputSchema, TaskDetailSchema),
    retryStep: (input) => invoke('task.retryStep', input, RetryStepInputSchema, TaskSummarySchema),
    skipStep: (input) => invoke('task.skipStep', input, SkipStepInputSchema, TaskSummarySchema),
    onProgress: (callback: (event: TaskProgressEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        try {
          callback(TaskProgressEventSchema.parse(data))
        } catch {}
      }
      ipcRenderer.on('task:progress', listener)
      return () => {
        ipcRenderer.removeListener('task:progress', listener)
      }
    }
  },
  consistencyIssue: {
    list: (input) => invoke('consistencyIssue.list', input, ListConsistencyIssuesInputSchema, z.array(ConsistencyIssueSchema)),
    review: (input) => invoke('consistencyIssue.review', input, ReviewConsistencyIssueInputSchema, ConsistencyIssueSchema)
  },
  report: {
    create: (input) => invoke('report.create', input, CreateReportInputSchema, z.object({ reportId: z.string().uuid() })),
    list: (input) => invoke('report.list', input, ListReportsInputSchema, z.array(LiteraryReportSummarySchema)),
    get: (input) => invoke('report.get', input, GetReportInputSchema, LiteraryReportDetailSchema),
    addAnnotation: (input) => invoke('report.addAnnotation', input, AddReportAnnotationInputSchema, ReportAnnotationSchema),
    updateAnnotation: (input) => invoke('report.updateAnnotation', input, UpdateReportAnnotationInputSchema, ReportAnnotationSchema),
    deleteAnnotation: (input) => invoke('report.deleteAnnotation', input, DeleteReportAnnotationInputSchema, SuccessResultSchema)
  },
  synopsis: {
    get: (input) => invoke('synopsis.get', input, GetSynopsisInputSchema, BookSynopsisSchema.nullable())
  },
  chapterSummary: {
    get: (input) => invoke('chapterSummary.get', input, GetChapterSummaryInputSchema, ChapterSummarySchema.nullable()),
    list: (input) => invoke('chapterSummary.list', input, ListChapterSummariesInputSchema, z.array(ChapterSummarySchema))
  },
  context: {
    preview: (input) => invoke('context.preview', input, ContextPreviewInputSchema, ContextPackageSchema),
    get: (input) => invoke('context.get', input, GetContextPackageInputSchema, ContextPackageSchema)
  },
  creation: {
    start: (input) => invoke('creation.start', input, StartCreationInputSchema, StartCreationResultSchema),
    regenerate: (input) => invoke('creation.regenerate', input, RegenerateCreationInputSchema, StartCreationResultSchema),
    cancel: (input) => invoke('creation.cancel', input, CancelCreationInputSchema, SuccessResultSchema)
  },
  candidate: {
    list: (input) => invoke('candidate.list', input, ListCandidatesInputSchema, z.array(CandidateSummarySchema)),
    get: (input) => invoke('candidate.get', input, GetCandidateInputSchema, CandidateDetailSchema),
    updateText: (input) => invoke('candidate.updateText', input, UpdateCandidateTextInputSchema, CandidateDetailSchema),
    stageHunk: (input) => invoke('candidate.stageHunk', input, StageCandidateHunkInputSchema, CandidateDetailSchema),
    retain: (input) => invoke('candidate.retain', input, RetainCandidateInputSchema, CandidateDetailSchema),
    apply: (input) => invoke('candidate.apply', input, ApplyCandidateInputSchema, CandidateApplyResultSchema),
    reject: (input) => invoke('candidate.reject', input, RejectCandidateInputSchema, CandidateDetailSchema),
    onDelta: (callback: (event: CandidateDeltaEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        try {
          callback(CandidateDeltaEventSchema.parse(data))
        } catch {}
      }
      ipcRenderer.on('candidate:delta', listener)
      return () => {
        ipcRenderer.removeListener('candidate:delta', listener)
      }
    },
    onDone: (callback: (event: CandidateDoneEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        try {
          callback(CandidateDoneEventSchema.parse(data))
        } catch {}
      }
      ipcRenderer.on('candidate:done', listener)
      return () => {
        ipcRenderer.removeListener('candidate:done', listener)
      }
    }
  },
  chat: {
    create: (input) => invoke('chat.create', input, CreateChatSessionInputSchema, ChatSessionSchema),
    list: (input) => invoke('chat.list', input, ListChatSessionsInputSchema, z.array(ChatSessionSchema)),
    getSession: (input) => invoke('chat.getSession', input, GetChatSessionInputSchema, ChatSessionSchema),
    updateStage: (input) => invoke('chat.updateStage', input, UpdateChatWorkflowStageInputSchema, ChatSessionSchema),
    delete: (input) => invoke('chat.delete', input, DeleteChatSessionInputSchema, SuccessResultSchema),
    send: (input) => invoke('chat.send', input, SendChatMessageInputSchema, z.object({ messageId: z.string().uuid(), userMessageId: z.string().uuid(), contextPackageId: z.string().uuid() })),
    cancel: (input) => invoke('chat.cancel', input, CancelChatInputSchema, SuccessResultSchema),
    compact: (input) => invoke('chat.compact', input, CompactChatSessionInputSchema, ChatSummarySchema),
    listMessages: (input) => invoke('chat.listMessages', input, ListChatMessagesInputSchema, z.array(ChatMessageSchema)),
    getSummary: (input) => invoke('chat.getSummary', input, GetChatSummaryInputSchema, ChatSummarySchema.nullable()),
    updateSummary: (input) => invoke('chat.updateSummary', input, UpdateChatSummaryInputSchema, ChatSummarySchema),
    onDelta: (callback: (event: ChatDeltaEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        try {
          callback(ChatDeltaEventSchema.parse(data))
        } catch {}
      }
      ipcRenderer.on('chat:delta', listener)
      return () => {
        ipcRenderer.removeListener('chat:delta', listener)
      }
    },
    onDone: (callback: (event: ChatDoneEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        try {
          callback(ChatDoneEventSchema.parse(data))
        } catch {}
      }
      ipcRenderer.on('chat:done', listener)
      return () => {
        ipcRenderer.removeListener('chat:done', listener)
      }
    }
  },
  outline: {
    getBookOutline: (input) => invoke('outline.getBook', input, GetBookOutlineInputSchema, BookOutlineSchema.nullable()),
    saveBookOutline: (input) => invoke('outline.saveBook', input, SaveBookOutlineInputSchema, BookOutlineSchema),
    confirmBookOutline: (input) => invoke('outline.confirmBook', input, ConfirmBookOutlineInputSchema, BookOutlineSchema),
    generateBookOutlineDraft: (input) => invoke('outline.generateBookDraft', input, GenerateBookOutlineDraftInputSchema, BookOutlineSchema),
    listVolumeOutlines: (input) => invoke('outline.listVolumes', input, ListVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema)),
    getVolumeOutline: (input) => invoke('outline.getVolume', input, GetVolumeOutlineInputSchema, VolumeOutlineSchema),
    createVolumeOutline: (input) => invoke('outline.createVolume', input, CreateVolumeOutlineInputSchema, VolumeOutlineSchema),
    updateVolumeOutline: (input) => invoke('outline.updateVolume', input, UpdateVolumeOutlineInputSchema, VolumeOutlineSchema),
    deleteVolumeOutline: (input) => invoke('outline.deleteVolume', input, DeleteVolumeOutlineInputSchema, SuccessResultSchema),
    reorderVolumeOutlines: (input) => invoke('outline.reorderVolumes', input, ReorderVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema)),
    listChapterOutlines: (input) => invoke('outline.listChapters', input, ListChapterOutlinesInputSchema, z.array(ChapterOutlineSchema)),
    getChapterOutline: (input) => invoke('outline.getChapter', input, GetChapterOutlineInputSchema, ChapterOutlineSchema),
    getLatestChapterOutline: (input) => invoke('outline.getLatestChapter', input, GetLatestChapterOutlineInputSchema, ChapterOutlineSchema.nullable()),
    saveChapterOutline: (input) => invoke('outline.saveChapter', input, SaveChapterOutlineInputSchema, ChapterOutlineSchema),
    confirmChapterOutline: (input) => invoke('outline.confirmChapter', input, ConfirmChapterOutlineInputSchema, ChapterOutlineSchema),
    deleteChapterOutline: (input) => invoke('outline.deleteChapter', input, DeleteChapterOutlineInputSchema, SuccessResultSchema)
  },
  window: {
    minimize: () => invoke('window.minimize', undefined, z.undefined(), z.boolean()),
    maximize: () => invoke('window.toggleMaximize', undefined, z.undefined(), z.boolean()),
    close: () => invoke('window.close', undefined, z.undefined(), z.boolean()),
    isMaximized: () => invoke('window.isMaximized', undefined, z.undefined(), z.boolean()),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
        callback(Boolean(isMaximized))
      }
      ipcRenderer.on('window:maximized', listener)
      return () => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('novelAgent', api)



