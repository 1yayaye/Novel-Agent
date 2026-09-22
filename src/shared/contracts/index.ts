import { z } from 'zod'
import {
  Chapter,
  ChapterHeader,
  ChapterSnapshot,
  ChapterSnapshotDetail,
  CreateOrdinarySnapshotInput,
  CreateSnapshotInput,
  GetSnapshotInput,
  ListSnapshotsInput,
  RestoreSnapshotInput,
  CreateChapterInputSchema,
  DeleteChapterInputSchema,
  GetChapterInputSchema,
  ListChaptersInputSchema,
  MergeChapterInputSchema,
  RenameChapterInputSchema,
  ReorderChaptersInputSchema,
  SplitChapterInputSchema,
  UpdateChapterInputSchema
} from './chapter'
import {
  BookOutline,
  ChapterOutline,
  ConfirmBookOutlineInput,
  ConfirmChapterOutlineInput,
  CreateVolumeOutlineInput,
  DeleteChapterOutlineInput,
  DeleteVolumeOutlineInput,
  GenerateBookOutlineDraftInput,
  GetBookOutlineInput,
  GetChapterOutlineInput,
  GetLatestChapterOutlineInput,
  GetVolumeOutlineInput,
  ListChapterOutlinesInput,
  ListVolumeOutlinesInput,
  ReorderVolumeOutlinesInput,
  SaveBookOutlineInput,
  SaveChapterOutlineInput,
  UpdateVolumeOutlineInput,
  VolumeOutline
} from './outline'
import {
  AddReportAnnotationInput,
  AiFactSuggestion,
  BookSynopsis,
  ChapterSummary,
  CharacterRelationship,
  ConsistencyIssue,
  CreateReportInput,
  DeleteReportAnnotationInput,
  UpdateReportAnnotationInput,
  GetChapterSummaryInput,
  GetReportInput,
  GetSynopsisInput,
  KnowledgeEntry,
  ListChapterSummariesInput,
  ListConsistencyIssuesInput,
  ListReportsInput,
  LiteraryReportDetail,
  LiteraryReportSummary,
  ReportAnnotation,
  ReviewConsistencyIssueInput,
  SuggestionAcceptancePreview,
  AcceptSuggestionInputSchema,
  ArchiveKnowledgeEntryInputSchema,
  CreateCharacterRelationshipInputSchema,
  CreateKnowledgeEntryInputSchema,
  DeleteCharacterRelationshipInputSchema,
  DeleteKnowledgeEntryInputSchema,
  GetCharacterRelationshipInputSchema,
  GetKnowledgeEntryInputSchema,
  GetSuggestionInputSchema,
  ListCharacterRelationshipsInputSchema,
  ListKnowledgeEntriesInputSchema,
  ListSuggestionsInputSchema,
  PreviewSuggestionAcceptanceInputSchema,
  RestoreKnowledgeEntryInputSchema,
  ReviewSuggestionInputSchema,
  UpdateCharacterRelationshipInputSchema,
  UpdateKnowledgeEntryInputSchema
} from './knowledge'
import {
  ApplyCandidateInput,
  CandidateApplyResult,
  CandidateDeltaEvent,
  CandidateDetail,
  CandidateDoneEvent,
  CandidateSummary,
  CancelChatInput,
  CancelCreationInput,
  CancelTaskInput,
  ChatMessage,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatSession,
  ChatSummary,
  CompactChatSessionInput,
  ConfirmContentTargetResult,
  ConnectionTestResult,
  ContextPackage,
  ContextPreviewInput,
  CreateChatSessionInput,
  CreativeRule,
  DeleteChatSessionInput,
  GetCandidateInput,
  GetChatSessionInput,
  GetChatSummaryInput,
  GetContextPackageInput,
  GetTaskInput,
  GetTaskProgressInput,
  InstructionPreset,
  ListCandidatesInput,
  ListChatMessagesInput,
  ListChatSessionsInput,
  ListRemoteModelsResult,
  ListTasksInput,
  ModelConnectionSummary,
  RegenerateCreationInput,
  RejectCandidateInput,
  ResumeTaskInput,
  RetainCandidateInput,
  RetryStepInput,
  SendChatMessageInput,
  SkipStepInput,
  StageCandidateHunkInput,
  StartAnalysisInput,
  StartAnalysisResult,
  StartCreationInput,
  StartCreationResult,
  StyleSample,
  TaskDetail,
  TaskProgressEvent,
  TaskRouteSummary,
  TaskSummary,
  UpdateCandidateTextInput,
  UpdateChatSummaryInput,
  UpdateChatWorkflowStageInput,
  ConfirmContentTargetInputSchema,
  CreateModelConnectionInputSchema,
  CreateInstructionPresetInputSchema,
  CreateStyleSampleInputSchema,
  DeleteInstructionPresetInputSchema,
  DeleteModelConnectionInputSchema,
  DeleteStyleSampleInputSchema,
  GetCreativeRuleInputSchema,
  GetInstructionPresetInputSchema,
  GetModelConnectionInputSchema,
  GetStyleSampleInputSchema,
  ListInstructionPresetsInputSchema,
  ListModelConnectionsInputSchema,
  ListRemoteModelsInputSchema,
  ListStyleSamplesInputSchema,
  SetTaskRouteInputSchema,
  TestModelConnectionInputSchema,
  UpdateCreativeRuleInputSchema,
  UpdateInstructionPresetInputSchema,
  UpdateModelConnectionInputSchema,
  UpdateStyleSampleInputSchema
} from './ai'
import {
  BackupInfo,
  CreateBackupInput,
  CreateProjectInput,
  ExportProjectInput,
  ExportProjectResult,
  HybridSearchInput,
  ImportPreviewInput,
  ImportPreviewResult,
  ImportProjectInput,
  IndexStatusResult,
  KeywordSearchInput,
  ListBackupsInput,
  LogStateResult,
  OpenBackupLocationInput,
  OpenProjectResult,
  ProjectSummary,
  RebuildIndexResult,
  RecentProject,
  RestoreBackupInput,
  SaveCopyResult,
  SearchResultItem,
  SuccessResult,
  CloseProjectInputSchema,
  ExportProjectInputSchema,
  GetIndexStatusInputSchema,
  OpenProjectInputSchema,
  RebuildIndexInputSchema,
  SaveCopyInputSchema,
  SetDetailedLoggingInputSchema
} from './system'

export * from './chapter'
export * from './outline'
export * from './knowledge'
export * from './ai'
export * from './system'

export type NovelAgentApi = {
  project: {
    create(input: CreateProjectInput): Promise<ProjectSummary>
    open(input: z.infer<typeof OpenProjectInputSchema>): Promise<OpenProjectResult>
    close(input: z.infer<typeof CloseProjectInputSchema>): Promise<SuccessResult>
    saveCopy(input: z.infer<typeof SaveCopyInputSchema>): Promise<SaveCopyResult>
    listRecent(): Promise<RecentProject[]>
    chooseAndOpen(): Promise<OpenProjectResult | null>
    previewImport(input?: ImportPreviewInput): Promise<ImportPreviewResult>
    import(input: ImportProjectInput): Promise<ProjectSummary | null>
    export(input: ExportProjectInput): Promise<ExportProjectResult | null>
  }
  chapter: {
    list(input: z.infer<typeof ListChaptersInputSchema>): Promise<ChapterHeader[]>
    get(input: z.infer<typeof GetChapterInputSchema>): Promise<Chapter>
    update(input: z.infer<typeof UpdateChapterInputSchema>): Promise<Chapter>
    create(input: z.infer<typeof CreateChapterInputSchema>): Promise<Chapter>
    rename(input: z.infer<typeof RenameChapterInputSchema>): Promise<Chapter>
    delete(input: z.infer<typeof DeleteChapterInputSchema>): Promise<SuccessResult>
    reorder(input: z.infer<typeof ReorderChaptersInputSchema>): Promise<ChapterHeader[]>
    split(input: z.infer<typeof SplitChapterInputSchema>): Promise<ChapterHeader[]>
    merge(input: z.infer<typeof MergeChapterInputSchema>): Promise<ChapterHeader[]>
    listSnapshots(input: ListSnapshotsInput): Promise<ChapterSnapshot[]>
    getSnapshot(input: GetSnapshotInput): Promise<ChapterSnapshotDetail>
    createSnapshot(input: CreateSnapshotInput): Promise<ChapterSnapshot>
    createOrdinarySnapshot(input: CreateOrdinarySnapshotInput): Promise<ChapterSnapshot | null>
    restoreSnapshot(input: RestoreSnapshotInput): Promise<Chapter>
  }
  backup: {
    list(input: ListBackupsInput): Promise<BackupInfo[]>
    create(input: CreateBackupInput): Promise<BackupInfo>
    restore(input: RestoreBackupInput): Promise<OpenProjectResult>
    openLocation(input: OpenBackupLocationInput): Promise<SuccessResult>
  }
  search: {
    keyword(input: KeywordSearchInput): Promise<SearchResultItem[]>
    hybrid(input: HybridSearchInput): Promise<SearchResultItem[]>
  }
  index: {
    getStatus(input: z.infer<typeof GetIndexStatusInputSchema>): Promise<IndexStatusResult>
    rebuild(input: z.infer<typeof RebuildIndexInputSchema>): Promise<RebuildIndexResult>
  }
  creativeRule: {
    get(input: z.infer<typeof GetCreativeRuleInputSchema>): Promise<CreativeRule>
    update(input: z.infer<typeof UpdateCreativeRuleInputSchema>): Promise<CreativeRule>
  }
  styleSample: {
    list(input: z.infer<typeof ListStyleSamplesInputSchema>): Promise<StyleSample[]>
    get(input: z.infer<typeof GetStyleSampleInputSchema>): Promise<StyleSample>
    create(input: z.infer<typeof CreateStyleSampleInputSchema>): Promise<StyleSample>
    update(input: z.infer<typeof UpdateStyleSampleInputSchema>): Promise<StyleSample>
    delete(input: z.infer<typeof DeleteStyleSampleInputSchema>): Promise<SuccessResult>
  }
  preset: {
    list(input: z.infer<typeof ListInstructionPresetsInputSchema>): Promise<InstructionPreset[]>
    get(input: z.infer<typeof GetInstructionPresetInputSchema>): Promise<InstructionPreset>
    create(input: z.infer<typeof CreateInstructionPresetInputSchema>): Promise<InstructionPreset>
    update(input: z.infer<typeof UpdateInstructionPresetInputSchema>): Promise<InstructionPreset>
    delete(input: z.infer<typeof DeleteInstructionPresetInputSchema>): Promise<SuccessResult>
  }
  knowledge: {
    list(input: z.infer<typeof ListKnowledgeEntriesInputSchema>): Promise<KnowledgeEntry[]>
    get(input: z.infer<typeof GetKnowledgeEntryInputSchema>): Promise<KnowledgeEntry>
    create(input: z.infer<typeof CreateKnowledgeEntryInputSchema>): Promise<KnowledgeEntry>
    update(input: z.infer<typeof UpdateKnowledgeEntryInputSchema>): Promise<KnowledgeEntry>
    archive(input: z.infer<typeof ArchiveKnowledgeEntryInputSchema>): Promise<KnowledgeEntry>
    restore(input: z.infer<typeof RestoreKnowledgeEntryInputSchema>): Promise<KnowledgeEntry>
    delete(input: z.infer<typeof DeleteKnowledgeEntryInputSchema>): Promise<SuccessResult>
    listSuggestions(input: z.infer<typeof ListSuggestionsInputSchema>): Promise<AiFactSuggestion[]>
    getSuggestion(input: z.infer<typeof GetSuggestionInputSchema>): Promise<AiFactSuggestion>
    reviewSuggestion(input: z.infer<typeof ReviewSuggestionInputSchema>): Promise<AiFactSuggestion>
    previewSuggestionAcceptance(input: z.infer<typeof PreviewSuggestionAcceptanceInputSchema>): Promise<SuggestionAcceptancePreview>
    acceptSuggestion(input: z.infer<typeof AcceptSuggestionInputSchema>): Promise<KnowledgeEntry>
  }
  relationship: {
    list(input: z.infer<typeof ListCharacterRelationshipsInputSchema>): Promise<CharacterRelationship[]>
    get(input: z.infer<typeof GetCharacterRelationshipInputSchema>): Promise<CharacterRelationship>
    create(input: z.infer<typeof CreateCharacterRelationshipInputSchema>): Promise<CharacterRelationship>
    update(input: z.infer<typeof UpdateCharacterRelationshipInputSchema>): Promise<CharacterRelationship>
    delete(input: z.infer<typeof DeleteCharacterRelationshipInputSchema>): Promise<SuccessResult>
  }
  connection: {
    list(input?: z.infer<typeof ListModelConnectionsInputSchema>): Promise<ModelConnectionSummary[]>
    get(input: z.infer<typeof GetModelConnectionInputSchema>): Promise<ModelConnectionSummary>
    create(input: z.infer<typeof CreateModelConnectionInputSchema>): Promise<ModelConnectionSummary>
    update(input: z.infer<typeof UpdateModelConnectionInputSchema>): Promise<ModelConnectionSummary>
    delete(input: z.infer<typeof DeleteModelConnectionInputSchema>): Promise<SuccessResult>
    test(input: z.infer<typeof TestModelConnectionInputSchema>): Promise<ConnectionTestResult>
    listModels(input: z.infer<typeof ListRemoteModelsInputSchema>): Promise<ListRemoteModelsResult>
    confirmContentTarget(input: z.infer<typeof ConfirmContentTargetInputSchema>): Promise<ConfirmContentTargetResult>
    setTaskRoute(input: z.infer<typeof SetTaskRouteInputSchema>): Promise<TaskRouteSummary | null>
  }
  diagnostics: {
    getLogState(): Promise<LogStateResult>
    setDetailedLogging(input: z.infer<typeof SetDetailedLoggingInputSchema>): Promise<LogStateResult>
    clearDetailedLogs(): Promise<SuccessResult>
  }
  analysis: {
    start(input: StartAnalysisInput): Promise<StartAnalysisResult>
    cancel(input: CancelTaskInput): Promise<SuccessResult>
    resume(input: ResumeTaskInput): Promise<StartAnalysisResult>
    getProgress(input: GetTaskProgressInput): Promise<TaskProgressEvent>
  }
  task: {
    list(input: ListTasksInput): Promise<TaskSummary[]>
    get(input: GetTaskInput): Promise<TaskDetail>
    retryStep(input: RetryStepInput): Promise<TaskSummary>
    skipStep(input: SkipStepInput): Promise<TaskSummary>
    onProgress?(callback: (event: TaskProgressEvent) => void): () => void
  }
  consistencyIssue: {
    list(input: ListConsistencyIssuesInput): Promise<ConsistencyIssue[]>
    review(input: ReviewConsistencyIssueInput): Promise<ConsistencyIssue>
  }
  report: {
    create(input: CreateReportInput): Promise<{ reportId: string }>
    list(input: ListReportsInput): Promise<LiteraryReportSummary[]>
    get(input: GetReportInput): Promise<LiteraryReportDetail>
    addAnnotation(input: AddReportAnnotationInput): Promise<ReportAnnotation>
    updateAnnotation(input: UpdateReportAnnotationInput): Promise<ReportAnnotation>
    deleteAnnotation(input: DeleteReportAnnotationInput): Promise<SuccessResult>
  }
  synopsis: {
    get(input: GetSynopsisInput): Promise<BookSynopsis | null>
  }
  chapterSummary: {
    get(input: GetChapterSummaryInput): Promise<ChapterSummary | null>
    list(input: ListChapterSummariesInput): Promise<ChapterSummary[]>
  }
  context: {
    preview(input: ContextPreviewInput): Promise<ContextPackage>
    get(input: GetContextPackageInput): Promise<ContextPackage>
  }
  creation: {
    start(input: StartCreationInput): Promise<StartCreationResult>
    regenerate(input: RegenerateCreationInput): Promise<StartCreationResult>
    cancel(input: CancelCreationInput): Promise<SuccessResult>
  }
  candidate: {
    list(input: ListCandidatesInput): Promise<CandidateSummary[]>
    get(input: GetCandidateInput): Promise<CandidateDetail>
    updateText(input: UpdateCandidateTextInput): Promise<CandidateDetail>
    stageHunk(input: StageCandidateHunkInput): Promise<CandidateDetail>
    retain(input: RetainCandidateInput): Promise<CandidateDetail>
    apply(input: ApplyCandidateInput): Promise<CandidateApplyResult>
    reject(input: RejectCandidateInput): Promise<CandidateDetail>
    onDelta?(callback: (event: CandidateDeltaEvent) => void): () => void
    onDone?(callback: (event: CandidateDoneEvent) => void): () => void
  }
  chat: {
    create(input: CreateChatSessionInput): Promise<ChatSession>
    list(input: ListChatSessionsInput): Promise<ChatSession[]>
    getSession(input: GetChatSessionInput): Promise<ChatSession>
    updateStage(input: UpdateChatWorkflowStageInput): Promise<ChatSession>
    delete(input: DeleteChatSessionInput): Promise<SuccessResult>
    send(input: SendChatMessageInput): Promise<{ messageId: string; userMessageId: string; contextPackageId: string }>
    cancel(input: CancelChatInput): Promise<SuccessResult>
    compact(input: CompactChatSessionInput): Promise<ChatSummary>
    listMessages(input: ListChatMessagesInput): Promise<ChatMessage[]>
    getSummary(input: GetChatSummaryInput): Promise<ChatSummary | null>
    updateSummary(input: UpdateChatSummaryInput): Promise<ChatSummary>
    onDelta?(callback: (event: ChatDeltaEvent) => void): () => void
    onDone?(callback: (event: ChatDoneEvent) => void): () => void
  }
  outline: {
    getBookOutline(input: GetBookOutlineInput): Promise<BookOutline | null>
    saveBookOutline(input: SaveBookOutlineInput): Promise<BookOutline>
    confirmBookOutline(input: ConfirmBookOutlineInput): Promise<BookOutline>
    generateBookOutlineDraft(input: GenerateBookOutlineDraftInput): Promise<BookOutline>
    listVolumeOutlines(input: ListVolumeOutlinesInput): Promise<VolumeOutline[]>
    getVolumeOutline(input: GetVolumeOutlineInput): Promise<VolumeOutline>
    createVolumeOutline(input: CreateVolumeOutlineInput): Promise<VolumeOutline>
    updateVolumeOutline(input: UpdateVolumeOutlineInput): Promise<VolumeOutline>
    deleteVolumeOutline(input: DeleteVolumeOutlineInput): Promise<SuccessResult>
    reorderVolumeOutlines(input: ReorderVolumeOutlinesInput): Promise<VolumeOutline[]>
    listChapterOutlines(input: ListChapterOutlinesInput): Promise<ChapterOutline[]>
    getChapterOutline(input: GetChapterOutlineInput): Promise<ChapterOutline>
    getLatestChapterOutline(input: GetLatestChapterOutlineInput): Promise<ChapterOutline | null>
    saveChapterOutline(input: SaveChapterOutlineInput): Promise<ChapterOutline>
    confirmChapterOutline(input: ConfirmChapterOutlineInput): Promise<ChapterOutline>
    deleteChapterOutline(input: DeleteChapterOutlineInput): Promise<SuccessResult>
  }
  window: {
    minimize(): Promise<boolean>
    maximize(): Promise<boolean>
    close(): Promise<boolean>
    isMaximized(): Promise<boolean>
    onMaximizedChange?(callback: (isMaximized: boolean) => void): () => void
  }
}
