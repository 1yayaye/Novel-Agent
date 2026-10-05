import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
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
  UpdateChatSummaryInputSchema
} from '../shared/project.js'
import { ProjectError, ProjectStore } from './project-store.js'
import { ChapterRepository } from './chapter-repository.js'
import { CreativeRepository } from './creative-repository.js'
import { KnowledgeRepository } from './knowledge-repository.js'
import { SearchIndex } from './search-index.js'
import { ContextAssembler } from './context-assembler.js'
import { CandidateService } from './candidate-service.js'
import { CreationRunner } from './creation-runner.js'
import { ChatService } from './chat-service.js'
import { parseImport } from './import-parser.js'
import { novelsDirectory } from './paths.js'
import { parseIpcInput, parseIpcOutput } from '../shared/ipc-parse.js'
import type { ConnectionStore } from './connection-store.js'
import type { ModelGateway } from './model-gateway.js'
import type { DiagnosticsService } from './diagnostics.js'
import type { AnalysisRunner } from './analysis-runner.js'

export interface WindowDelegate {
  minimize?: () => boolean | void
  toggleMaximize?: () => boolean
  close?: () => boolean | void
  isMaximized?: () => boolean
  showOpenDialog?: (options: {
    title?: string
    properties?: string[]
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<{ canceled?: boolean; filePaths: string[] }>
  showSaveDialog?: (options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<{ canceled?: boolean; filePath?: string }>
  openPath?: (path: string) => Promise<string | void>
}

export interface ServiceRouterDependencies {
  store: ProjectStore
  connectionStore?: ConnectionStore
  modelGateway?: ModelGateway
  diagnostics?: DiagnosticsService
  analysisRunner?: AnalysisRunner
  creationRunner?: CreationRunner
  candidateService?: CandidateService
  chatService?: ChatService
  searchIndexInstance?: SearchIndex
  windowDelegate?: WindowDelegate
}

export interface ServiceRouter {
  handle(channel: string, payload: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>
  onEvent(listener: (event: { channel: string; payload: unknown }) => void): () => void
  dispose(): Promise<void>
  has(channel: string): boolean
  getChannels(): string[]
  emitEvent(channel: string, payload: unknown): void
}

function failure(error: unknown) {
  if (error instanceof ProjectError) return { ok: false as const, error: { code: error.code, message: error.message } }
  if (error instanceof z.ZodError) return { ok: false as const, error: { code: 'VALIDATION_ERROR' as const, message: '请求数据无效' } }
  const err = error as { code?: string; message?: string }
  if (err && typeof err.code === 'string') {
    return { ok: false as const, error: { code: err.code, message: err.message || '操作失败' } }
  }
  return { ok: false as const, error: { code: 'DATABASE_ERROR' as const, message: '项目操作失败' } }
}

export function copySourceToNovels(sourcePath: string, dataDir: string): string {
  const resolvedSource = normalize(resolve(sourcePath))
  if (!existsSync(resolvedSource)) {
    throw new ProjectError('IMPORT_INVALID', '无法读取原文文件')
  }
  const targetDir = novelsDirectory(dataDir)
  const rel = relative(targetDir, resolvedSource)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return resolvedSource
  }

  const ext = extname(resolvedSource)
  const stem = basename(resolvedSource, ext)
  let candidateName = `${stem}${ext}`
  let targetPath = join(targetDir, candidateName)
  let counter = 1

  while (existsSync(targetPath)) {
    if (normalize(resolve(targetPath)) === resolvedSource) {
      return targetPath
    }
    candidateName = `${stem} (${counter})${ext}`
    targetPath = join(targetDir, candidateName)
    counter++
  }

  copyFileSync(resolvedSource, targetPath)
  return targetPath
}

function sanitizeFileName(name: string): string {
  const sanitized = name
    .replace(/[\\/]/g, '_')
    .replace(/:/g, '：')
    .replace(/\?/g, '？')
    .replace(/\*/g, '×')
    .replace(/"/g, "'")
    .replace(/</g, '《')
    .replace(/>/g, '》')
    .replace(/\|/g, '_')
    .replace(/[\x00-\x1F]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
  return sanitized || '未命名作品'
}

export function createServiceRouter(deps: ServiceRouterDependencies): ServiceRouter {
  const { store, connectionStore, modelGateway, diagnostics, analysisRunner, windowDelegate } = deps
  const searchIndex = deps.searchIndexInstance || new SearchIndex(store, modelGateway, connectionStore)
  const chapters = new ChapterRepository(store, searchIndex)
  const creatives = new CreativeRepository(store, searchIndex)
  const knowledges = new KnowledgeRepository(store, searchIndex)
  const contextAssembler = connectionStore ? new ContextAssembler(store, searchIndex, connectionStore, modelGateway) : undefined
  const candidateSvc = deps.candidateService || new CandidateService(store, searchIndex)
  const creationRun = deps.creationRunner || (connectionStore && modelGateway && contextAssembler ? new CreationRunner(store, modelGateway, connectionStore, contextAssembler, candidateSvc) : undefined)
  const chatSvc = deps.chatService || (connectionStore && modelGateway && contextAssembler ? new ChatService(store, modelGateway, connectionStore, contextAssembler, searchIndex) : undefined)

  const eventListeners = new Set<(event: { channel: string; payload: unknown }) => void>()
  const emit = (channel: string, payload: unknown) => {
    for (const listener of eventListeners) {
      try {
        listener({ channel, payload })
      } catch (err) {
        console.error(`[ServiceRouter] Error in event listener for ${channel}:`, err)
      }
    }
  }

  if (creationRun) {
    creationRun.setCallbacks({
      onDelta: (event) => emit('candidate:delta', event),
      onDone: (event) => emit('candidate:done', event),
      onProgress: (event) => emit('task:progress', event)
    })
  }
  if (chatSvc) {
    chatSvc.setCallbacks({
      onDelta: (event) => emit('chat:delta', event),
      onDone: (event) => emit('chat:done', event)
    })
  }
  analysisRunner?.setCallbacks({ onProgress: (event) => emit('task:progress', event) })

  type HandlerFn = (payload: unknown) => Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>
  const methods = new Map<string, HandlerFn>()

  const register = <I, O>(
    channel: string,
    inputSchema: z.ZodType<I>,
    outputSchema: z.ZodType<O>,
    action: (value: I) => O | Promise<O>
  ) => {
    methods.set(channel, async (rawInput: unknown) => {
      try {
        const input = parseIpcInput(inputSchema, rawInput)
        const output = await action(input)
        return { ok: true, value: parseIpcOutput(outputSchema, output) }
      } catch (error) {
        return failure(error)
      }
    })
  }

  // System namespace
  register('system.ping', z.any().optional(), z.object({ status: z.string(), version: z.string() }).passthrough(), () => {
    return { status: 'healthy', version: '0.1.0' }
  })
  register('system.shutdown', z.any().optional(), z.object({ success: z.boolean() }), async () => {
    return { success: true }
  })

  // Project namespace
  register('project.create', CreateProjectInputSchema, ProjectSummarySchema, (input) => store.create(input))
  register('project.open', OpenProjectInputSchema, OpenProjectResultSchema, async (input) => {
    const result = await store.open(input.path)
    if (result.mode === 'read_write') void searchIndex.sync(result.sessionId).catch(() => {})
    return result
  })
  register('project.close', CloseProjectInputSchema, SuccessResultSchema, (input) => store.close(input.sessionId))
  register('project.saveCopy', SaveCopyInputSchema, SaveCopyResultSchema, (input) => store.saveCopy(input.sessionId, input.destination))
  register('project.listRecent', z.undefined(), ListRecentProjectsResultSchema, () => store.listRecent())
  register('project.chooseAndOpen', z.undefined(), OpenProjectResultSchema.nullable(), async () => {
    if (!windowDelegate?.showOpenDialog) return null
    const dialogRes = await windowDelegate.showOpenDialog({
      title: '打开现有作品项目',
      properties: ['openFile'],
      filters: [{ name: 'Novel Agent 作品项目 (*.novelproj)', extensions: ['novelproj'] }]
    })
    const selectedPath = dialogRes.filePaths[0]
    if (!selectedPath) return null
    const result = await store.open(selectedPath)
    if (result.mode === 'read_write') void searchIndex.sync(result.sessionId).catch(() => {})
    return result
  })
  register('project.previewImport', ImportPreviewInputSchema, ImportPreviewResultSchema, async (input) => {
    let source = input.source
    if (!source && windowDelegate?.showOpenDialog) {
      const dialogRes = await windowDelegate.showOpenDialog({
        title: '选择原文',
        properties: ['openFile'],
        filters: [{ name: '原文', extensions: ['txt', 'md', 'markdown'] }]
      })
      source = dialogRes.filePaths[0]
    }
    if (!source) return null
    const finalSource = copySourceToNovels(source, store.dataDirectory)
    return parseImport(finalSource, input.encoding)
  })
  register('project.import', ImportProjectInputSchema, ImportProjectResultSchema, async (input) => {
    let destination = input.destination
    if (!destination) {
      const safeTitle = sanitizeFileName(input.title)
      const projectsDir = join(store.dataDirectory, 'projects')
      mkdirSync(projectsDir, { recursive: true })
      let targetPath = join(projectsDir, `${safeTitle}.novelproj`)
      let counter = 1
      while (existsSync(targetPath)) {
        targetPath = join(projectsDir, `${safeTitle} (${counter}).novelproj`)
        counter++
      }
      destination = targetPath
    }
    const projectPath = destination.toLowerCase().endsWith('.novelproj') ? destination : `${destination}.novelproj`
    const finalSource = copySourceToNovels(input.source, store.dataDirectory)
    return store.create({ destination: projectPath, title: input.title, description: '', sourcePath: finalSource }, input.chapters)
  })
  register('project.export', ExportProjectInputSchema, ExportProjectResultSchema.nullable(), async (input) => {
    let destination = input.destination
    if (!destination && windowDelegate?.showSaveDialog) {
      const ext = input.format === 'txt' ? 'txt' : 'md'
      const filterName = input.format === 'txt' ? '文本文档 (*.txt)' : 'Markdown 文档 (*.md)'
      const dialogRes = await windowDelegate.showSaveDialog({
        title: '导出作品',
        filters: [{ name: filterName, extensions: [ext] }]
      })
      destination = dialogRes.filePath
    }
    if (!destination) return null
    if (input.includeAnalysis) store.assertAnalysisExport(input.sessionId)
    return store.exportProject(input.sessionId, input.format, input.chapterIds, destination, input.includeAnalysis)
  })

  // Chapter namespace
  register('chapter.list', ListChaptersInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.list(input.sessionId))
  register('chapter.get', GetChapterInputSchema, ChapterSchema, (input) => chapters.get(input.sessionId, input.chapterId))
  register('chapter.update', UpdateChapterInputSchema, ChapterSchema, (input) => chapters.update(input.sessionId, input.chapterId, input.content, input.expectedVersion))
  register('chapter.create', CreateChapterInputSchema, ChapterSchema, (input) => chapters.create(input.sessionId, input.title, input.content))
  register('chapter.rename', RenameChapterInputSchema, ChapterSchema, (input) => chapters.rename(input.sessionId, input.chapterId, input.title, input.expectedVersion))
  register('chapter.delete', DeleteChapterInputSchema, SuccessResultSchema, (input) => chapters.delete(input.sessionId, input.chapterId, input.expectedVersion))
  register('chapter.reorder', ReorderChaptersInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.reorder(input.sessionId, input.chapters))
  register('chapter.split', SplitChapterInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.split(input.sessionId, input.chapterId, input.offset, input.newTitle, input.expectedVersion))
  register('chapter.merge', MergeChapterInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.merge(input.sessionId, input.chapterId, input.expectedVersion, input.nextExpectedVersion))
  register('chapter.listSnapshots', ListSnapshotsInputSchema, z.array(ChapterSnapshotSchema), (input) => chapters.listSnapshots(input.sessionId, input.chapterId))
  register('chapter.getSnapshot', GetSnapshotInputSchema, ChapterSnapshotDetailSchema, (input) => chapters.getSnapshot(input.sessionId, input.snapshotId))
  register('chapter.createSnapshot', CreateSnapshotInputSchema, ChapterSnapshotSchema, (input) => chapters.createSnapshot(input.sessionId, input.chapterId, input.expectedVersion, input.name))
  register('chapter.createOrdinarySnapshot', CreateOrdinarySnapshotInputSchema, ChapterSnapshotSchema.nullable(), (input) => chapters.createOrdinarySnapshot(input.sessionId, input.chapterId, input.expectedVersion))
  register('chapter.restoreSnapshot', RestoreSnapshotInputSchema, ChapterSchema, (input) => chapters.restoreSnapshot(input.sessionId, input.snapshotId, input.expectedVersion))

  // Search namespace
  register('search.keyword', KeywordSearchInputSchema, KeywordSearchResultSchema, (input) => searchIndex.searchKeyword(input.sessionId, input))
  register('search.hybrid', HybridSearchInputSchema, KeywordSearchResultSchema, async (input) => searchIndex.searchHybrid(input.sessionId, input))

  // Index namespace
  register('index.getStatus', GetIndexStatusInputSchema, IndexStatusResultSchema, (input) => searchIndex.getStatus(input.sessionId))
  register('index.rebuild', RebuildIndexInputSchema, RebuildIndexResultSchema, (input) => searchIndex.rebuild(input.sessionId, input.includeVector ?? true))

  // Backup namespace
  register('backup.list', ListBackupsInputSchema, z.array(BackupInfoSchema), (input) => store.listBackups(input.sessionId))
  register('backup.create', CreateBackupInputSchema, BackupInfoSchema, (input) => store.createBackup(input.sessionId, 'manual'))
  register('backup.restore', RestoreBackupInputSchema, OpenProjectResultSchema, (input) => store.restoreBackup(input.sessionId, input.backupPath))
  register('backup.openLocation', OpenBackupLocationInputSchema, SuccessResultSchema, async (input) => {
    const folder = store.openBackupLocation(input.sessionId)
    if (windowDelegate?.openPath) {
      await windowDelegate.openPath(folder)
    }
    return { success: true }
  })

  // Creative Rule namespace
  register('creativeRule.get', GetCreativeRuleInputSchema, CreativeRuleSchema, (input) => creatives.getRules(input.sessionId))
  register('creativeRule.update', UpdateCreativeRuleInputSchema, CreativeRuleSchema, (input) => creatives.updateRules(input.sessionId, input.content, input.expectedVersion))

  // Style Sample namespace
  register('styleSample.list', ListStyleSamplesInputSchema, z.array(StyleSampleSchema), (input) => creatives.listSamples(input.sessionId))
  register('styleSample.get', GetStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.getSample(input.sessionId, input.sampleId))
  register('styleSample.create', CreateStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.createSample(input.sessionId, input.name, input.content, input.tags))
  register('styleSample.update', UpdateStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.updateSample(input.sessionId, input.sampleId, input.name, input.content, input.tags, input.expectedVersion))
  register('styleSample.delete', DeleteStyleSampleInputSchema, SuccessResultSchema, (input) => creatives.deleteSample(input.sessionId, input.sampleId, input.expectedVersion))

  // Preset namespace
  register('preset.list', ListInstructionPresetsInputSchema, z.array(InstructionPresetSchema), (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    return creatives.listPresets(input.sessionId, input.taskType)
  })
  register('preset.get', GetInstructionPresetInputSchema, InstructionPresetSchema, (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    return creatives.getPreset(input.sessionId, input.presetId)
  })
  register('preset.create', CreateInstructionPresetInputSchema, InstructionPresetSchema, (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    return creatives.createPreset(input.sessionId, input.taskType, input.name, input.instruction)
  })
  register('preset.update', UpdateInstructionPresetInputSchema, InstructionPresetSchema, (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    return creatives.updatePreset(input.sessionId, input.presetId, input.name, input.instruction, input.expectedVersion)
  })
  register('preset.delete', DeleteInstructionPresetInputSchema, SuccessResultSchema, (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    return creatives.deletePreset(input.sessionId, input.presetId, input.expectedVersion)
  })

  // Knowledge namespace
  register('knowledge.list', ListKnowledgeEntriesInputSchema, z.array(KnowledgeEntrySchema), (input) => knowledges.listEntries(input.sessionId, input))
  register('knowledge.get', GetKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.getEntry(input.sessionId, input.entryId))
  register('knowledge.create', CreateKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.createEntry(input.sessionId, input))
  register('knowledge.update', UpdateKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.updateEntry(input.sessionId, input.entryId, input, input.expectedVersion))
  register('knowledge.archive', ArchiveKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.archiveEntry(input.sessionId, input.entryId, input.expectedVersion))
  register('knowledge.restore', RestoreKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.restoreEntry(input.sessionId, input.entryId, input.expectedVersion))
  register('knowledge.delete', DeleteKnowledgeEntryInputSchema, SuccessResultSchema, (input) => knowledges.deleteEntry(input.sessionId, input.entryId, input.expectedVersion))
  register('knowledge.listSuggestions', ListSuggestionsInputSchema, z.array(AiFactSuggestionSchema), (input) => knowledges.listSuggestions(input.sessionId, input))
  register('knowledge.getSuggestion', GetSuggestionInputSchema, AiFactSuggestionSchema, (input) => knowledges.getSuggestion(input.sessionId, input.suggestionId))
  register('knowledge.reviewSuggestion', ReviewSuggestionInputSchema, AiFactSuggestionSchema, (input) => knowledges.reviewSuggestion(input.sessionId, input.suggestionId, input.state, input.expectedVersion))
  register('knowledge.previewSuggestionAcceptance', PreviewSuggestionAcceptanceInputSchema, SuggestionAcceptancePreviewSchema, (input) => knowledges.previewSuggestionAcceptance(input.sessionId, input.suggestionId, input.targetEntryId))
  register('knowledge.acceptSuggestion', AcceptSuggestionInputSchema, KnowledgeEntrySchema, (input) => knowledges.acceptSuggestion(input.sessionId, input))

  // Relationship namespace
  register('relationship.list', ListCharacterRelationshipsInputSchema, z.array(CharacterRelationshipSchema), (input) => knowledges.listRelationships(input.sessionId, input.characterId, input.includeArchived))
  register('relationship.get', GetCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.getRelationship(input.sessionId, input.relationshipId))
  register('relationship.create', CreateCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.createRelationship(input.sessionId, input.fromCharacterId, input.toCharacterId, input.relationType, input.description))
  register('relationship.update', UpdateCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.updateRelationship(input.sessionId, input.relationshipId, input.relationType, input.description, input.expectedVersion))
  register('relationship.delete', DeleteCharacterRelationshipInputSchema, SuccessResultSchema, (input) => knowledges.deleteRelationship(input.sessionId, input.relationshipId, input.expectedVersion))

  // Connection namespace
  register('connection.list', ListModelConnectionsInputSchema, z.array(ModelConnectionSummarySchema), (input) => connectionStore?.list(input?.kind) ?? [])
  register('connection.get', GetModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('CONNECTION_NOT_FOUND', '连接仓储未初始化')
    return connectionStore.get(input.connectionId)
  })
  register('connection.create', CreateModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.create(input)
  })
  register('connection.update', UpdateModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.update(input)
  })
  register('connection.delete', DeleteModelConnectionInputSchema, SuccessResultSchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.delete(input.connectionId, input.expectedVersion)
  })
  register('connection.test', TestModelConnectionInputSchema, ConnectionTestResultSchema, async (input) => {
    if (!modelGateway) throw new ProjectError('DATABASE_ERROR', '模型网关未初始化')
    return modelGateway.testConnection(input)
  })
  register('connection.listModels', ListRemoteModelsInputSchema, ListRemoteModelsResultSchema, async (input) => {
    if (!modelGateway) throw new ProjectError('DATABASE_ERROR', '模型网关未初始化')
    return modelGateway.listModels(input)
  })
  register('connection.confirmContentTarget', ConfirmContentTargetInputSchema, ConfirmContentTargetResultSchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.confirmContentTarget(input.connectionId, input.displayedFingerprint)
  })
  register('connection.setTaskRoute', SetTaskRouteInputSchema, TaskRouteSummarySchema.nullable(), (input) => {
    store.assertTaskControls(input.sessionId)
    return store.setTaskRoute(input.sessionId, input.taskType, input.connectionId, input.expectedVersion)
  })

  // Diagnostics namespace
  register('diagnostics.getLogState', z.undefined(), LogStateResultSchema, () => {
    if (!diagnostics) return { detailedLoggingEnabled: false, logDirectory: '' }
    return diagnostics.getLogState()
  })
  register('diagnostics.setDetailedLogging', SetDetailedLoggingInputSchema, LogStateResultSchema, (input) => {
    if (!diagnostics) return { detailedLoggingEnabled: false, logDirectory: '' }
    return diagnostics.setDetailedLogging(input.enabled)
  })
  register('diagnostics.clearDetailedLogs', z.undefined(), SuccessResultSchema, () => {
    if (!diagnostics) return { success: true }
    return diagnostics.clearDetailedLogs()
  })

  // Analysis namespace
  register('analysis.start', StartAnalysisInputSchema, StartAnalysisResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    store.assertAnalysisPipelines(input.sessionId)
    return analysisRunner.startAnalysis(input)
  })
  register('analysis.cancel', CancelTaskInputSchema, SuccessResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    store.assertTaskControls(input.sessionId)
    return analysisRunner.cancelTask(input)
  })
  register('analysis.pause', CancelTaskInputSchema, SuccessResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.pauseTask(input)
  })
  register('analysis.resume', ResumeTaskInputSchema, StartAnalysisResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.resumeTask(input)
  })
  register('analysis.getProgress', GetTaskProgressInputSchema, TaskProgressEventSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.getProgress(input)
  })

  // Task namespace
  register('task.list', ListTasksInputSchema, z.array(TaskSummarySchema), (input) => {
    return store.listTasks(input.sessionId, input.type, input.state)
  })
  register('task.get', GetTaskInputSchema, TaskDetailSchema, (input) => {
    return store.getTask(input.sessionId, input.taskId)
  })
  register('task.retryStep', RetryStepInputSchema, TaskSummarySchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.retryStep(input)
  })
  register('task.retry', RetryTaskInputSchema, TaskSummarySchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.retryTask(input)
  })
  register('task.skipStep', SkipStepInputSchema, TaskSummarySchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.skipStep(input)
  })

  // Consistency Issue namespace
  register('consistencyIssue.list', ListConsistencyIssuesInputSchema, z.array(ConsistencyIssueSchema), (input) => {
    return store.listConsistencyIssues(input.sessionId, input)
  })
  register('consistencyIssue.review', ReviewConsistencyIssueInputSchema, ConsistencyIssueSchema, (input) => {
    return store.reviewConsistencyIssue(input.sessionId, input.issueId, input.state, input.expectedVersion)
  })

  // Report namespace
  register('report.create', CreateReportInputSchema, z.object({ reportId: z.string().uuid() }), (input) => {
    store.assertAnalysisPipelines(input.sessionId)
    const reportId = store.createLiteraryReport(
      input.sessionId,
      JSON.stringify(input.scope),
      JSON.stringify(input.chapterVersions),
      input.connectionId || null,
      input.taskId || null,
      input.sections
    )
    return { reportId }
  })
  register('report.list', ListReportsInputSchema, z.array(LiteraryReportSummarySchema), (input) => {
    return store.listLiteraryReports(input.sessionId)
  })
  register('report.get', GetReportInputSchema, LiteraryReportDetailSchema, (input) => {
    return store.getLiteraryReport(input.sessionId, input.reportId)
  })
  register('report.addAnnotation', AddReportAnnotationInputSchema, ReportAnnotationSchema, (input) => {
    return store.addReportAnnotation(input.sessionId, input.reportSectionId, input.content)
  })
  register('report.updateAnnotation', UpdateReportAnnotationInputSchema, ReportAnnotationSchema, (input) => {
    return store.updateReportAnnotation(input.sessionId, input.annotationId, input.content)
  })
  register('report.deleteAnnotation', DeleteReportAnnotationInputSchema, SuccessResultSchema, (input) => {
    return store.deleteReportAnnotation(input.sessionId, input.annotationId)
  })

  // Synopsis namespace
  register('synopsis.get', GetSynopsisInputSchema, BookSynopsisSchema.nullable(), (input) => {
    return store.getSynopsis(input.sessionId)
  })

  // Chapter Summary namespace
  register('chapterSummary.get', GetChapterSummaryInputSchema, ChapterSummarySchema.nullable(), (input) => {
    return store.getChapterSummary(input.sessionId, input.chapterId)
  })
  register('chapterSummary.list', ListChapterSummariesInputSchema, z.array(ChapterSummarySchema), (input) => {
    return store.listChapterSummaries(input.sessionId)
  })

  // Context namespace
  register('context.preview', ContextPreviewInputSchema, ContextPackageSchema, (input) => {
    if (!contextAssembler) throw new ProjectError('VALIDATION_ERROR', '上下文装配器未初始化')
    return contextAssembler.assembleContext(input)
  })
  register('context.get', GetContextPackageInputSchema, ContextPackageSchema, (input) => {
    if (!contextAssembler) throw new ProjectError('VALIDATION_ERROR', '上下文装配器未初始化')
    return contextAssembler.getContextPackage(input)
  })

  // Creation namespace
  register('creation.start', StartCreationInputSchema, StartCreationResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.startCreation(input.sessionId, input.contextPackageId)
  })
  register('creation.regenerate', RegenerateCreationInputSchema, StartCreationResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.regenerateCreation(input.sessionId, input.candidateId, input.contextPackageId)
  })
  register('creation.cancel', CancelCreationInputSchema, SuccessResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.cancelCreation(input.sessionId, input.taskId)
  })

  // Candidate namespace
  register('candidate.list', ListCandidatesInputSchema, z.array(CandidateSummarySchema), (input) => {
    return candidateSvc.listCandidates(input.sessionId, input)
  })
  register('candidate.get', GetCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.getCandidate(input.sessionId, input.candidateId)
  })
  register('candidate.updateText', UpdateCandidateTextInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.updateText(input.sessionId, input.candidateId, input.editedContent, input.expectedVersion)
  })
  register('candidate.stageHunk', StageCandidateHunkInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.stageHunk(input.sessionId, input.candidateId, input.hunkPosition, input.selected, input.expectedVersion)
  })
  register('candidate.retain', RetainCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.retain(input.sessionId, input.candidateId, input.expectedVersion)
  })
  register('candidate.apply', ApplyCandidateInputSchema, CandidateApplyResultSchema, (input) => {
    return candidateSvc.apply(input.sessionId, input)
  })
  register('candidate.reject', RejectCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.reject(input.sessionId, input.candidateId, input.expectedVersion)
  })

  // Chat namespace
  register('chat.create', CreateChatSessionInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.createSession(input)
  })
  register('chat.list', ListChatSessionsInputSchema, z.array(ChatSessionSchema), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.listSessions(input)
  })
  register('chat.getSession', GetChatSessionInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.getSession(input)
  })
  register('chat.updateStage', UpdateChatWorkflowStageInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.updateStage(input)
  })
  register('chat.delete', DeleteChatSessionInputSchema, SuccessResultSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.deleteSession(input)
  })
  register('chat.send', SendChatMessageInputSchema, z.object({ messageId: z.string().uuid(), userMessageId: z.string().uuid(), contextPackageId: z.string().uuid() }), async (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.sendMessage(input)
  })
  register('chat.cancel', CancelChatInputSchema, SuccessResultSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.cancelChat(input.sessionId, input.chatSessionId)
  })
  register('chat.compact', CompactChatSessionInputSchema, ChatSummarySchema, async (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.compactSession(input.sessionId, input.chatSessionId, input.connectionId)
  })
  register('chat.listMessages', ListChatMessagesInputSchema, z.array(ChatMessageSchema), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.listMessages(input)
  })
  register('chat.getSummary', GetChatSummaryInputSchema, ChatSummarySchema.nullable(), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.getSummary(input)
  })
  register('chat.updateSummary', UpdateChatSummaryInputSchema, ChatSummarySchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.updateSummary(input)
  })

  // Outline namespace
  register('outline.getBook', GetBookOutlineInputSchema, BookOutlineSchema.nullable(), (input) => {
    return store.getBookOutline(input.sessionId)
  })
  register('outline.saveBook', SaveBookOutlineInputSchema, BookOutlineSchema, (input) => {
    return store.saveBookOutline(input.sessionId, input)
  })
  register('outline.confirmBook', ConfirmBookOutlineInputSchema, BookOutlineSchema, (input) => {
    return store.confirmBookOutline(input.sessionId, input.expectedVersion)
  })
  register('outline.generateBookDraft', GenerateBookOutlineDraftInputSchema, BookOutlineSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('VALIDATION_ERROR', '分析运行器未初始化')
    return analysisRunner.generateBookOutlineDraft(input.sessionId, input.connectionId)
  })
  register('outline.listVolumes', ListVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema), (input) => {
    return store.listVolumeOutlines(input.sessionId)
  })
  register('outline.getVolume', GetVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.getVolumeOutline(input.sessionId, input.volumeId)
  })
  register('outline.createVolume', CreateVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.createVolumeOutline(input.sessionId, input)
  })
  register('outline.updateVolume', UpdateVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.updateVolumeOutline(input.sessionId, input.volumeId, input, input.expectedVersion)
  })
  register('outline.deleteVolume', DeleteVolumeOutlineInputSchema, SuccessResultSchema, (input) => {
    return store.deleteVolumeOutline(input.sessionId, input.volumeId, input.expectedVersion)
  })
  register('outline.reorderVolumes', ReorderVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema), (input) => {
    return store.reorderVolumeOutlines(input.sessionId, input.volumes)
  })
  register('outline.listChapters', ListChapterOutlinesInputSchema, z.array(ChapterOutlineSchema), (input) => {
    return store.listChapterOutlines(input.sessionId, input.chapterId)
  })
  register('outline.getChapter', GetChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.getChapterOutline(input.sessionId, input.outlineId)
  })
  register('outline.getLatestChapter', GetLatestChapterOutlineInputSchema, ChapterOutlineSchema.nullable(), (input) => {
    return store.getLatestChapterOutline(input.sessionId, input.chapterId)
  })
  register('outline.saveChapter', SaveChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.saveChapterOutline(input.sessionId, input)
  })
  register('outline.confirmChapter', ConfirmChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.confirmChapterOutline(input.sessionId, input.outlineId, input.expectedVersion)
  })
  register('outline.deleteChapter', DeleteChapterOutlineInputSchema, SuccessResultSchema, (input) => {
    return store.deleteChapterOutline(input.sessionId, input.outlineId, input.expectedVersion)
  })

  // Window namespace
  register('window.minimize', z.undefined(), z.boolean(), () => {
    if (windowDelegate?.minimize) {
      windowDelegate.minimize()
    }
    return true
  })
  register('window.toggleMaximize', z.undefined(), z.boolean(), () => {
    if (windowDelegate?.toggleMaximize) {
      return windowDelegate.toggleMaximize()
    }
    return false
  })
  register('window.close', z.undefined(), z.boolean(), () => {
    if (windowDelegate?.close) {
      windowDelegate.close()
    }
    return true
  })
  register('window.isMaximized', z.undefined(), z.boolean(), () => {
    return windowDelegate?.isMaximized ? windowDelegate.isMaximized() : false
  })

  return {
    async handle(channel: string, payload: unknown) {
      const handler = methods.get(channel)
      if (!handler) {
        return {
          ok: false,
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `Method not found: ${channel}`
          }
        }
      }
      return handler(payload)
    },
    onEvent(listener: (event: { channel: string; payload: unknown }) => void) {
      eventListeners.add(listener)
      return () => {
        eventListeners.delete(listener)
      }
    },
    async dispose() {
      eventListeners.clear()
      await store.closeAll()
    },
    has(channel: string) {
      return methods.has(channel)
    },
    getChannels() {
      return Array.from(methods.keys())
    },
    emitEvent(channel: string, payload: unknown) {
      emit(channel, payload)
    }
  }
}
