import { z } from 'zod'

export const BookSummaryStepKindSchema = z.enum([
  'small', 'mainline', 'stage', 'foreshadow', 'characters', 'worldview', 'relations',
  'systemAssess', 'system', 'timeline', 'locations', 'unresolved', 'super', 'outline'
])
export type BookSummaryStepKind = z.infer<typeof BookSummaryStepKindSchema>

export const SummaryRelationGraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), role: z.string(), weight: z.number().min(1).max(5) })),
  edges: z.array(z.object({
    source: z.string().min(1), target: z.string().min(1), label: z.string(),
    type: z.enum(['ally', 'enemy', 'family', 'romance', 'mentor', 'business', 'faction', 'conflict', 'neutral', 'unknown']),
    strength: z.number().int().min(1).max(5)
  }))
})
export type SummaryRelationGraph = z.infer<typeof SummaryRelationGraphSchema>

export const SummarySystemAssessmentSchema = z.object({
  applicable: z.boolean(), label: z.string(), reason: z.string().min(1), fields: z.array(z.string())
})
export type SummarySystemAssessment = z.infer<typeof SummarySystemAssessmentSchema>
export const BookSummarySourceSchema = z.object({
  chapterId: z.string().uuid(), title: z.string(), version: z.number().int().positive(),
  position: z.number().int().nonnegative(), charCount: z.number().int().nonnegative(), hash: z.string()
})
export const BookSummaryRangeSchema = z.object({
  chapterId: z.string().uuid(), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative()
})
export const BookSummaryArtifactSchema = z.object({
  stepId: z.string().uuid(), position: z.number().int().nonnegative(), kind: BookSummaryStepKindSchema,
  title: z.string(), segmentIndex: z.number().int().positive().optional(), stageIndex: z.number().int().positive().optional(),
  ranges: z.array(BookSummaryRangeSchema), content: z.string(), notApplicable: z.boolean(),
  graph: SummaryRelationGraphSchema.optional(), assessment: SummarySystemAssessmentSchema.optional()
})
export type BookSummaryArtifact = z.infer<typeof BookSummaryArtifactSchema>
export const BookSummaryResultSchema = z.object({
  protocolVersion: z.literal(1), resultState: z.enum(['current', 'stale']),
  sources: z.array(BookSummarySourceSchema), totalChars: z.number().int().nonnegative(),
  segmentSize: z.number().int().positive(), stageSize: z.number().int().positive(),
  artifacts: z.array(BookSummaryArtifactSchema),
  stepPlan: z.array(z.object({
    stepId: z.string().uuid(), kind: BookSummaryStepKindSchema, title: z.string(),
    segmentIndex: z.number().int().positive().optional(), stageIndex: z.number().int().positive().optional()
  })),
  outlineCandidate: z.string().nullable()
})
export type BookSummaryResult = z.infer<typeof BookSummaryResultSchema>

export const ExportSummaryInputSchema = z.object({
  sessionId: z.string().uuid(), taskId: z.string().uuid(), destination: z.string().min(1).optional()
})
export type ExportSummaryInput = z.infer<typeof ExportSummaryInputSchema>
export const ApplySummaryOutlineInputSchema = z.object({
  sessionId: z.string().uuid(), taskId: z.string().uuid(), expectedVersion: z.number().int().nonnegative()
})
export type ApplySummaryOutlineInput = z.infer<typeof ApplySummaryOutlineInputSchema>
