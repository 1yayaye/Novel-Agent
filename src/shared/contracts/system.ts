import { z } from 'zod'
import { TaskRouteSummarySchema } from './ai'
import { ChapterDraftSchema } from './chapter'

export const CURRENT_SCHEMA_VERSION = 4

export const ProjectErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNTRUSTED_SENDER',
  'PROJECT_NOT_OPEN',
  'PROJECT_READ_ONLY',
  'PROJECT_LOCKED',
  'UNSUPPORTED_SCHEMA',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'STALE_CANDIDATE',
  'STALE_CONTEXT_PACKAGE',
  'CONNECTION_NOT_FOUND',
  'CONNECTION_FAILED',
  'CONTENT_TARGET_CONFIRMATION_REQUIRED',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'MODEL_CONTEXT_EXCEEDED',
  'MODEL_OUTPUT_INVALID',
  'TASK_CANCELLED',
  'FILE_ENCODING_UNKNOWN',
  'IMPORT_INVALID',
  'EXPORT_FAILED',
  'DATABASE_ERROR'
])
export type ProjectErrorCode = z.infer<typeof ProjectErrorCodeSchema>

export const ProjectPathSchema = z.string().trim().min(1).refine((path) => path.toLowerCase().endsWith('.novelproj'), 'Expected a .novelproj path')

export const ProjectSummarySchema = z.object({
  projectId: z.string().uuid().nullable(),
  path: z.string(),
  title: z.string(),
  description: z.string(),
  version: z.number().int().min(1).nullable(),
  schemaVersion: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  searchIndexState: z.enum(['current', 'needs_rebuild', 'unknown']),
  sourcePath: z.string().optional()
})
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>

export const CreateProjectInputSchema = z.object({
  destination: ProjectPathSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(''),
  sourcePath: z.string().optional()
})
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

export const OpenProjectInputSchema = z.object({ path: ProjectPathSchema })
export const CloseProjectInputSchema = z.object({ sessionId: z.string().uuid() })
export const SaveCopyInputSchema = z.object({ sessionId: z.string().uuid(), destination: ProjectPathSchema })

export const SuccessResultSchema = z.object({ success: z.literal(true) })
export type SuccessResult = z.infer<typeof SuccessResultSchema>

export const SaveCopyResultSchema = z.object({ savedPath: z.string() })
export type SaveCopyResult = z.infer<typeof SaveCopyResultSchema>

export const RecentProjectSchema = ProjectSummarySchema.pick({ path: true, title: true, sourcePath: true }).extend({
  lastOpenedAt: z.number().int(),
  isAvailable: z.boolean()
})
export type RecentProject = z.infer<typeof RecentProjectSchema>

export const OpenProjectResultSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['read_write', 'read_only']),
  readOnlyReason: z.enum(['locked', 'future_schema', 'not_writable', 'integrity_failed']).optional(),
  integrity: z.enum(['ok', 'failed']),
  metadata: ProjectSummarySchema,
  taskRoutes: z.array(TaskRouteSummarySchema)
})
export type OpenProjectResult = z.infer<typeof OpenProjectResultSchema>

export const ListRecentProjectsResultSchema = z.array(RecentProjectSchema)

export const ImportEncodingSchema = z.enum(['utf8', 'utf16le', 'utf16be', 'gb18030'])

export const ImportPreviewInputSchema = z.object({
  source: z.string().trim().min(1).optional(),
  encoding: ImportEncodingSchema.optional()
})
export type ImportPreviewInput = z.infer<typeof ImportPreviewInputSchema>

export const ImportPreviewResultSchema = z.object({
  source: z.string(),
  encoding: ImportEncodingSchema,
  confidence: z.enum(['high', 'low']),
  characterCount: z.number().int().nonnegative(),
  suggestedTitle: z.string(),
  chapters: z.array(ChapterDraftSchema).min(1)
}).nullable()
export type ImportPreviewResult = z.infer<typeof ImportPreviewResultSchema>

export const ImportProjectInputSchema = z.object({
  source: z.string().trim().min(1),
  encoding: ImportEncodingSchema,
  title: z.string().trim().min(1).max(200),
  destination: ProjectPathSchema.optional(),
  chapters: z.array(ChapterDraftSchema).min(1)
})
export type ImportProjectInput = z.infer<typeof ImportProjectInputSchema>

export const ImportProjectResultSchema = ProjectSummarySchema.nullable()

export const ExportFormatSchema = z.enum(['txt', 'md'])
export type ExportFormat = z.infer<typeof ExportFormatSchema>

export const ExportProjectInputSchema = z.object({
  sessionId: z.string().uuid(),
  format: ExportFormatSchema,
  chapterIds: z.array(z.string().uuid()).optional(),
  destination: z.string().optional()
})
export type ExportProjectInput = z.infer<typeof ExportProjectInputSchema>

export const ExportProjectResultSchema = z.object({ savedPath: z.string() })
export type ExportProjectResult = z.infer<typeof ExportProjectResultSchema>

export const BackupInfoSchema = z.object({
  id: z.string(),
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  tag: z.string().optional()
})
export type BackupInfo = z.infer<typeof BackupInfoSchema>

export const ListBackupsInputSchema = z.object({ sessionId: z.string().uuid() })
export type ListBackupsInput = z.infer<typeof ListBackupsInputSchema>

export const CreateBackupInputSchema = z.object({ sessionId: z.string().uuid() })
export type CreateBackupInput = z.infer<typeof CreateBackupInputSchema>

export const RestoreBackupInputSchema = z.object({ sessionId: z.string().uuid(), backupPath: z.string() })
export type RestoreBackupInput = z.infer<typeof RestoreBackupInputSchema>

export const OpenBackupLocationInputSchema = z.object({ sessionId: z.string().uuid() })
export type OpenBackupLocationInput = z.infer<typeof OpenBackupLocationInputSchema>

export const SearchSourceTypeSchema = z.enum(['chapter_chunk', 'knowledge_entry', 'creative_rules', 'style_sample'])
export type SearchSourceType = z.infer<typeof SearchSourceTypeSchema>

export const SearchFiltersSchema = z.object({
  sourceTypes: z.array(SearchSourceTypeSchema).optional(),
  chapterIds: z.array(z.string().uuid()).optional()
}).optional()

export const KeywordSearchInputSchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(100).default(100).optional(),
  filters: SearchFiltersSchema
})
export type KeywordSearchInput = z.infer<typeof KeywordSearchInputSchema>

export const SearchResultTargetSchema = z.object({
  chapterId: z.string().uuid().optional(),
  offset: z.number().int().nonnegative().optional(),
  entryId: z.string().uuid().optional()
})

export const SearchResultItemSchema = z.object({
  id: z.string(),
  sourceType: SearchSourceTypeSchema,
  sourceId: z.string(),
  title: z.string(),
  excerpt: z.string(),
  highlightOffsets: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
  score: z.number().optional(),
  target: SearchResultTargetSchema
})
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>

export const KeywordSearchResultSchema = z.array(SearchResultItemSchema)
export type KeywordSearchResult = z.infer<typeof KeywordSearchResultSchema>

export const VectorIndexStateSchema = z.enum(['missing', 'building', 'ready', 'stale', 'failed'])
export type VectorIndexState = z.infer<typeof VectorIndexStateSchema>

export const VectorIndexMetaSchema = z.object({
  embeddingConnectionFingerprint: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  dimensions: z.number().int().positive().nullable().optional(),
  state: VectorIndexStateSchema,
  processedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  lastError: z.string().nullable().optional(),
  updatedAt: z.number().int().nonnegative()
})
export type VectorIndexMeta = z.infer<typeof VectorIndexMetaSchema>

export const GetIndexStatusInputSchema = z.object({ sessionId: z.string().uuid() })

export const IndexStatusResultSchema = z.object({
  state: z.enum(['current', 'needs_rebuild']),
  searchRevision: z.number().int().nonnegative(),
  indexedRevision: z.number().int().nonnegative(),
  lastError: z.string().nullable().optional(),
  vectorMeta: VectorIndexMetaSchema.optional()
})
export type IndexStatusResult = z.infer<typeof IndexStatusResultSchema>

export const RebuildIndexInputSchema = z.object({ sessionId: z.string().uuid(), includeVector: z.boolean().optional() })

export const RebuildIndexResultSchema = z.object({
  success: z.literal(true),
  searchRevision: z.number().int().nonnegative(),
  indexedRevision: z.number().int().nonnegative()
})
export type RebuildIndexResult = z.infer<typeof RebuildIndexResultSchema>

export const HybridSearchInputSchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(100).default(100).optional(),
  filters: SearchFiltersSchema,
  connectionId: z.string().uuid().optional()
})
export type HybridSearchInput = z.infer<typeof HybridSearchInputSchema>

export const IpcErrorSchema = z.object({ code: ProjectErrorCodeSchema, message: z.string() })

export const ipcResultSchema = <T extends z.ZodType>(valueSchema: T) => z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: valueSchema }),
  z.object({ ok: z.literal(false), error: IpcErrorSchema })
])

export const LogStateResultSchema = z.object({
  detailedLoggingEnabled: z.boolean(),
  logDirectory: z.string()
})
export type LogStateResult = z.infer<typeof LogStateResultSchema>

export const SetDetailedLoggingInputSchema = z.object({
  enabled: z.boolean()
})
