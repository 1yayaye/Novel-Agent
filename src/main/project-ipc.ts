import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, parse, relative, resolve } from 'node:path'
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
  ChatDoneEventSchema
} from '../shared/project'
import { ProjectError, ProjectStore } from './project-store'
import { ChapterRepository } from './chapter-repository'
import { CreativeRepository } from './creative-repository'
import { KnowledgeRepository } from './knowledge-repository'
import { SearchIndex } from './search-index'
import { ContextAssembler } from './context-assembler'
import { CandidateService } from './candidate-service'
import { CreationRunner } from './creation-runner'
import { ChatService } from './chat-service'
import { parseImport } from './import-parser'
import { novelsDirectory } from './paths'
import { parseIpcInput, parseIpcOutput } from '../shared/ipc-parse'
import type { ConnectionStore } from './connection-store'
import type { ModelGateway } from './model-gateway'
import type { DiagnosticsService } from './diagnostics'
import type { AnalysisRunner } from './analysis-runner'

function isTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): boolean {
  return event.sender === window.webContents && event.senderFrame === event.sender.mainFrame
}

function failure(error: unknown) {
  if (error instanceof ProjectError) return { ok: false as const, error: { code: error.code, message: error.message } }
  if (error instanceof z.ZodError) return { ok: false as const, error: { code: 'VALIDATION_ERROR' as const, message: '请求数据无效' } }
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

export function registerProjectIpc(
  window: BrowserWindow,
  store: ProjectStore,
  connectionStore?: ConnectionStore,
  modelGateway?: ModelGateway,
  diagnostics?: DiagnosticsService,
  analysisRunner?: AnalysisRunner,
  creationRunner?: CreationRunner,
  candidateService?: CandidateService,
  chatService?: ChatService,
  searchIndexInstance?: SearchIndex
): void {
  const searchIndex = searchIndexInstance || new SearchIndex(store, modelGateway, connectionStore)
  const chapters = new ChapterRepository(store, searchIndex)
  const creatives = new CreativeRepository(store, searchIndex)
  const knowledges = new KnowledgeRepository(store, searchIndex)
  const contextAssembler = connectionStore ? new ContextAssembler(store, searchIndex, connectionStore, modelGateway) : undefined
  const candidateSvc = candidateService || new CandidateService(store, searchIndex)
  const creationRun = creationRunner || (connectionStore && modelGateway && contextAssembler ? new CreationRunner(store, modelGateway, connectionStore, contextAssembler, candidateSvc) : undefined)
  const chatSvc = chatService || (connectionStore && modelGateway && contextAssembler ? new ChatService(store, modelGateway, connectionStore, contextAssembler, searchIndex) : undefined)

  analysisRunner?.setWindow(window)
  if (creationRun) {
    creationRun.setCallbacks({
      onDelta: (event) => {
        if (!window.isDestroyed()) window.webContents.send('candidate:delta', event)
      },
      onDone: (event) => {
        if (!window.isDestroyed()) window.webContents.send('candidate:done', event)
      },
      onProgress: (event) => {
        if (!window.isDestroyed()) window.webContents.send('task:progress', event)
      }
    })
  }
  if (chatSvc) {
    chatSvc.setCallbacks({
      onDelta: (event) => {
        if (!window.isDestroyed()) window.webContents.send('chat:delta', event)
      },
      onDone: (event) => {
        if (!window.isDestroyed()) window.webContents.send('chat:done', event)
      }
    })
  }

  const handle = <I, O>(channel: string, inputSchema: z.ZodType<I>, outputSchema: z.ZodType<O>, action: (value: I) => O | Promise<O>) => {
    ipcMain.handle(channel, async (event, value) => {
      if (!isTrustedSender(event, window)) return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: '不受信任的 IPC 调用来源' } }
      try {
        const input = parseIpcInput(inputSchema, value)
        const output = await action(input)
        return { ok: true, value: parseIpcOutput(outputSchema, output) }
      } catch (error) {
        return failure(error)
      }
    })
  }

  handle('project.create', CreateProjectInputSchema, ProjectSummarySchema, (input) => store.create(input))
  handle('project.open', OpenProjectInputSchema, OpenProjectResultSchema, async (input) => {
    const result = await store.open(input.path)
    void searchIndex.sync(result.sessionId).catch(() => {})
    return result
  })
  handle('project.close', CloseProjectInputSchema, SuccessResultSchema, (input) => store.close(input.sessionId))
  handle('project.saveCopy', SaveCopyInputSchema, SaveCopyResultSchema, (input) => store.saveCopy(input.sessionId, input.destination))
  handle('project.listRecent', z.undefined(), ListRecentProjectsResultSchema, () => store.listRecent())
  handle('project.chooseAndOpen', z.undefined(), OpenProjectResultSchema.nullable(), async () => {
    const dialogRes = await dialog.showOpenDialog(window, {
      title: '打开现有作品项目',
      properties: ['openFile'],
      filters: [{ name: 'Novel Agent 作品项目 (*.novelproj)', extensions: ['novelproj'] }]
    })
    const selectedPath = dialogRes.filePaths[0]
    if (!selectedPath) return null
    const result = await store.open(selectedPath)
    void searchIndex.sync(result.sessionId).catch(() => {})
    return result
  })
  handle('project.previewImport', ImportPreviewInputSchema, ImportPreviewResultSchema, async (input) => {
    let source = input.source
    if (!source) {
      const dialogRes = await dialog.showOpenDialog(window, {
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

  handle('project.import', ImportProjectInputSchema, ImportProjectResultSchema, async (input) => {
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
  handle('project.export', ExportProjectInputSchema, ExportProjectResultSchema.nullable(), async (input) => {
    let destination = input.destination
    if (!destination) {
      const ext = input.format === 'txt' ? 'txt' : 'md'
      const filterName = input.format === 'txt' ? '文本文档 (*.txt)' : 'Markdown 文档 (*.md)'
      const dialogRes = await dialog.showSaveDialog(window, {
        title: '导出作品',
        filters: [{ name: filterName, extensions: [ext] }]
      })
      destination = dialogRes.filePath
    }
    if (!destination) return null
    return store.exportProject(input.sessionId, input.format, input.chapterIds, destination)
  })

  handle('chapter.list', ListChaptersInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.list(input.sessionId))
  handle('chapter.get', GetChapterInputSchema, ChapterSchema, (input) => chapters.get(input.sessionId, input.chapterId))
  handle('chapter.update', UpdateChapterInputSchema, ChapterSchema, (input) => chapters.update(input.sessionId, input.chapterId, input.content, input.expectedVersion))
  handle('chapter.create', CreateChapterInputSchema, ChapterSchema, (input) => chapters.create(input.sessionId, input.title, input.content))
  handle('chapter.rename', RenameChapterInputSchema, ChapterSchema, (input) => chapters.rename(input.sessionId, input.chapterId, input.title, input.expectedVersion))
  handle('chapter.delete', DeleteChapterInputSchema, SuccessResultSchema, (input) => chapters.delete(input.sessionId, input.chapterId, input.expectedVersion))
  handle('chapter.reorder', ReorderChaptersInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.reorder(input.sessionId, input.chapters))
  handle('chapter.split', SplitChapterInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.split(input.sessionId, input.chapterId, input.offset, input.newTitle, input.expectedVersion))
  handle('chapter.merge', MergeChapterInputSchema, z.array(ChapterHeaderSchema), (input) => chapters.merge(input.sessionId, input.chapterId, input.expectedVersion, input.nextExpectedVersion))
  handle('chapter.listSnapshots', ListSnapshotsInputSchema, z.array(ChapterSnapshotSchema), (input) => chapters.listSnapshots(input.sessionId, input.chapterId))
  handle('chapter.getSnapshot', GetSnapshotInputSchema, ChapterSnapshotDetailSchema, (input) => chapters.getSnapshot(input.sessionId, input.snapshotId))
  handle('chapter.createSnapshot', CreateSnapshotInputSchema, ChapterSnapshotSchema, (input) => chapters.createSnapshot(input.sessionId, input.chapterId, input.expectedVersion, input.name))
  handle('chapter.createOrdinarySnapshot', CreateOrdinarySnapshotInputSchema, ChapterSnapshotSchema.nullable(), (input) => chapters.createOrdinarySnapshot(input.sessionId, input.chapterId, input.expectedVersion))
  handle('chapter.restoreSnapshot', RestoreSnapshotInputSchema, ChapterSchema, (input) => chapters.restoreSnapshot(input.sessionId, input.snapshotId, input.expectedVersion))

  handle('search.keyword', KeywordSearchInputSchema, KeywordSearchResultSchema, (input) => searchIndex.searchKeyword(input.sessionId, input))
  handle('search.hybrid', HybridSearchInputSchema, KeywordSearchResultSchema, async (input) => searchIndex.searchHybrid(input.sessionId, input))
  handle('index.getStatus', GetIndexStatusInputSchema, IndexStatusResultSchema, (input) => searchIndex.getStatus(input.sessionId))
  handle('index.rebuild', RebuildIndexInputSchema, RebuildIndexResultSchema, (input) => searchIndex.rebuild(input.sessionId, input.includeVector ?? true))

  handle('backup.list', ListBackupsInputSchema, z.array(BackupInfoSchema), (input) => store.listBackups(input.sessionId))
  handle('backup.create', CreateBackupInputSchema, BackupInfoSchema, (input) => store.createBackup(input.sessionId, 'manual'))
  handle('backup.restore', RestoreBackupInputSchema, OpenProjectResultSchema, (input) => store.restoreBackup(input.sessionId, input.backupPath))
  handle('backup.openLocation', OpenBackupLocationInputSchema, SuccessResultSchema, async (input) => {
    const folder = store.openBackupLocation(input.sessionId)
    await shell.openPath(folder)
    return { success: true }
  })

  // Phase 5: Creative Rule
  handle('creativeRule.get', GetCreativeRuleInputSchema, CreativeRuleSchema, (input) => creatives.getRules(input.sessionId))
  handle('creativeRule.update', UpdateCreativeRuleInputSchema, CreativeRuleSchema, (input) => creatives.updateRules(input.sessionId, input.content, input.expectedVersion))

  // Phase 5: Style Sample
  handle('styleSample.list', ListStyleSamplesInputSchema, z.array(StyleSampleSchema), (input) => creatives.listSamples(input.sessionId))
  handle('styleSample.get', GetStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.getSample(input.sessionId, input.sampleId))
  handle('styleSample.create', CreateStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.createSample(input.sessionId, input.name, input.content, input.tags))
  handle('styleSample.update', UpdateStyleSampleInputSchema, StyleSampleSchema, (input) => creatives.updateSample(input.sessionId, input.sampleId, input.name, input.content, input.tags, input.expectedVersion))
  handle('styleSample.delete', DeleteStyleSampleInputSchema, SuccessResultSchema, (input) => creatives.deleteSample(input.sessionId, input.sampleId, input.expectedVersion))

  // Phase 5: Instruction Preset
  handle('preset.list', ListInstructionPresetsInputSchema, z.array(InstructionPresetSchema), (input) => creatives.listPresets(input.sessionId, input.taskType))
  handle('preset.get', GetInstructionPresetInputSchema, InstructionPresetSchema, (input) => creatives.getPreset(input.sessionId, input.presetId))
  handle('preset.create', CreateInstructionPresetInputSchema, InstructionPresetSchema, (input) => creatives.createPreset(input.sessionId, input.taskType, input.name, input.instruction))
  handle('preset.update', UpdateInstructionPresetInputSchema, InstructionPresetSchema, (input) => creatives.updatePreset(input.sessionId, input.presetId, input.name, input.instruction, input.expectedVersion))
  handle('preset.delete', DeleteInstructionPresetInputSchema, SuccessResultSchema, (input) => creatives.deletePreset(input.sessionId, input.presetId, input.expectedVersion))

  handle('knowledge.list', ListKnowledgeEntriesInputSchema, z.array(KnowledgeEntrySchema), (input) => knowledges.listEntries(input.sessionId, input))
  handle('knowledge.get', GetKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.getEntry(input.sessionId, input.entryId))
  handle('knowledge.create', CreateKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.createEntry(input.sessionId, input))
  handle('knowledge.update', UpdateKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.updateEntry(input.sessionId, input.entryId, input, input.expectedVersion))
  handle('knowledge.archive', ArchiveKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.archiveEntry(input.sessionId, input.entryId, input.expectedVersion))
  handle('knowledge.restore', RestoreKnowledgeEntryInputSchema, KnowledgeEntrySchema, (input) => knowledges.restoreEntry(input.sessionId, input.entryId, input.expectedVersion))
  handle('knowledge.delete', DeleteKnowledgeEntryInputSchema, SuccessResultSchema, (input) => knowledges.deleteEntry(input.sessionId, input.entryId, input.expectedVersion))

  handle('knowledge.listSuggestions', ListSuggestionsInputSchema, z.array(AiFactSuggestionSchema), (input) => knowledges.listSuggestions(input.sessionId, input))
  handle('knowledge.getSuggestion', GetSuggestionInputSchema, AiFactSuggestionSchema, (input) => knowledges.getSuggestion(input.sessionId, input.suggestionId))
  handle('knowledge.reviewSuggestion', ReviewSuggestionInputSchema, AiFactSuggestionSchema, (input) => knowledges.reviewSuggestion(input.sessionId, input.suggestionId, input.state, input.expectedVersion))
  handle('knowledge.previewSuggestionAcceptance', PreviewSuggestionAcceptanceInputSchema, SuggestionAcceptancePreviewSchema, (input) => knowledges.previewSuggestionAcceptance(input.sessionId, input.suggestionId, input.targetEntryId))
  handle('knowledge.acceptSuggestion', AcceptSuggestionInputSchema, KnowledgeEntrySchema, (input) => knowledges.acceptSuggestion(input.sessionId, input))

  handle('relationship.list', ListCharacterRelationshipsInputSchema, z.array(CharacterRelationshipSchema), (input) => knowledges.listRelationships(input.sessionId, input.characterId, input.includeArchived))
  handle('relationship.get', GetCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.getRelationship(input.sessionId, input.relationshipId))
  handle('relationship.create', CreateCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.createRelationship(input.sessionId, input.fromCharacterId, input.toCharacterId, input.relationType, input.description))
  handle('relationship.update', UpdateCharacterRelationshipInputSchema, CharacterRelationshipSchema, (input) => knowledges.updateRelationship(input.sessionId, input.relationshipId, input.relationType, input.description, input.expectedVersion))
  handle('relationship.delete', DeleteCharacterRelationshipInputSchema, SuccessResultSchema, (input) => knowledges.deleteRelationship(input.sessionId, input.relationshipId, input.expectedVersion))

  handle('connection.list', ListModelConnectionsInputSchema, z.array(ModelConnectionSummarySchema), (input) => connectionStore?.list(input?.kind) ?? [])
  handle('connection.get', GetModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('CONNECTION_NOT_FOUND', '连接仓储未初始化')
    return connectionStore.get(input.connectionId)
  })
  handle('connection.create', CreateModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.create(input)
  })
  handle('connection.update', UpdateModelConnectionInputSchema, ModelConnectionSummarySchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.update(input)
  })
  handle('connection.delete', DeleteModelConnectionInputSchema, SuccessResultSchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.delete(input.connectionId, input.expectedVersion)
  })
  handle('connection.test', TestModelConnectionInputSchema, ConnectionTestResultSchema, async (input) => {
    if (!modelGateway) throw new ProjectError('DATABASE_ERROR', '模型网关未初始化')
    return modelGateway.testConnection(input)
  })
  handle('connection.listModels', ListRemoteModelsInputSchema, ListRemoteModelsResultSchema, async (input) => {
    if (!modelGateway) throw new ProjectError('DATABASE_ERROR', '模型网关未初始化')
    return modelGateway.listModels(input)
  })
  handle('connection.confirmContentTarget', ConfirmContentTargetInputSchema, ConfirmContentTargetResultSchema, (input) => {
    if (!connectionStore) throw new ProjectError('DATABASE_ERROR', '连接仓储未初始化')
    return connectionStore.confirmContentTarget(input.connectionId, input.displayedFingerprint)
  })
  handle('connection.setTaskRoute', SetTaskRouteInputSchema, TaskRouteSummarySchema.nullable(), (input) => {
    return store.setTaskRoute(input.sessionId, input.taskType, input.connectionId, input.expectedVersion)
  })

  handle('diagnostics.getLogState', z.undefined(), LogStateResultSchema, () => {
    if (!diagnostics) return { detailedLoggingEnabled: false, logDirectory: '' }
    return diagnostics.getLogState()
  })
  handle('diagnostics.setDetailedLogging', SetDetailedLoggingInputSchema, LogStateResultSchema, (input) => {
    if (!diagnostics) return { detailedLoggingEnabled: false, logDirectory: '' }
    return diagnostics.setDetailedLogging(input.enabled)
  })
  handle('diagnostics.clearDetailedLogs', z.undefined(), SuccessResultSchema, () => {
    if (!diagnostics) return { success: true }
    return diagnostics.clearDetailedLogs()
  })

  handle('analysis.start', StartAnalysisInputSchema, StartAnalysisResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.startAnalysis(input)
  })
  handle('analysis.cancel', CancelTaskInputSchema, SuccessResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.cancelTask(input)
  })
  handle('analysis.resume', ResumeTaskInputSchema, StartAnalysisResultSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.resumeTask(input)
  })
  handle('analysis.getProgress', GetTaskProgressInputSchema, TaskProgressEventSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.getProgress(input)
  })

  handle('task.list', ListTasksInputSchema, z.array(TaskSummarySchema), (input) => {
    return store.listTasks(input.sessionId, input.type, input.state)
  })
  handle('task.get', GetTaskInputSchema, TaskDetailSchema, (input) => {
    return store.getTask(input.sessionId, input.taskId)
  })
  handle('task.retryStep', RetryStepInputSchema, TaskSummarySchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.retryStep(input)
  })
  handle('task.skipStep', SkipStepInputSchema, TaskSummarySchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('DATABASE_ERROR', '分析运行器未初始化')
    return analysisRunner.skipStep(input)
  })

  handle('consistencyIssue.list', ListConsistencyIssuesInputSchema, z.array(ConsistencyIssueSchema), (input) => {
    return store.listConsistencyIssues(input.sessionId, input)
  })
  handle('consistencyIssue.review', ReviewConsistencyIssueInputSchema, ConsistencyIssueSchema, (input) => {
    return store.reviewConsistencyIssue(input.sessionId, input.issueId, input.state, input.expectedVersion)
  })

  handle('report.create', CreateReportInputSchema, z.object({ reportId: z.string().uuid() }), (input) => {
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
  handle('report.list', ListReportsInputSchema, z.array(LiteraryReportSummarySchema), (input) => {
    return store.listLiteraryReports(input.sessionId)
  })
  handle('report.get', GetReportInputSchema, LiteraryReportDetailSchema, (input) => {
    return store.getLiteraryReport(input.sessionId, input.reportId)
  })
  handle('report.addAnnotation', AddReportAnnotationInputSchema, ReportAnnotationSchema, (input) => {
    return store.addReportAnnotation(input.sessionId, input.reportSectionId, input.content)
  })
  handle('report.updateAnnotation', UpdateReportAnnotationInputSchema, ReportAnnotationSchema, (input) => {
    return store.updateReportAnnotation(input.sessionId, input.annotationId, input.content)
  })
  handle('report.deleteAnnotation', DeleteReportAnnotationInputSchema, SuccessResultSchema, (input) => {
    return store.deleteReportAnnotation(input.sessionId, input.annotationId)
  })

  handle('synopsis.get', GetSynopsisInputSchema, BookSynopsisSchema.nullable(), (input) => {
    return store.getSynopsis(input.sessionId)
  })
  handle('chapterSummary.get', GetChapterSummaryInputSchema, ChapterSummarySchema.nullable(), (input) => {
    return store.getChapterSummary(input.sessionId, input.chapterId)
  })
  handle('chapterSummary.list', ListChapterSummariesInputSchema, z.array(ChapterSummarySchema), (input) => {
    return store.listChapterSummaries(input.sessionId)
  })

  handle('context.preview', ContextPreviewInputSchema, ContextPackageSchema, (input) => {
    if (!contextAssembler) throw new ProjectError('VALIDATION_ERROR', '上下文装配器未初始化')
    return contextAssembler.assembleContext(input)
  })
  handle('context.get', GetContextPackageInputSchema, ContextPackageSchema, (input) => {
    if (!contextAssembler) throw new ProjectError('VALIDATION_ERROR', '上下文装配器未初始化')
    return contextAssembler.getContextPackage(input)
  })

  handle('creation.start', StartCreationInputSchema, StartCreationResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.startCreation(input.sessionId, input.contextPackageId)
  })
  handle('creation.regenerate', RegenerateCreationInputSchema, StartCreationResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.regenerateCreation(input.sessionId, input.candidateId, input.contextPackageId)
  })
  handle('creation.cancel', CancelCreationInputSchema, SuccessResultSchema, async (input) => {
    if (!creationRun) throw new ProjectError('VALIDATION_ERROR', '创作运行器未初始化')
    return creationRun.cancelCreation(input.sessionId, input.taskId)
  })

  handle('candidate.list', ListCandidatesInputSchema, z.array(CandidateSummarySchema), (input) => {
    return candidateSvc.listCandidates(input.sessionId, input)
  })
  handle('candidate.get', GetCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.getCandidate(input.sessionId, input.candidateId)
  })
  handle('candidate.updateText', UpdateCandidateTextInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.updateText(input.sessionId, input.candidateId, input.editedContent, input.expectedVersion)
  })
  handle('candidate.stageHunk', StageCandidateHunkInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.stageHunk(input.sessionId, input.candidateId, input.hunkPosition, input.selected, input.expectedVersion)
  })
  handle('candidate.retain', RetainCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.retain(input.sessionId, input.candidateId, input.expectedVersion)
  })
  handle('candidate.apply', ApplyCandidateInputSchema, CandidateApplyResultSchema, (input) => {
    return candidateSvc.apply(input.sessionId, input)
  })
  handle('candidate.reject', RejectCandidateInputSchema, CandidateDetailSchema, (input) => {
    return candidateSvc.reject(input.sessionId, input.candidateId, input.expectedVersion)
  })

  handle('chat.create', CreateChatSessionInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.createSession(input)
  })
  handle('chat.list', ListChatSessionsInputSchema, z.array(ChatSessionSchema), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.listSessions(input)
  })
  handle('chat.getSession', GetChatSessionInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.getSession(input)
  })
  handle('chat.updateStage', UpdateChatWorkflowStageInputSchema, ChatSessionSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.updateStage(input)
  })
  handle('chat.delete', DeleteChatSessionInputSchema, SuccessResultSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.deleteSession(input)
  })
  handle('chat.send', SendChatMessageInputSchema, z.object({ messageId: z.string().uuid(), userMessageId: z.string().uuid(), contextPackageId: z.string().uuid() }), async (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.sendMessage(input)
  })
  handle('chat.cancel', CancelChatInputSchema, SuccessResultSchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.cancelChat(input.sessionId, input.chatSessionId)
  })
  handle('chat.compact', CompactChatSessionInputSchema, ChatSummarySchema, async (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.compactSession(input.sessionId, input.chatSessionId, input.connectionId)
  })
  handle('chat.listMessages', ListChatMessagesInputSchema, z.array(ChatMessageSchema), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.listMessages(input)
  })
  handle('chat.getSummary', GetChatSummaryInputSchema, ChatSummarySchema.nullable(), (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.getSummary(input)
  })
  handle('chat.updateSummary', UpdateChatSummaryInputSchema, ChatSummarySchema, (input) => {
    if (!chatSvc) throw new ProjectError('VALIDATION_ERROR', '问答服务未初始化')
    return chatSvc.updateSummary(input)
  })

  // --- Outline IPC Handlers (T02) ---
  handle('outline.getBook', GetBookOutlineInputSchema, BookOutlineSchema.nullable(), (input) => {
    return store.getBookOutline(input.sessionId)
  })
  handle('outline.saveBook', SaveBookOutlineInputSchema, BookOutlineSchema, (input) => {
    return store.saveBookOutline(input.sessionId, input)
  })
  handle('outline.confirmBook', ConfirmBookOutlineInputSchema, BookOutlineSchema, (input) => {
    return store.confirmBookOutline(input.sessionId, input.expectedVersion)
  })
  handle('outline.generateBookDraft', GenerateBookOutlineDraftInputSchema, BookOutlineSchema, async (input) => {
    if (!analysisRunner) throw new ProjectError('VALIDATION_ERROR', '分析运行器未初始化')
    return analysisRunner.generateBookOutlineDraft(input.sessionId, input.connectionId)
  })
  handle('outline.listVolumes', ListVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema), (input) => {
    return store.listVolumeOutlines(input.sessionId)
  })
  handle('outline.getVolume', GetVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.getVolumeOutline(input.sessionId, input.volumeId)
  })
  handle('outline.createVolume', CreateVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.createVolumeOutline(input.sessionId, input)
  })
  handle('outline.updateVolume', UpdateVolumeOutlineInputSchema, VolumeOutlineSchema, (input) => {
    return store.updateVolumeOutline(input.sessionId, input.volumeId, input, input.expectedVersion)
  })
  handle('outline.deleteVolume', DeleteVolumeOutlineInputSchema, SuccessResultSchema, (input) => {
    return store.deleteVolumeOutline(input.sessionId, input.volumeId, input.expectedVersion)
  })
  handle('outline.reorderVolumes', ReorderVolumeOutlinesInputSchema, z.array(VolumeOutlineSchema), (input) => {
    return store.reorderVolumeOutlines(input.sessionId, input.volumes)
  })
  handle('outline.listChapters', ListChapterOutlinesInputSchema, z.array(ChapterOutlineSchema), (input) => {
    return store.listChapterOutlines(input.sessionId, input.chapterId)
  })
  handle('outline.getChapter', GetChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.getChapterOutline(input.sessionId, input.outlineId)
  })
  handle('outline.getLatestChapter', GetLatestChapterOutlineInputSchema, ChapterOutlineSchema.nullable(), (input) => {
    return store.getLatestChapterOutline(input.sessionId, input.chapterId)
  })
  handle('outline.saveChapter', SaveChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.saveChapterOutline(input.sessionId, input)
  })
  handle('outline.confirmChapter', ConfirmChapterOutlineInputSchema, ChapterOutlineSchema, (input) => {
    return store.confirmChapterOutline(input.sessionId, input.outlineId, input.expectedVersion)
  })
  handle('outline.deleteChapter', DeleteChapterOutlineInputSchema, SuccessResultSchema, (input) => {
    return store.deleteChapterOutline(input.sessionId, input.outlineId, input.expectedVersion)
  })

  handle('window.minimize', z.undefined(), z.boolean(), () => {
    window.minimize()
    return true
  })
  handle('window.toggleMaximize', z.undefined(), z.boolean(), () => {
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
    return window.isMaximized()
  })
  handle('window.close', z.undefined(), z.boolean(), () => {
    window.close()
    return true
  })
  handle('window.isMaximized', z.undefined(), z.boolean(), () => {
    return window.isMaximized()
  })

  window.on('maximize', () => {
    if (!window.isDestroyed()) window.webContents.send('window:maximized', true)
  })
  window.on('unmaximize', () => {
    if (!window.isDestroyed()) window.webContents.send('window:maximized', false)
  })
}
