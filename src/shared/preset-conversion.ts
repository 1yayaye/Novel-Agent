import { z } from 'zod'
import { NovelPromptPresetSchema, PresetConversionReferenceSchema, PresetConversionUsageSchema } from './prompt-settings'

export const PresetConversionInputSchema = z.object({
  jsonContent: z.string().min(1).max(32 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(255).optional(),
  sessionId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional()
})
export type PresetConversionInput = z.infer<typeof PresetConversionInputSchema>

export const PresetConversionTaskInputSchema = z.object({ taskId: z.string().uuid() })
export type PresetConversionTaskInput = z.infer<typeof PresetConversionTaskInputSchema>

export const PresetSourceItemSchema = z.object({
  sourceId: z.string(),
  path: z.string(),
  name: z.string(),
  kind: z.enum(['prompt', 'order', 'script', 'regex', 'extension', 'settings']),
  characters: z.number().int().nonnegative(),
  enabled: z.boolean().nullable(),
  order: z.number().int().nullable()
})
export type PresetSourceItem = z.infer<typeof PresetSourceItemSchema>

export const PresetConversionInspectionSchema = z.object({
  format: z.enum(['novel', 'tavern']),
  name: z.string(),
  sourceFingerprint: z.string(),
  sourceCharacters: z.number().int().nonnegative(),
  items: z.array(PresetSourceItemSchema),
  referenceVersion: z.string(),
  references: z.array(PresetConversionReferenceSchema),
  connection: z.object({ id: z.string().uuid(), version: z.number().int(), name: z.string(), model: z.string() }).nullable(),
  estimatedSourceTokens: z.number().int().nonnegative().nullable(),
  initialAnalysisBatches: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string())
})
export type PresetConversionInspection = z.infer<typeof PresetConversionInspectionSchema>

export const PresetConversionStatusSchema = z.object({
  taskId: z.string().uuid(),
  name: z.string(),
  state: z.enum(['queued', 'analyzing', 'summarizing', 'converting', 'validating', 'ready', 'failed', 'cancelled']),
  completedBatches: z.number().int().nonnegative(),
  totalBatches: z.number().int().nonnegative(),
  usage: PresetConversionUsageSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  error: z.object({ code: z.string(), message: z.string() }).nullable()
})
export type PresetConversionStatus = z.infer<typeof PresetConversionStatusSchema>

export const PresetConversionResultSchema = z.object({
  taskId: z.string().uuid(),
  format: z.enum(['novel', 'tavern']),
  preset: NovelPromptPresetSchema,
  warnings: z.array(z.string())
})
export type PresetConversionResult = z.infer<typeof PresetConversionResultSchema>

export const StartPresetConversionResultSchema = z.object({ taskId: z.string().uuid() })
