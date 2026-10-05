/**
 * src/shared/platform-bridge/api-factory.ts
 *
 * Constructs the strongly typed NovelAgentApi surface on top of an IpcTransport.
 * Compatible with Electron preload and WinUI 3 WebView2.
 */

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
  ChapterHeaderSchema,
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
  RetryTaskInputSchema,
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
} from '../project.js'
import { parseIpcInput, parseIpcOutput, shouldParseIpcOutput } from '../ipc-parse.js'
import {
  type IpcTransport,
  NovelAgentError,
  isNovelAgentError,
  ElectronPreloadTransport,
  WebView2Transport,
  type ChromeWebViewLike,
  type ElectronIpcRendererLike
} from './transport.js'

/**
 * Reusable invocation helper validating input & output schemas and standardizing error handling.
 */
export async function invokeApi<I, O>(
  transport: IpcTransport,
  channel: string,
  input: I,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>
): Promise<O> {
  let validatedInput: I
  try {
    validatedInput = shouldParseIpcOutput() ? parseIpcInput(inputSchema, input) : input
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new NovelAgentError('VALIDATION_ERROR', `Invalid input for ${channel}: ${err.message}`)
    }
    throw err
  }

  let rawValue: unknown
  try {
    rawValue = await transport.invoke(channel, validatedInput)
  } catch (err) {
    if (err instanceof NovelAgentError) {
      throw err
    }
    if (isNovelAgentError(err)) {
      throw new NovelAgentError(err.code, err.message)
    }
    if (err instanceof z.ZodError) {
      throw new NovelAgentError('VALIDATION_ERROR', err.message)
    }
    throw new NovelAgentError('DATABASE_ERROR', (err as Error)?.message ?? String(err))
  }

  // Defensive unwrap if raw transport returned wrapped IpcResult
  if (rawValue && typeof rawValue === 'object' && 'ok' in rawValue) {
    const res = rawValue as { ok: boolean; value?: unknown; error?: { code?: string; message?: string } }
    if (res.ok) {
      rawValue = res.value
    } else {
      throw new NovelAgentError(res.error?.code ?? 'DATABASE_ERROR', res.error?.message ?? 'IPC invocation failed')
    }
  }

  try {
    return parseIpcOutput(outputSchema, rawValue)
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new NovelAgentError('VALIDATION_ERROR', `Invalid output for ${channel}: ${err.message}`)
    }
    throw err
  }
}

/**
 * Reusable push event subscription helper with optional Zod parsing and safe cleanup.
 */
export function subscribeEvent<E>(
  transport: IpcTransport,
  channel: string,
  callback: (event: E) => void,
  schema?: z.ZodType<E>
): () => void {
  return transport.on(channel, (data: unknown) => {
    try {
      const parsed = schema && shouldParseIpcOutput() ? schema.parse(data) : (data as E)
      callback(parsed)
    } catch (err) {
      console.error(`[PlatformBridge] Failed to parse push event for ${channel}:`, err)
    }
  })
}

/**
 * Headless fallback transport used when neither Electron nor WebView2 runtime is present.
 */
export class HeadlessFallbackTransport implements IpcTransport {
  async invoke(channel: string): Promise<unknown> {
    throw new NovelAgentError(
      'PROJECT_NOT_OPEN',
      `Headless fallback: no active IPC transport for "${channel}"`
    )
  }

  on(): () => void {
    return () => {}
  }
}

/**
 * Generates the full NovelAgentApi facade bound to the given IpcTransport.
 */
export function createNovelAgentApi(transport: IpcTransport): NovelAgentApi {
  return {
    project: {
      create: (input) => invokeApi(transport, 'project.create', input, CreateProjectInputSchema, ProjectSummarySchema),
      open: (input) => invokeApi(transport, 'project.open', input, OpenProjectInputSchema, OpenProjectResultSchema),
      close: (input) => invokeApi(transport, 'project.close', input, CloseProjectInputSchema, SuccessResultSchema),
      saveCopy: (input) => invokeApi(transport, 'project.saveCopy', input, SaveCopyInputSchema, SaveCopyResultSchema),
      listRecent: () => invokeApi(transport, 'project.listRecent', undefined, z.undefined(), ListRecentProjectsResultSchema),
      chooseAndOpen: () => invokeApi(transport, 'project.chooseAndOpen', undefined, z.undefined(), OpenProjectResultSchema.nullable()),
      previewImport: (input = {}) => invokeApi(transport, 'project.previewImport', input, ImportPreviewInputSchema, ImportPreviewResultSchema),
      import: (input) => invokeApi(transport, 'project.import', input, ImportProjectInputSchema, ImportProjectResultSchema),
      export: (input) => invokeApi(transport, 'project.export', input, ExportProjectInputSchema, ExportProjectResultSchema.nullable())
    },
    chapter: {
      list: (input) => invokeApi(transport, 'chapter.list', input, ListChaptersInputSchema, z.array(ChapterHeaderSchema)),
      get: (input) => invokeApi(transport, 'chapter.get', input, GetChapterInputSchema, ChapterSchema),
      update: (input) => invokeApi(transport, 'chapter.update', input, UpdateChapterInputSchema, ChapterSchema),
      create: (input) => invokeApi(transport, 'chapter.create', input, CreateChapterInputSchema, ChapterSchema),
      rename: (input) => invokeApi(transport, 'chapter.rename', input, RenameChapterInputSchema, ChapterSchema),
      delete: (input) => invokeApi(transport, 'chapter.delete', input, DeleteChapterInputSchema, SuccessResultSchema),
      reorder: (input) => invokeApi(transport, 'chapter.reorder', input, ReorderChaptersInputSchema, z.array(ChapterHeaderSchema)),
      split: (input) => invokeApi(transport, 'chapter.split', input, SplitChapterInputSchema, z.array(ChapterHeaderSchema)),
      merge: (input) => invokeApi(transport, 'chapter.merge', input, MergeChapterInputSchema, z.array(ChapterHeaderSchema)),
      listSnapshots: (input) => invokeApi(transport, 'chapter.listSnapshots', input, ListSnapshotsInputSchema, z.array(ChapterSnapshotSchema)),
      getSnapshot: (input) => invokeApi(transport, 'chapter.getSnapshot', input, GetSnapshotInputSchema, ChapterSnapshotDetailSchema),
      createSnapshot: (input) => invokeApi(transport, 'chapter.createSnapshot', input, CreateSnapshotInputSchema, ChapterSnapshotSchema),
      createOrdinarySnapshot: (input) => invokeApi(transport, 'chapter.createOrdinarySnapshot', input, CreateOrdinarySnapshotInputSchema, ChapterSnapshotSchema.nullable()),
      restoreSnapshot: (input) => invokeApi(transport, 'chapter.restoreSnapshot', input, RestoreSnapshotInputSchema, ChapterSchema)
    },
    backup: {
      list: (input) => invokeApi(transport, 'backup.list', input, ListBackupsInputSchema, z.array(BackupInfoSchema)),
      create: (input) => invokeApi(transport, 'backup.create', input, CreateBackupInputSchema, BackupInfoSchema),
      restore: (input) => invokeApi(transport, 'backup.restore', input, RestoreBackupInputSchema, OpenProjectResultSchema),
      openLocation: (input) => invokeApi(transport, 'backup.openLocation', input, OpenBackupLocationInputSchema, SuccessResultSchema)
    },
    search: {
      keyword: (input) => invokeApi(transport, 'search.keyword', input, KeywordSearchInputSchema, KeywordSearchResultSchema),
      hybrid: (input) => invokeApi(transport, 'search.hybrid', input, HybridSearchInputSchema, KeywordSearchResultSchema)
    },
    index: {
      getStatus: (input) => invokeApi(transport, 'index.getStatus', input, GetIndexStatusInputSchema, IndexStatusResultSchema),
      rebuild: (input) => invokeApi(transport, 'index.rebuild', input, RebuildIndexInputSchema, RebuildIndexResultSchema)
    },
    creativeRule: {
      get: (input) => invokeApi(transport, 'creativeRule.get', input, GetCreativeRuleInputSchema, CreativeRuleSchema),
      update: (input) => invokeApi(transport, 'creativeRule.update', input, UpdateCreativeRuleInputSchema, CreativeRuleSchema)
    },
    styleSample: {
      list: (input) => invokeApi(transport, 'styleSample.list', input, ListStyleSamplesInputSchema, z.array(StyleSampleSchema)),
      get: (input) => invokeApi(transport, 'styleSample.get', input, GetStyleSampleInputSchema, StyleSampleSchema),
      create: (input) => invokeApi(transport, 'styleSample.create', input, CreateStyleSampleInputSchema, StyleSampleSchema),
      update: (input) => invokeApi(transport, 'styleSample.update', input, UpdateStyleSampleInputSchema, StyleSampleSchema),
      delete: (input) => invokeApi(transport, 'styleSample.delete', input, DeleteStyleSampleInputSchema, SuccessResultSchema)
    },
    preset: {
      list: (input) => invokeApi(transport, 'preset.list', input, ListInstructionPresetsInputSchema, z.array(InstructionPresetSchema)),
      get: (input) => invokeApi(transport, 'preset.get', input, GetInstructionPresetInputSchema, InstructionPresetSchema),
      create: (input) => invokeApi(transport, 'preset.create', input, CreateInstructionPresetInputSchema, InstructionPresetSchema),
      update: (input) => invokeApi(transport, 'preset.update', input, UpdateInstructionPresetInputSchema, InstructionPresetSchema),
      delete: (input) => invokeApi(transport, 'preset.delete', input, DeleteInstructionPresetInputSchema, SuccessResultSchema)
    },
    knowledge: {
      list: (input) => invokeApi(transport, 'knowledge.list', input, ListKnowledgeEntriesInputSchema, z.array(KnowledgeEntrySchema)),
      get: (input) => invokeApi(transport, 'knowledge.get', input, GetKnowledgeEntryInputSchema, KnowledgeEntrySchema),
      create: (input) => invokeApi(transport, 'knowledge.create', input, CreateKnowledgeEntryInputSchema, KnowledgeEntrySchema),
      update: (input) => invokeApi(transport, 'knowledge.update', input, UpdateKnowledgeEntryInputSchema, KnowledgeEntrySchema),
      archive: (input) => invokeApi(transport, 'knowledge.archive', input, ArchiveKnowledgeEntryInputSchema, KnowledgeEntrySchema),
      restore: (input) => invokeApi(transport, 'knowledge.restore', input, RestoreKnowledgeEntryInputSchema, KnowledgeEntrySchema),
      delete: (input) => invokeApi(transport, 'knowledge.delete', input, DeleteKnowledgeEntryInputSchema, SuccessResultSchema),
      listSuggestions: (input) => invokeApi(transport, 'knowledge.listSuggestions', input, ListSuggestionsInputSchema, z.array(AiFactSuggestionSchema)),
      getSuggestion: (input) => invokeApi(transport, 'knowledge.getSuggestion', input, GetSuggestionInputSchema, AiFactSuggestionSchema),
      reviewSuggestion: (input) => invokeApi(transport, 'knowledge.reviewSuggestion', input, ReviewSuggestionInputSchema, AiFactSuggestionSchema),
      previewSuggestionAcceptance: (input) => invokeApi(transport, 'knowledge.previewSuggestionAcceptance', input, PreviewSuggestionAcceptanceInputSchema, SuggestionAcceptancePreviewSchema),
      acceptSuggestion: (input) => invokeApi(transport, 'knowledge.acceptSuggestion', input, AcceptSuggestionInputSchema, KnowledgeEntrySchema)
    },
    relationship: {
      list: (input) => invokeApi(transport, 'relationship.list', input, ListCharacterRelationshipsInputSchema, z.array(CharacterRelationshipSchema)),
      get: (input) => invokeApi(transport, 'relationship.get', input, GetCharacterRelationshipInputSchema, CharacterRelationshipSchema),
      create: (input) => invokeApi(transport, 'relationship.create', input, CreateCharacterRelationshipInputSchema, CharacterRelationshipSchema),
      update: (input) => invokeApi(transport, 'relationship.update', input, UpdateCharacterRelationshipInputSchema, CharacterRelationshipSchema),
      delete: (input) => invokeApi(transport, 'relationship.delete', input, DeleteCharacterRelationshipInputSchema, SuccessResultSchema)
    },
    connection: {
      list: (input = {}) => invokeApi(transport, 'connection.list', input, ListModelConnectionsInputSchema, z.array(ModelConnectionSummarySchema)),
      get: (input) => invokeApi(transport, 'connection.get', input, GetModelConnectionInputSchema, ModelConnectionSummarySchema),
      create: (input) => invokeApi(transport, 'connection.create', input, CreateModelConnectionInputSchema, ModelConnectionSummarySchema),
      update: (input) => invokeApi(transport, 'connection.update', input, UpdateModelConnectionInputSchema, ModelConnectionSummarySchema),
      delete: (input) => invokeApi(transport, 'connection.delete', input, DeleteModelConnectionInputSchema, SuccessResultSchema),
      test: (input) => invokeApi(transport, 'connection.test', input, TestModelConnectionInputSchema, ConnectionTestResultSchema),
      listModels: (input) => invokeApi(transport, 'connection.listModels', input, ListRemoteModelsInputSchema, ListRemoteModelsResultSchema),
      confirmContentTarget: (input) => invokeApi(transport, 'connection.confirmContentTarget', input, ConfirmContentTargetInputSchema, ConfirmContentTargetResultSchema),
      setTaskRoute: (input) => invokeApi(transport, 'connection.setTaskRoute', input, SetTaskRouteInputSchema, TaskRouteSummarySchema.nullable())
    },
    diagnostics: {
      getLogState: () => invokeApi(transport, 'diagnostics.getLogState', undefined, z.undefined(), LogStateResultSchema),
      setDetailedLogging: (input) => invokeApi(transport, 'diagnostics.setDetailedLogging', input, SetDetailedLoggingInputSchema, LogStateResultSchema),
      clearDetailedLogs: () => invokeApi(transport, 'diagnostics.clearDetailedLogs', undefined, z.undefined(), SuccessResultSchema)
    },
    analysis: {
      start: (input) => invokeApi(transport, 'analysis.start', input, StartAnalysisInputSchema, StartAnalysisResultSchema),
      cancel: (input) => invokeApi(transport, 'analysis.cancel', input, CancelTaskInputSchema, SuccessResultSchema),
      pause: (input) => invokeApi(transport, 'analysis.pause', input, CancelTaskInputSchema, SuccessResultSchema),
      resume: (input) => invokeApi(transport, 'analysis.resume', input, ResumeTaskInputSchema, StartAnalysisResultSchema),
      getProgress: (input) => invokeApi(transport, 'analysis.getProgress', input, GetTaskProgressInputSchema, TaskProgressEventSchema)
    },
    task: {
      list: (input) => invokeApi(transport, 'task.list', input, ListTasksInputSchema, z.array(TaskSummarySchema)),
      get: (input) => invokeApi(transport, 'task.get', input, GetTaskInputSchema, TaskDetailSchema),
      retry: (input) => invokeApi(transport, 'task.retry', input, RetryTaskInputSchema, TaskSummarySchema),
      retryStep: (input) => invokeApi(transport, 'task.retryStep', input, RetryStepInputSchema, TaskSummarySchema),
      skipStep: (input) => invokeApi(transport, 'task.skipStep', input, SkipStepInputSchema, TaskSummarySchema),
      onProgress: (callback: (event: TaskProgressEvent) => void) =>
        subscribeEvent(transport, 'task:progress', callback, TaskProgressEventSchema)
    },
    consistencyIssue: {
      list: (input) => invokeApi(transport, 'consistencyIssue.list', input, ListConsistencyIssuesInputSchema, z.array(ConsistencyIssueSchema)),
      review: (input) => invokeApi(transport, 'consistencyIssue.review', input, ReviewConsistencyIssueInputSchema, ConsistencyIssueSchema)
    },
    report: {
      create: (input) => invokeApi(transport, 'report.create', input, CreateReportInputSchema, z.object({ reportId: z.string().uuid() })),
      list: (input) => invokeApi(transport, 'report.list', input, ListReportsInputSchema, z.array(LiteraryReportSummarySchema)),
      get: (input) => invokeApi(transport, 'report.get', input, GetReportInputSchema, LiteraryReportDetailSchema),
      addAnnotation: (input) => invokeApi(transport, 'report.addAnnotation', input, AddReportAnnotationInputSchema, ReportAnnotationSchema),
      updateAnnotation: (input) => invokeApi(transport, 'report.updateAnnotation', input, UpdateReportAnnotationInputSchema, ReportAnnotationSchema),
      deleteAnnotation: (input) => invokeApi(transport, 'report.deleteAnnotation', input, DeleteReportAnnotationInputSchema, SuccessResultSchema)
    },
    synopsis: {
      get: (input) => invokeApi(transport, 'synopsis.get', input, GetSynopsisInputSchema, BookSynopsisSchema.nullable())
    },
    chapterSummary: {
      get: (input) => invokeApi(transport, 'chapterSummary.get', input, GetChapterSummaryInputSchema, ChapterSummarySchema.nullable()),
      list: (input) => invokeApi(transport, 'chapterSummary.list', input, ListChapterSummariesInputSchema, z.array(ChapterSummarySchema))
    },
    context: {
      preview: (input) => invokeApi(transport, 'context.preview', input, ContextPreviewInputSchema, ContextPackageSchema),
      get: (input) => invokeApi(transport, 'context.get', input, GetContextPackageInputSchema, ContextPackageSchema)
    },
    creation: {
      start: (input) => invokeApi(transport, 'creation.start', input, StartCreationInputSchema, StartCreationResultSchema),
      regenerate: (input) => invokeApi(transport, 'creation.regenerate', input, RegenerateCreationInputSchema, StartCreationResultSchema),
      cancel: (input) => invokeApi(transport, 'creation.cancel', input, CancelCreationInputSchema, SuccessResultSchema)
    },
    candidate: {
      list: (input) => invokeApi(transport, 'candidate.list', input, ListCandidatesInputSchema, z.array(CandidateSummarySchema)),
      get: (input) => invokeApi(transport, 'candidate.get', input, GetCandidateInputSchema, CandidateDetailSchema),
      updateText: (input) => invokeApi(transport, 'candidate.updateText', input, UpdateCandidateTextInputSchema, CandidateDetailSchema),
      stageHunk: (input) => invokeApi(transport, 'candidate.stageHunk', input, StageCandidateHunkInputSchema, CandidateDetailSchema),
      retain: (input) => invokeApi(transport, 'candidate.retain', input, RetainCandidateInputSchema, CandidateDetailSchema),
      apply: (input) => invokeApi(transport, 'candidate.apply', input, ApplyCandidateInputSchema, CandidateApplyResultSchema),
      reject: (input) => invokeApi(transport, 'candidate.reject', input, RejectCandidateInputSchema, CandidateDetailSchema),
      onDelta: (callback: (event: CandidateDeltaEvent) => void) =>
        subscribeEvent(transport, 'candidate:delta', callback, CandidateDeltaEventSchema),
      onDone: (callback: (event: CandidateDoneEvent) => void) =>
        subscribeEvent(transport, 'candidate:done', callback, CandidateDoneEventSchema)
    },
    chat: {
      create: (input) => invokeApi(transport, 'chat.create', input, CreateChatSessionInputSchema, ChatSessionSchema),
      list: (input) => invokeApi(transport, 'chat.list', input, ListChatSessionsInputSchema, z.array(ChatSessionSchema)),
      getSession: (input) => invokeApi(transport, 'chat.getSession', input, GetChatSessionInputSchema, ChatSessionSchema),
      updateStage: (input) => invokeApi(transport, 'chat.updateStage', input, UpdateChatWorkflowStageInputSchema, ChatSessionSchema),
      delete: (input) => invokeApi(transport, 'chat.delete', input, DeleteChatSessionInputSchema, SuccessResultSchema),
      send: (input) => invokeApi(transport, 'chat.send', input, SendChatMessageInputSchema, z.object({ messageId: z.string().uuid(), userMessageId: z.string().uuid(), contextPackageId: z.string().uuid() })),
      cancel: (input) => invokeApi(transport, 'chat.cancel', input, CancelChatInputSchema, SuccessResultSchema),
      compact: (input) => invokeApi(transport, 'chat.compact', input, CompactChatSessionInputSchema, ChatSummarySchema),
      listMessages: (input) => invokeApi(transport, 'chat.listMessages', input, ListChatMessagesInputSchema, z.array(ChatMessageSchema)),
      getSummary: (input) => invokeApi(transport, 'chat.getSummary', input, GetChatSummaryInputSchema, ChatSummarySchema.nullable()),
      updateSummary: (input) => invokeApi(transport, 'chat.updateSummary', input, UpdateChatSummaryInputSchema, ChatSummarySchema),
      onDelta: (callback: (event: ChatDeltaEvent) => void) =>
        subscribeEvent(transport, 'chat:delta', callback, ChatDeltaEventSchema),
      onDone: (callback: (event: ChatDoneEvent) => void) =>
        subscribeEvent(transport, 'chat:done', callback, ChatDoneEventSchema)
    },
    outline: {
      getBookOutline: (input) => invokeApi(transport, 'outline.getBook', input, GetBookOutlineInputSchema, BookOutlineSchema.nullable()),
      saveBookOutline: (input) => invokeApi(transport, 'outline.saveBook', input, SaveBookOutlineInputSchema, BookOutlineSchema),
      confirmBookOutline: (input) => invokeApi(transport, 'outline.confirmBook', input, ConfirmBookOutlineInputSchema, BookOutlineSchema),
      generateBookOutlineDraft: (input) => invokeApi(transport, 'outline.generateBookDraft', input, GenerateBookOutlineDraftInputSchema, BookOutlineSchema),
      listVolumeOutlines: (input) => invokeApi(transport, 'outline.listVolumes', input, ListVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema)),
      getVolumeOutline: (input) => invokeApi(transport, 'outline.getVolume', input, GetVolumeOutlineInputSchema, VolumeOutlineSchema),
      createVolumeOutline: (input) => invokeApi(transport, 'outline.createVolume', input, CreateVolumeOutlineInputSchema, VolumeOutlineSchema),
      updateVolumeOutline: (input) => invokeApi(transport, 'outline.updateVolume', input, UpdateVolumeOutlineInputSchema, VolumeOutlineSchema),
      deleteVolumeOutline: (input) => invokeApi(transport, 'outline.deleteVolume', input, DeleteVolumeOutlineInputSchema, SuccessResultSchema),
      reorderVolumeOutlines: (input) => invokeApi(transport, 'outline.reorderVolumes', input, ReorderVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema)),
      listChapterOutlines: (input) => invokeApi(transport, 'outline.listChapters', input, ListChapterOutlinesInputSchema, z.array(ChapterOutlineSchema)),
      getChapterOutline: (input) => invokeApi(transport, 'outline.getChapter', input, GetChapterOutlineInputSchema, ChapterOutlineSchema),
      getLatestChapterOutline: (input) => invokeApi(transport, 'outline.getLatestChapter', input, GetLatestChapterOutlineInputSchema, ChapterOutlineSchema.nullable()),
      saveChapterOutline: (input) => invokeApi(transport, 'outline.saveChapter', input, SaveChapterOutlineInputSchema, ChapterOutlineSchema),
      confirmChapterOutline: (input) => invokeApi(transport, 'outline.confirmChapter', input, ConfirmChapterOutlineInputSchema, ChapterOutlineSchema),
      deleteChapterOutline: (input) => invokeApi(transport, 'outline.deleteChapter', input, DeleteChapterOutlineInputSchema, SuccessResultSchema)
    },
    window: {
      minimize: () => invokeApi(transport, 'window.minimize', undefined, z.undefined(), z.boolean()),
      maximize: () => invokeApi(transport, 'window.toggleMaximize', undefined, z.undefined(), z.boolean()),
      close: () => invokeApi(transport, 'window.close', undefined, z.undefined(), z.boolean()),
      isMaximized: () => invokeApi(transport, 'window.isMaximized', undefined, z.undefined(), z.boolean()),
      onMaximizedChange: (callback: (isMaximized: boolean) => void) =>
        subscribeEvent(transport, 'window:maximized', (data) => callback(Boolean(data)), z.boolean())
    }
  }
}

/**
 * Ensures a valid platform bridge is attached to window.novelAgent.
 * Autodetects Electron preload vs WinUI 3 WebView2, or provides headless fallback.
 */
export function ensurePlatformBridge(customTransport?: IpcTransport): NovelAgentApi {
  if (customTransport) {
    const api = createNovelAgentApi(customTransport)
    if (typeof window !== 'undefined') {
      ;(window as unknown as { novelAgent: NovelAgentApi }).novelAgent = api
    }
    return api
  }

  if (typeof window !== 'undefined' && (window as unknown as { novelAgent?: NovelAgentApi }).novelAgent) {
    return (window as unknown as { novelAgent: NovelAgentApi }).novelAgent
  }

  let transport: IpcTransport
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { chrome?: { webview?: ChromeWebViewLike } }).chrome?.webview
  ) {
    transport = new WebView2Transport((window as unknown as { chrome: { webview: ChromeWebViewLike } }).chrome.webview)
  } else if (
    typeof window !== 'undefined' &&
    (window as unknown as { electron?: { ipcRenderer?: ElectronIpcRendererLike } }).electron?.ipcRenderer
  ) {
    transport = new ElectronPreloadTransport(
      (window as unknown as { electron: { ipcRenderer: ElectronIpcRendererLike } }).electron.ipcRenderer
    )
  } else {
    transport = new HeadlessFallbackTransport()
  }

  const api = createNovelAgentApi(transport)
  if (typeof window !== 'undefined') {
    ;(window as unknown as { novelAgent: NovelAgentApi }).novelAgent = api
  }
  return api
}
