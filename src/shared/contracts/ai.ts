import { z } from 'zod'
import { ChapterSchema, ChapterSnapshotSchema } from './chapter'

export const TaskTypeSchema = z.enum(['chat', 'knowledge', 'report', 'continue', 'rewrite', 'polish'])
export type TaskType = z.infer<typeof TaskTypeSchema>

export const TaskRouteSummarySchema = z.object({
  id: z.string().uuid(),
  taskType: TaskTypeSchema,
  connectionId: z.string().uuid(),
  version: z.number().int().min(1),
  updatedAt: z.number().int().nonnegative(),
  resolution: z.enum(['resolved', 'unresolved'])
})
export type TaskRouteSummary = z.infer<typeof TaskRouteSummarySchema>

export const ModelConnectionKindSchema = z.enum(['generation', 'embedding'])
export type ModelConnectionKind = z.infer<typeof ModelConnectionKindSchema>

export const ModelCapabilitiesSchema = z.object({
  streaming: z.boolean().default(true),
  jsonSchema: z.boolean().default(true),
  temperature: z.boolean().default(true),
  usage: z.boolean().default(true)
})
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>

export const ModelConnectionSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  kind: ModelConnectionKindSchema,
  baseUrl: z.string().trim().min(1),
  model: z.string().trim().min(1),
  isLocalService: z.boolean().default(false),
  contextWindow: z.number().int().positive().default(128000),
  maxOutputTokens: z.number().int().positive().default(4096),
  safetyMarginRatio: z.number().min(0).max(0.5).default(0.1),
  tokenEstimationRatio: z.number().positive().default(1.5),
  batchSize: z.number().int().positive().default(16),
  recentDimensions: z.number().int().positive().nullable().optional(),
  connectionFingerprint: z.string().nullable().optional(),
  capabilities: ModelCapabilitiesSchema.default({ streaming: true, jsonSchema: true, temperature: true, usage: true }),
  hasSecret: z.boolean(),
  version: z.number().int().min(1),
  confirmedContentTargetFingerprint: z.string().nullable(),
  confirmedAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ModelConnectionSummary = z.infer<typeof ModelConnectionSummarySchema>

export const ListModelConnectionsInputSchema = z.object({
  kind: ModelConnectionKindSchema.optional()
}).optional()
export type ListModelConnectionsInput = z.infer<typeof ListModelConnectionsInputSchema>

export const GetModelConnectionInputSchema = z.object({
  connectionId: z.string().uuid()
})
export type GetModelConnectionInput = z.infer<typeof GetModelConnectionInputSchema>

export const CreateModelConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: ModelConnectionKindSchema,
  baseUrl: z.string().trim().min(1),
  model: z.string().trim().min(1),
  apiKey: z.string().optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  isLocalService: z.boolean().default(false).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  safetyMarginRatio: z.number().min(0).max(0.5).optional(),
  tokenEstimationRatio: z.number().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  capabilities: ModelCapabilitiesSchema.optional()
})
export type CreateModelConnectionInput = z.infer<typeof CreateModelConnectionInputSchema>

export const UpdateModelConnectionInputSchema = z.object({
  connectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  isLocalService: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  safetyMarginRatio: z.number().min(0).max(0.5).optional(),
  tokenEstimationRatio: z.number().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateModelConnectionInput = z.infer<typeof UpdateModelConnectionInputSchema>

export const DeleteModelConnectionInputSchema = z.object({
  connectionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteModelConnectionInput = z.infer<typeof DeleteModelConnectionInputSchema>

export const TestModelConnectionInputSchema = z.object({
  connectionId: z.string().uuid().optional(),
  draft: CreateModelConnectionInputSchema.optional()
})
export type TestModelConnectionInput = z.infer<typeof TestModelConnectionInputSchema>

export const ConnectionTestResultSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  message: z.string().optional()
})
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>

export const RemoteModelSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  ownedBy: z.string().optional()
})
export type RemoteModelSummary = z.infer<typeof RemoteModelSummarySchema>

export const ListRemoteModelsInputSchema = z.object({
  connectionId: z.string().uuid().optional(),
  draft: z.object({
    baseUrl: z.string().trim().min(1),
    apiKey: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
    isLocalService: z.boolean().default(false).optional()
  }).optional()
})
export type ListRemoteModelsInput = z.infer<typeof ListRemoteModelsInputSchema>

export const ListRemoteModelsResultSchema = z.object({
  models: z.array(RemoteModelSummarySchema)
})
export type ListRemoteModelsResult = z.infer<typeof ListRemoteModelsResultSchema>

export const ConfirmContentTargetInputSchema = z.object({
  connectionId: z.string().uuid(),
  displayedFingerprint: z.string().trim().min(1)
})
export type ConfirmContentTargetInput = z.infer<typeof ConfirmContentTargetInputSchema>

export const ConfirmContentTargetResultSchema = z.object({
  confirmedFingerprint: z.string(),
  confirmedAt: z.number().int().nonnegative()
})
export type ConfirmContentTargetResult = z.infer<typeof ConfirmContentTargetResultSchema>

export const SetTaskRouteInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskType: TaskTypeSchema,
  connectionId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().min(1).optional()
})
export type SetTaskRouteInput = z.infer<typeof SetTaskRouteInputSchema>

export const CreativeRuleSchema = z.object({
  content: z.string(),
  version: z.number().int().min(1)
})
export type CreativeRule = z.infer<typeof CreativeRuleSchema>

export const GetCreativeRuleInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type GetCreativeRuleInput = z.infer<typeof GetCreativeRuleInputSchema>

export const UpdateCreativeRuleInputSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateCreativeRuleInput = z.infer<typeof UpdateCreativeRuleInputSchema>

export const StyleSampleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  content: z.string(),
  tags: z.array(z.string()),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type StyleSample = z.infer<typeof StyleSampleSchema>

export const ListStyleSamplesInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListStyleSamplesInput = z.infer<typeof ListStyleSamplesInputSchema>

export const GetStyleSampleInputSchema = z.object({
  sessionId: z.string().uuid(),
  sampleId: z.string().uuid()
})
export type GetStyleSampleInput = z.infer<typeof GetStyleSampleInputSchema>

export const CreateStyleSampleInputSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  content: z.string(),
  tags: z.array(z.string()).default([])
})
export type CreateStyleSampleInput = z.infer<typeof CreateStyleSampleInputSchema>

export const UpdateStyleSampleInputSchema = z.object({
  sessionId: z.string().uuid(),
  sampleId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  expectedVersion: z.number().int().min(1)
})
export type UpdateStyleSampleInput = z.infer<typeof UpdateStyleSampleInputSchema>

export const DeleteStyleSampleInputSchema = z.object({
  sessionId: z.string().uuid(),
  sampleId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteStyleSampleInput = z.infer<typeof DeleteStyleSampleInputSchema>

export const InstructionPresetSchema = z.object({
  id: z.string().uuid(),
  taskType: TaskTypeSchema,
  name: z.string().trim().min(1).max(200),
  instruction: z.string(),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type InstructionPreset = z.infer<typeof InstructionPresetSchema>

export const ListInstructionPresetsInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskType: TaskTypeSchema.optional()
})
export type ListInstructionPresetsInput = z.infer<typeof ListInstructionPresetsInputSchema>

export const GetInstructionPresetInputSchema = z.object({
  sessionId: z.string().uuid(),
  presetId: z.string().uuid()
})
export type GetInstructionPresetInput = z.infer<typeof GetInstructionPresetInputSchema>

export const CreateInstructionPresetInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskType: TaskTypeSchema,
  name: z.string().trim().min(1).max(200),
  instruction: z.string()
})
export type CreateInstructionPresetInput = z.infer<typeof CreateInstructionPresetInputSchema>

export const UpdateInstructionPresetInputSchema = z.object({
  sessionId: z.string().uuid(),
  presetId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  instruction: z.string(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateInstructionPresetInput = z.infer<typeof UpdateInstructionPresetInputSchema>

export const DeleteInstructionPresetInputSchema = z.object({
  sessionId: z.string().uuid(),
  presetId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteInstructionPresetInput = z.infer<typeof DeleteInstructionPresetInputSchema>

export const TaskStateSchema = z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted'])
export type TaskState = z.infer<typeof TaskStateSchema>

export const TaskStepStateSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export type TaskStepState = z.infer<typeof TaskStepStateSchema>

export const TaskStepResultStateSchema = z.enum(['current', 'stale'])
export type TaskStepResultState = z.infer<typeof TaskStepResultStateSchema>

export const TaskStepSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  chapterId: z.string().uuid().nullable().optional(),
  chapterVersion: z.number().int().min(1).nullable().optional(),
  position: z.number().int().nonnegative(),
  state: TaskStepStateSchema,
  attemptCount: z.number().int().nonnegative(),
  checkpointJson: z.string().nullable().optional(),
  resultState: TaskStepResultStateSchema.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  chapterTitle: z.string().optional()
})
export type TaskStep = z.infer<typeof TaskStepSchema>

export const TaskSummarySchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  scopeJson: z.string(),
  connectionId: z.string().uuid().nullable().optional(),
  state: TaskStateSchema,
  cancelRequested: z.boolean(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable().optional(),
  completedAt: z.number().int().nonnegative().nullable().optional()
})
export type TaskSummary = z.infer<typeof TaskSummarySchema>

export const TaskDetailSchema = TaskSummarySchema.extend({
  steps: z.array(TaskStepSchema)
})
export type TaskDetail = z.infer<typeof TaskDetailSchema>

export const TaskProgressEventSchema = z.object({
  taskId: z.string().uuid(),
  state: TaskStateSchema,
  totalSteps: z.number().int().nonnegative(),
  completedSteps: z.number().int().nonnegative(),
  failedSteps: z.number().int().nonnegative(),
  currentStepPosition: z.number().int().nonnegative().optional(),
  currentChapterId: z.string().uuid().optional(),
  currentChapterTitle: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  percent: z.number().min(0).max(100),
  errorMessage: z.string().optional()
})
export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>

export const StartAnalysisInputSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum(['knowledge', 'report', 'synopsis']),
  scope: z.object({
    chapterIds: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional()
  }),
  connectionId: z.string().uuid().optional()
})
export type StartAnalysisInput = z.infer<typeof StartAnalysisInputSchema>

export const StartAnalysisResultSchema = z.object({
  taskId: z.string().uuid()
})
export type StartAnalysisResult = z.infer<typeof StartAnalysisResultSchema>

export const CancelTaskInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid()
})
export type CancelTaskInput = z.infer<typeof CancelTaskInputSchema>

export const ResumeTaskInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid()
})
export type ResumeTaskInput = z.infer<typeof ResumeTaskInputSchema>

export const GetTaskProgressInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid()
})
export type GetTaskProgressInput = z.infer<typeof GetTaskProgressInputSchema>

export const ListTasksInputSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.string().optional(),
  state: TaskStateSchema.optional()
})
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>

export const GetTaskInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid()
})
export type GetTaskInput = z.infer<typeof GetTaskInputSchema>

export const RetryStepInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid(),
  stepId: z.string().uuid()
})
export type RetryStepInput = z.infer<typeof RetryStepInputSchema>

export const SkipStepInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid(),
  stepId: z.string().uuid()
})
export type SkipStepInput = z.infer<typeof SkipStepInputSchema>

export const PromptSlotRoleSchema = z.enum(['system', 'user', 'assistant'])
export type PromptSlotRole = z.infer<typeof PromptSlotRoleSchema>

export const PromptSlotPositionSchema = z.enum(['before_context', 'after_context', 'absolute_depth'])
export type PromptSlotPosition = z.infer<typeof PromptSlotPositionSchema>

export const PromptSlotTriggerSchema = z.enum([
  'always',
  'creation',
  'continue',
  'rewrite',
  'polish',
  'chat',
  'knowledge',
  'report',
  'direction',
  'chapter_outline',
  'content',
  'reviewed'
])
export type PromptSlotTrigger = z.infer<typeof PromptSlotTriggerSchema>

export const PromptSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  role: PromptSlotRoleSchema,
  content: z.string(),
  position: PromptSlotPositionSchema,
  depth: z.number().int().nonnegative().optional(),
  order: z.number().int().default(0),
  trigger: PromptSlotTriggerSchema.optional()
})
export type PromptSlot = z.infer<typeof PromptSlotSchema>

export const ContextItemSourceTypeSchema = z.enum([
  'system_template',
  'creative_rules',
  'target_text',
  'author_instruction',
  'pinned_source',
  'knowledge_entry',
  'instruction_preset',
  'style_sample',
  'chapter_summary',
  'book_synopsis',
  'book_outline',
  'volume_outline',
  'chapter_outline',
  'retrieved_chunk',
  'ai_suggestion',
  'chat_history',
  'prompt_slot'
])
export type ContextItemSourceType = z.infer<typeof ContextItemSourceTypeSchema>

export const ContextItemSchema = z.object({
  id: z.string().uuid(),
  contextPackageId: z.string().uuid(),
  sourceType: ContextItemSourceTypeSchema,
  sourceId: z.string(),
  authorityLevel: z.number().int().min(1).max(12),
  selectionReason: z.string(),
  estimatedTokens: z.number().int().nonnegative(),
  fixed: z.boolean(),
  position: z.number().int().nonnegative(),
  title: z.string().optional(),
  content: z.string().optional(),
  slotId: z.string().optional(),
  role: PromptSlotRoleSchema.optional(),
  positionType: PromptSlotPositionSchema.optional(),
  depth: z.number().int().nonnegative().optional(),
  slotOrder: z.number().int().optional(),
  activationKey: z.string().optional()
})
export type ContextItem = z.infer<typeof ContextItemSchema>

export const ExcludedContextItemReasonSchema = z.enum(['budget_exceeded', 'conflict', 'stale', 'invalid_source'])
export type ExcludedContextItemReason = z.infer<typeof ExcludedContextItemReasonSchema>

export const ExcludedContextItemSchema = z.object({
  sourceType: ContextItemSourceTypeSchema,
  sourceId: z.string(),
  title: z.string().optional(),
  reason: ExcludedContextItemReasonSchema,
  estimatedTokens: z.number().int().nonnegative(),
  slotId: z.string().optional()
})
export type ExcludedContextItem = z.infer<typeof ExcludedContextItemSchema>

export const ChatWorkflowTypeSchema = z.enum(['free_chat', 'creation_workflow'])
export type ChatWorkflowType = z.infer<typeof ChatWorkflowTypeSchema>

export const ChatWorkflowStageSchema = z.enum(['direction', 'chapter_outline', 'content', 'reviewed'])
export type ChatWorkflowStage = z.infer<typeof ChatWorkflowStageSchema>

export const CreativityLevelSchema = z.enum(['low', 'medium', 'high'])
export type CreativityLevel = z.infer<typeof CreativityLevelSchema>

export const AssembledMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string()
})
export type AssembledMessage = z.infer<typeof AssembledMessageSchema>

export const ContextPackageSchema = z.object({
  id: z.string().uuid(),
  taskType: TaskTypeSchema,
  stage: ChatWorkflowStageSchema.nullable().optional(),
  workflowType: ChatWorkflowTypeSchema.nullable().optional(),
  connectionId: z.string().uuid().nullable().optional(),
  target: z.object({
    chapterId: z.string().uuid().optional(),
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
    chatId: z.string().uuid().optional()
  }).nullable().optional(),
  outlineId: z.string().uuid().nullable().optional(),
  outlineVersion: z.number().int().min(1).nullable().optional(),
  targetVersion: z.number().int().min(1).nullable().optional(),
  targetLength: z.number().int().positive().nullable().optional(),
  creativity: z.object({
    level: CreativityLevelSchema,
    temperature: z.number().optional()
  }).nullable().optional(),
  configurationFingerprint: z.string(),
  messages: z.array(AssembledMessageSchema).default([]),
  systemMessage: z.string(),
  userMessage: z.string(),
  items: z.array(ContextItemSchema),
  excludedItems: z.array(ExcludedContextItemSchema),
  estimatedInputTokens: z.number().int().nonnegative(),
  availableInputTokens: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.number().int().nonnegative()
})
export type ContextPackage = z.infer<typeof ContextPackageSchema>

export const ContextPreviewTargetSchema = z.object({
  chapterId: z.string().uuid().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  chatId: z.string().uuid().optional()
}).optional()
export type ContextPreviewTarget = z.infer<typeof ContextPreviewTargetSchema>

export const DirectorPovSchema = z.enum(['limited_3p', 'omniscient_3p', 'first_person'])
export type DirectorPov = z.infer<typeof DirectorPovSchema>

export const DirectorSensorySchema = z.enum(['strict', 'relaxed'])
export type DirectorSensory = z.infer<typeof DirectorSensorySchema>

export const DirectorPacingSchema = z.enum(['slow', 'normal', 'fast'])
export type DirectorPacing = z.infer<typeof DirectorPacingSchema>

export const DirectorInitiativeSchema = z.enum(['follow_input', 'may_extend'])
export type DirectorInitiative = z.infer<typeof DirectorInitiativeSchema>

export const DirectorOutputFormatSchema = z.enum(['plain', 'content_tagged'])
export type DirectorOutputFormat = z.infer<typeof DirectorOutputFormatSchema>

export const DirectorControlsSchema = z.object({
  pov: DirectorPovSchema.optional(),
  sensory: DirectorSensorySchema.optional(),
  pacing: DirectorPacingSchema.optional(),
  initiative: DirectorInitiativeSchema.optional(),
  styleSampleId: z.string().uuid().optional(),
  outputFormat: DirectorOutputFormatSchema.optional(),
  banWords: z.array(z.string()).optional(),
  enableCoT: z.boolean().optional()
})
export type DirectorControls = z.infer<typeof DirectorControlsSchema>

export const ContextPreviewInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskType: TaskTypeSchema,
  stage: ChatWorkflowStageSchema.optional(),
  workflowType: ChatWorkflowTypeSchema.optional(),
  outlineId: z.string().uuid().optional(),
  outlineVersion: z.number().int().min(1).optional(),
  chatSessionId: z.string().uuid().optional(),
  target: ContextPreviewTargetSchema,
  instruction: z.string().default(''),
  presetId: z.string().uuid().optional(),
  styleSampleIds: z.array(z.string().uuid()).optional(),
  pinnedSourceIds: z.array(z.string()).optional(),
  slots: z.array(PromptSlotSchema).optional(),
  directorControls: DirectorControlsSchema.optional(),
  scanDepth: z.number().int().positive().optional(),
  connectionId: z.string().uuid(),
  includeCreativeRules: z.boolean().default(true).optional(),
  enableQueryRewrite: z.boolean().default(false).optional(),
  targetLength: z.number().int().positive().optional(),
  creativity: CreativityLevelSchema.optional()
})
export type ContextPreviewInput = z.infer<typeof ContextPreviewInputSchema>

export const GetContextPackageInputSchema = z.object({
  sessionId: z.string().uuid(),
  contextPackageId: z.string().uuid()
})
export type GetContextPackageInput = z.infer<typeof GetContextPackageInputSchema>

export const CandidateStateSchema = z.enum(['streaming', 'ready', 'applied', 'cancelled', 'failed', 'rejected', 'stale'])
export type CandidateState = z.infer<typeof CandidateStateSchema>

export const CandidateHunkTypeSchema = z.enum(['equal', 'insert', 'delete', 'replace'])
export type CandidateHunkType = z.infer<typeof CandidateHunkTypeSchema>

export const CandidateHunkSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  position: z.number().int().nonnegative(),
  hunkType: CandidateHunkTypeSchema,
  originalContent: z.string(),
  candidateContent: z.string(),
  selected: z.boolean()
})
export type CandidateHunk = z.infer<typeof CandidateHunkSchema>

export const CandidateHunkDraftSchema = z.object({
  position: z.number().int().nonnegative(),
  hunkType: CandidateHunkTypeSchema,
  originalContent: z.string(),
  candidateContent: z.string(),
  selected: z.boolean()
})
export type CandidateHunkDraft = z.infer<typeof CandidateHunkDraftSchema>

export const CandidateSummarySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  version: z.number().int().min(1),
  state: CandidateStateSchema,
  taskType: TaskTypeSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  previewExcerpt: z.string().optional()
})
export type CandidateSummary = z.infer<typeof CandidateSummarySchema>

export const CandidateDetailSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  originalContent: z.string(),
  rawOutput: z.string(),
  editedContent: z.string().nullable().optional(),
  version: z.number().int().min(1),
  state: CandidateStateSchema,
  taskType: TaskTypeSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  hunks: z.array(CandidateHunkSchema),
  finalSynthesizedText: z.string().optional()
})
export type CandidateDetail = z.infer<typeof CandidateDetailSchema>

export const CandidateApplyResultSchema = z.object({
  chapter: ChapterSchema,
  candidate: CandidateDetailSchema,
  snapshot: ChapterSnapshotSchema
})
export type CandidateApplyResult = z.infer<typeof CandidateApplyResultSchema>

export const ParsedCreationOutputSchema = z.object({
  content: z.string(),
  thinking: z.string().optional(),
  summary: z.string().optional(),
  plotOptions: z.array(z.string()).optional(),
  outline: z.string().optional(),
  direction: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  rawOutput: z.string()
})
export type ParsedCreationOutput = z.infer<typeof ParsedCreationOutputSchema>

export const ParsedDirectionOutputSchema = z.object({
  direction: z.string(),
  questions: z.array(z.string()).default([]),
  thinking: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  rawOutput: z.string()
})
export type ParsedDirectionOutput = z.infer<typeof ParsedDirectionOutputSchema>

export const ParsedChapterOutlineModulesSchema = z.object({
  goal: z.string().optional(),
  sceneBeats: z.string().optional(),
  characters: z.string().optional(),
  conflicts: z.string().optional(),
  continuityRisk: z.string().optional(),
  endingHook: z.string().optional()
})
export type ParsedChapterOutlineModules = z.infer<typeof ParsedChapterOutlineModulesSchema>

export const ParsedChapterOutlineOutputSchema = z.object({
  outline: z.string(),
  modules: ParsedChapterOutlineModulesSchema,
  thinking: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  rawOutput: z.string()
})
export type ParsedChapterOutlineOutput = z.infer<typeof ParsedChapterOutlineOutputSchema>

export const StartCreationInputSchema = z.object({
  sessionId: z.string().uuid(),
  contextPackageId: z.string().uuid()
})
export type StartCreationInput = z.infer<typeof StartCreationInputSchema>

export const StartCreationResultSchema = z.object({
  taskId: z.string().uuid(),
  candidateId: z.string().uuid()
})
export type StartCreationResult = z.infer<typeof StartCreationResultSchema>

export const RegenerateCreationInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  contextPackageId: z.string().uuid()
})
export type RegenerateCreationInput = z.infer<typeof RegenerateCreationInputSchema>

export const CancelCreationInputSchema = z.object({
  sessionId: z.string().uuid(),
  taskId: z.string().uuid()
})
export type CancelCreationInput = z.infer<typeof CancelCreationInputSchema>

export const ListCandidatesInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional()
})
export type ListCandidatesInput = z.infer<typeof ListCandidatesInputSchema>

export const GetCandidateInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid()
})
export type GetCandidateInput = z.infer<typeof GetCandidateInputSchema>

export const UpdateCandidateTextInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  editedContent: z.string(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateCandidateTextInput = z.infer<typeof UpdateCandidateTextInputSchema>

export const StageCandidateHunkInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  hunkPosition: z.number().int().nonnegative(),
  selected: z.boolean(),
  expectedVersion: z.number().int().min(1)
})
export type StageCandidateHunkInput = z.infer<typeof StageCandidateHunkInputSchema>

export const RetainCandidateInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type RetainCandidateInput = z.infer<typeof RetainCandidateInputSchema>

export const ApplyCandidateInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  expectedCandidateVersion: z.number().int().min(1),
  expectedChapterVersion: z.number().int().min(1)
})
export type ApplyCandidateInput = z.infer<typeof ApplyCandidateInputSchema>

export const RejectCandidateInputSchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type RejectCandidateInput = z.infer<typeof RejectCandidateInputSchema>

export const CandidateDeltaEventSchema = z.object({
  candidateId: z.string().uuid(),
  taskId: z.string().uuid(),
  delta: z.string(),
  fullText: z.string(),
  state: CandidateStateSchema
})
export type CandidateDeltaEvent = z.infer<typeof CandidateDeltaEventSchema>

export const CandidateDoneEventSchema = z.object({
  candidateId: z.string().uuid(),
  taskId: z.string().uuid(),
  state: CandidateStateSchema,
  candidate: CandidateDetailSchema.optional()
})
export type CandidateDoneEvent = z.infer<typeof CandidateDoneEventSchema>

export const ChatMessageRoleSchema = z.enum(['system', 'user', 'assistant'])
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>

export const ChatMessageStateSchema = z.enum(['streaming', 'completed', 'failed', 'cancelled'])
export type ChatMessageState = z.infer<typeof ChatMessageStateSchema>

export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  connectionId: z.string().uuid().nullable().optional(),
  workflowType: ChatWorkflowTypeSchema.default('free_chat'),
  targetChapterId: z.string().uuid().nullable().optional(),
  stage: ChatWorkflowStageSchema.nullable().optional(),
  outlineId: z.string().uuid().nullable().optional(),
  outlineVersion: z.number().int().min(1).nullable().optional(),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ChatSession = z.infer<typeof ChatSessionSchema>

export const ChatMessageCitationSchema = z.object({
  citationNumber: z.number().int().positive(),
  sourceType: z.string(),
  sourceId: z.string(),
  title: z.string(),
  excerpt: z.string()
})
export type ChatMessageCitation = z.infer<typeof ChatMessageCitationSchema>

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  role: ChatMessageRoleSchema,
  content: z.string(),
  contextPackageId: z.string().uuid().nullable().optional(),
  tokenCount: z.number().int().nonnegative().nullable().optional(),
  state: ChatMessageStateSchema,
  citations: z.array(ChatMessageCitationSchema).optional(),
  createdAt: z.number().int().nonnegative()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatSummarySchema = z.object({
  id: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  startMessageId: z.string().uuid().nullable().optional(),
  endMessageId: z.string().uuid().nullable().optional(),
  content: z.string(),
  authorEdited: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ChatSummary = z.infer<typeof ChatSummarySchema>

export const CreateChatSessionInputSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  connectionId: z.string().uuid().optional(),
  workflowType: ChatWorkflowTypeSchema.optional(),
  targetChapterId: z.string().uuid().optional(),
  stage: ChatWorkflowStageSchema.optional(),
  outlineId: z.string().uuid().optional(),
  outlineVersion: z.number().int().min(1).optional()
})
export type CreateChatSessionInput = z.infer<typeof CreateChatSessionInputSchema>

export const GetChatSessionInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid()
})
export type GetChatSessionInput = z.infer<typeof GetChatSessionInputSchema>

export const UpdateChatWorkflowStageInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  stage: ChatWorkflowStageSchema,
  targetChapterId: z.string().uuid().optional(),
  outlineId: z.string().uuid().optional(),
  outlineVersion: z.number().int().min(1).optional(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateChatWorkflowStageInput = z.infer<typeof UpdateChatWorkflowStageInputSchema>

export const ListChatSessionsInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListChatSessionsInput = z.infer<typeof ListChatSessionsInputSchema>

export const DeleteChatSessionInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteChatSessionInput = z.infer<typeof DeleteChatSessionInputSchema>

export const SendChatMessageInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  content: z.string().trim().min(1),
  connectionId: z.string().uuid().optional()
})
export type SendChatMessageInput = z.infer<typeof SendChatMessageInputSchema>

export const CancelChatInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid()
})
export type CancelChatInput = z.infer<typeof CancelChatInputSchema>

export const CompactChatSessionInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  connectionId: z.string().uuid().optional()
})
export type CompactChatSessionInput = z.infer<typeof CompactChatSessionInputSchema>

export const ListChatMessagesInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid()
})
export type ListChatMessagesInput = z.infer<typeof ListChatMessagesInputSchema>

export const GetChatSummaryInputSchema = z.object({
  sessionId: z.string().uuid(),
  chatSessionId: z.string().uuid()
})
export type GetChatSummaryInput = z.infer<typeof GetChatSummaryInputSchema>

export const UpdateChatSummaryInputSchema = z.object({
  sessionId: z.string().uuid(),
  summaryId: z.string().uuid(),
  content: z.string().trim().min(1),
  expectedVersion: z.number().int().min(1)
})
export type UpdateChatSummaryInput = z.infer<typeof UpdateChatSummaryInputSchema>

export const ChatDeltaEventSchema = z.object({
  chatSessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  delta: z.string(),
  fullText: z.string(),
  state: ChatMessageStateSchema
})
export type ChatDeltaEvent = z.infer<typeof ChatDeltaEventSchema>

export const ChatDoneEventSchema = z.object({
  chatSessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  state: ChatMessageStateSchema,
  message: ChatMessageSchema.optional(),
  contextPackage: ContextPackageSchema.optional()
})
export type ChatDoneEvent = z.infer<typeof ChatDoneEventSchema>
