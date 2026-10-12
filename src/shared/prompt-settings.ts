import { z } from 'zod'

export const PromptTaskSchema = z.enum([
  'continue', 'rewrite', 'polish', 'chat', 'direction', 'chapter_outline', 'content',
  'knowledge', 'report', 'style_distill', 'book_summary', 'synopsis_compress',
  'synopsis_step', 'synopsis_final', 'distill_segment', 'distill_stage', 'distill_master',
  'summary_segment', 'summary_stage', 'summary_master', 'book_outline', 'chat_summary'
])
export type PromptTask = z.infer<typeof PromptTaskSchema>
export const PresetBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  enabled: z.boolean(),
  position: z.enum(['relative', 'in_chat']).default('relative'),
  depth: z.number().int().min(0).default(0),
  order: z.number().int().default(0),
  marker: z.string().optional()
})
export type PresetBlock = z.infer<typeof PresetBlockSchema>

export const PresetConversionReferenceSchema = z.object({ name: z.string(), revision: z.string(), url: z.string().url() })
export const PresetConversionUsageSchema = z.object({
  promptTokens: z.number().nonnegative(), completionTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative(),
  requests: z.number().int().nonnegative(), reportedRequests: z.number().int().nonnegative()
})

export const PresetConversionReportSchema = z.object({
  sourceFingerprint: z.string(),
  fileName: z.string().optional(),
  referenceVersion: z.string(),
  references: z.array(PresetConversionReferenceSchema),
  model: z.object({ connectionId: z.string().uuid(), connectionVersion: z.number().int(), name: z.string(), model: z.string() }),
  createdAt: z.number().int(),
  convertedFingerprint: z.string(),
  modified: z.boolean(),
  compatibility: z.literal('ai-adapted-static'),
  items: z.array(z.object({
    sourceId: z.string(),
    path: z.string(),
    name: z.string(),
    kind: z.enum(['prompt', 'order', 'script', 'regex', 'extension', 'settings']),
    disposition: z.enum(['retained', 'adapted', 'ignored', 'unsupported']),
    reason: z.string().min(1),
    targetBlockIds: z.array(z.string()),
    losses: z.array(z.string())
  })),
  warnings: z.array(z.string()),
  usage: PresetConversionUsageSchema
})
export type PresetConversionReport = z.infer<typeof PresetConversionReportSchema>

export const NovelPromptPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  blocks: z.array(PresetBlockSchema),
  conversionReport: PresetConversionReportSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type NovelPromptPreset = z.infer<typeof NovelPromptPresetSchema>

export const PresetStoreDataSchema = z.object({
  activePresetId: z.string().nullable(),
  presets: z.array(NovelPromptPresetSchema)
})
export type PresetStoreData = z.infer<typeof PresetStoreDataSchema>

export const DEFAULT_PRESET_STORE: PresetStoreData = {
  activePresetId: null,
  presets: []
}

export const PromptSettingsStateSchema = z.object({
  store: PresetStoreDataSchema,
  warnings: z.array(z.string())
})
export type PromptSettingsState = z.infer<typeof PromptSettingsStateSchema>

export const PromptSnapshotSchema = z.object({
  activePreset: NovelPromptPresetSchema.nullable(),
  definitionFingerprint: z.string(),
  fingerprint: z.string(),
  budget: z.object({
    connectionId: z.string(),
    connectionVersion: z.number().int().positive(),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    safetyMarginRatio: z.number().min(0).max(0.5),
    tokenEstimationRatio: z.number().positive()
  }).optional()
})
export type PromptSnapshot = z.infer<typeof PromptSnapshotSchema>

