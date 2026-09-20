import { z } from 'zod'

export const KnowledgeKindSchema = z.enum(['character', 'world', 'timeline', 'foreshadow'])
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>

export const KnowledgeStateSchema = z.enum(['active', 'archived'])
export type KnowledgeState = z.infer<typeof KnowledgeStateSchema>

export const ForeshadowStateSchema = z.enum(['planted', 'developing', 'resolved', 'abandoned'])
export type ForeshadowState = z.infer<typeof ForeshadowStateSchema>

export const KnowledgeEntrySchema = z.object({
  id: z.string().uuid(),
  knowledgeKind: KnowledgeKindSchema,
  title: z.string().trim().min(1).max(200),
  aliases: z.array(z.string()),
  authorContent: z.string(),
  tags: z.array(z.string()),
  identity: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  narrativeOrder: z.number().int().nullable().optional(),
  storyTime: z.string().nullable().optional(),
  relativeTime: z.string().nullable().optional(),
  timeUncertain: z.boolean().nullable().optional(),
  foreshadowState: z.string().nullable().optional(),
  version: z.number().int().min(1),
  state: KnowledgeStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>

export const ListKnowledgeEntriesInputSchema = z.object({
  sessionId: z.string().uuid(),
  kind: KnowledgeKindSchema.optional(),
  state: KnowledgeStateSchema.optional(),
  query: z.string().trim().optional()
})
export type ListKnowledgeEntriesInput = z.infer<typeof ListKnowledgeEntriesInputSchema>

export const GetKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid()
})
export type GetKnowledgeEntryInput = z.infer<typeof GetKnowledgeEntryInputSchema>

export const CreateKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  kind: KnowledgeKindSchema,
  title: z.string().trim().min(1).max(200),
  aliases: z.array(z.string()).default([]),
  authorContent: z.string().default(''),
  tags: z.array(z.string()).default([]),
  identity: z.string().optional(),
  currentState: z.string().optional(),
  narrativeOrder: z.number().int().optional(),
  storyTime: z.string().optional(),
  relativeTime: z.string().optional(),
  timeUncertain: z.boolean().optional(),
  foreshadowState: z.string().optional()
})
export type CreateKnowledgeEntryInput = z.infer<typeof CreateKnowledgeEntryInputSchema>

export const UpdateKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  aliases: z.array(z.string()).optional(),
  authorContent: z.string().optional(),
  tags: z.array(z.string()).optional(),
  identity: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  narrativeOrder: z.number().int().nullable().optional(),
  storyTime: z.string().nullable().optional(),
  relativeTime: z.string().nullable().optional(),
  timeUncertain: z.boolean().nullable().optional(),
  foreshadowState: z.string().nullable().optional(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateKnowledgeEntryInput = z.infer<typeof UpdateKnowledgeEntryInputSchema>

export const ArchiveKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type ArchiveKnowledgeEntryInput = z.infer<typeof ArchiveKnowledgeEntryInputSchema>

export const RestoreKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type RestoreKnowledgeEntryInput = z.infer<typeof RestoreKnowledgeEntryInputSchema>

export const DeleteKnowledgeEntryInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteKnowledgeEntryInput = z.infer<typeof DeleteKnowledgeEntryInputSchema>

export const CharacterRelationshipSchema = z.object({
  id: z.string().uuid(),
  fromCharacterId: z.string().uuid(),
  toCharacterId: z.string().uuid(),
  relationType: z.string().trim().min(1).max(100),
  description: z.string().default(''),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  fromCharacterTitle: z.string().optional(),
  toCharacterTitle: z.string().optional()
})
export type CharacterRelationship = z.infer<typeof CharacterRelationshipSchema>

export const ListCharacterRelationshipsInputSchema = z.object({
  sessionId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
  includeArchived: z.boolean().default(false).optional()
})
export type ListCharacterRelationshipsInput = z.infer<typeof ListCharacterRelationshipsInputSchema>

export const GetCharacterRelationshipInputSchema = z.object({
  sessionId: z.string().uuid(),
  relationshipId: z.string().uuid()
})
export type GetCharacterRelationshipInput = z.infer<typeof GetCharacterRelationshipInputSchema>

export const CreateCharacterRelationshipInputSchema = z.object({
  sessionId: z.string().uuid(),
  fromCharacterId: z.string().uuid(),
  toCharacterId: z.string().uuid(),
  relationType: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default('')
})
export type CreateCharacterRelationshipInput = z.infer<typeof CreateCharacterRelationshipInputSchema>

export const UpdateCharacterRelationshipInputSchema = z.object({
  sessionId: z.string().uuid(),
  relationshipId: z.string().uuid(),
  relationType: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  expectedVersion: z.number().int().min(1)
})
export type UpdateCharacterRelationshipInput = z.infer<typeof UpdateCharacterRelationshipInputSchema>

export const DeleteCharacterRelationshipInputSchema = z.object({
  sessionId: z.string().uuid(),
  relationshipId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteCharacterRelationshipInput = z.infer<typeof DeleteCharacterRelationshipInputSchema>

export const SuggestionStateSchema = z.enum(['pending', 'accepted', 'ignored', 'conflict'])
export type SuggestionState = z.infer<typeof SuggestionStateSchema>

export const EvidenceOwnerTypeSchema = z.enum(['ai_fact_suggestion', 'consistency_issue', 'report_section'])
export type EvidenceOwnerType = z.infer<typeof EvidenceOwnerTypeSchema>

export const EvidenceStateSchema = z.enum(['valid', 'stale', 'missing'])
export type EvidenceState = z.infer<typeof EvidenceStateSchema>

export const SourceEvidenceSchema = z.object({
  id: z.string().uuid(),
  ownerType: EvidenceOwnerTypeSchema,
  ownerId: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  excerpt: z.string(),
  state: EvidenceStateSchema,
  createdAt: z.number().int().nonnegative(),
  chapterTitle: z.string().optional()
})
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>

export const AiFactSuggestionSchema = z.object({
  id: z.string().uuid(),
  knowledgeEntryId: z.string().uuid().nullable().optional(),
  knowledgeKind: KnowledgeKindSchema,
  normalizedSubject: z.string(),
  predicate: z.string(),
  valueJson: z.string(),
  displayText: z.string(),
  state: SuggestionStateSchema,
  confidence: z.number().nullable().optional(),
  analysisTaskId: z.string().uuid(),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  reviewedAt: z.number().int().nullable().optional(),
  evidences: z.array(SourceEvidenceSchema).default([])
})
export type AiFactSuggestion = z.infer<typeof AiFactSuggestionSchema>

export const ListSuggestionsInputSchema = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid().optional(),
  state: SuggestionStateSchema.optional(),
  kind: KnowledgeKindSchema.optional()
})
export type ListSuggestionsInput = z.infer<typeof ListSuggestionsInputSchema>

export const GetSuggestionInputSchema = z.object({
  sessionId: z.string().uuid(),
  suggestionId: z.string().uuid()
})
export type GetSuggestionInput = z.infer<typeof GetSuggestionInputSchema>

export const ReviewSuggestionInputSchema = z.object({
  sessionId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  state: z.enum(['ignored', 'conflict']),
  expectedVersion: z.number().int().min(1)
})
export type ReviewSuggestionInput = z.infer<typeof ReviewSuggestionInputSchema>

export const PreviewSuggestionAcceptanceInputSchema = z.object({
  sessionId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  targetEntryId: z.string().uuid().optional()
})
export type PreviewSuggestionAcceptanceInput = z.infer<typeof PreviewSuggestionAcceptanceInputSchema>

export const SuggestionAcceptanceDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: KnowledgeKindSchema,
  authorContent: z.string()
})
export type SuggestionAcceptanceDraft = z.infer<typeof SuggestionAcceptanceDraftSchema>

export const SuggestionAcceptancePreviewSchema = z.object({
  suggestion: AiFactSuggestionSchema,
  targetEntry: KnowledgeEntrySchema.nullable(),
  draft: SuggestionAcceptanceDraftSchema,
  targetExpectedVersion: z.number().int().min(1).nullable()
})
export type SuggestionAcceptancePreview = z.infer<typeof SuggestionAcceptancePreviewSchema>

export const AcceptSuggestionInputSchema = z.object({
  sessionId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  expectedSuggestionVersion: z.number().int().min(1),
  targetEntryId: z.string().uuid().optional(),
  targetExpectedVersion: z.number().int().min(1).optional(),
  draft: SuggestionAcceptanceDraftSchema
})
export type AcceptSuggestionInput = z.infer<typeof AcceptSuggestionInputSchema>

export const ConsistencyIssueTypeSchema = z.enum([
  'plot_hole',
  'character_inconsistency',
  'timeline_contradiction',
  'setting_mismatch',
  'style_drift',
  'other'
])
export type ConsistencyIssueType = z.infer<typeof ConsistencyIssueTypeSchema>

export const ConsistencyIssueSeveritySchema = z.enum(['low', 'medium', 'high'])
export type ConsistencyIssueSeverity = z.infer<typeof ConsistencyIssueSeveritySchema>

export const ConsistencyIssueStateSchema = z.enum(['open', 'acknowledged', 'dismissed', 'stale'])
export type ConsistencyIssueState = z.infer<typeof ConsistencyIssueStateSchema>

export const ConsistencyIssueSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  issueType: ConsistencyIssueTypeSchema,
  severity: ConsistencyIssueSeveritySchema,
  description: z.string(),
  version: z.number().int().min(1),
  state: ConsistencyIssueStateSchema,
  analysisTaskId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
  reviewedAt: z.number().int().nonnegative().nullable().optional(),
  chapterTitle: z.string().optional(),
  evidences: z.array(SourceEvidenceSchema).default([])
})
export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>

export const ListConsistencyIssuesInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid().optional(),
  state: ConsistencyIssueStateSchema.optional(),
  severity: ConsistencyIssueSeveritySchema.optional()
})
export type ListConsistencyIssuesInput = z.infer<typeof ListConsistencyIssuesInputSchema>

export const ReviewConsistencyIssueInputSchema = z.object({
  sessionId: z.string().uuid(),
  issueId: z.string().uuid(),
  state: z.enum(['acknowledged', 'dismissed']),
  expectedVersion: z.number().int().min(1)
})
export type ReviewConsistencyIssueInput = z.infer<typeof ReviewConsistencyIssueInputSchema>

export const ChapterSummarySchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  summary: z.string(),
  state: z.enum(['current', 'stale']),
  analysisTaskId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
  chapterTitle: z.string().optional()
})
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>

export const GetChapterSummaryInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid()
})
export type GetChapterSummaryInput = z.infer<typeof GetChapterSummaryInputSchema>

export const ListChapterSummariesInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListChapterSummariesInput = z.infer<typeof ListChapterSummariesInputSchema>

export const BookSynopsisSchema = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  sourceVersionsJson: z.string(),
  state: z.enum(['current', 'stale']),
  analysisTaskId: z.string().uuid(),
  createdAt: z.number().int().nonnegative()
})
export type BookSynopsis = z.infer<typeof BookSynopsisSchema>

export const GetSynopsisInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type GetSynopsisInput = z.infer<typeof GetSynopsisInputSchema>

export const ReportSectionTypeSchema = z.enum([
  'theme',
  'narrative_perspective',
  'style',
  'pacing_and_structure',
  'character_arc',
  'continuity_issues'
])
export type ReportSectionType = z.infer<typeof ReportSectionTypeSchema>

export const ReportAnnotationSchema = z.object({
  id: z.string().uuid(),
  reportSectionId: z.string().uuid(),
  content: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ReportAnnotation = z.infer<typeof ReportAnnotationSchema>

export const ReportSectionSchema = z.object({
  id: z.string().uuid(),
  literaryReportId: z.string().uuid(),
  sectionType: ReportSectionTypeSchema,
  content: z.string(),
  conclusion: z.string(),
  position: z.number().int().nonnegative(),
  evidences: z.array(SourceEvidenceSchema).default([]),
  annotations: z.array(ReportAnnotationSchema).default([])
})
export type ReportSection = z.infer<typeof ReportSectionSchema>

export const LiteraryReportSummarySchema = z.object({
  id: z.string().uuid(),
  scopeJson: z.string(),
  chapterVersionsJson: z.string(),
  state: z.enum(['current', 'stale']),
  connectionId: z.string().uuid().nullable().optional(),
  analysisTaskId: z.string().uuid().nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative().default(6)
})
export type LiteraryReportSummary = z.infer<typeof LiteraryReportSummarySchema>

export const LiteraryReportDetailSchema = LiteraryReportSummarySchema.extend({
  sections: z.array(ReportSectionSchema)
})
export type LiteraryReportDetail = z.infer<typeof LiteraryReportDetailSchema>

export const CreateReportInputSchema = z.object({
  sessionId: z.string().uuid(),
  scope: z.object({
    all: z.boolean().optional(),
    chapterIds: z.array(z.string().uuid()).optional()
  }),
  chapterVersions: z.array(z.object({
    chapterId: z.string().uuid(),
    version: z.number().int().min(1)
  })),
  connectionId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  sections: z.array(z.object({
    sectionType: ReportSectionTypeSchema,
    content: z.string(),
    conclusion: z.string(),
    position: z.number().int().nonnegative(),
    evidences: z.array(z.object({
      chapterId: z.string().uuid(),
      chapterVersion: z.number().int().min(1),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      excerpt: z.string()
    })).default([])
  }))
})
export type CreateReportInput = z.infer<typeof CreateReportInputSchema>

export const ListReportsInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListReportsInput = z.infer<typeof ListReportsInputSchema>

export const GetReportInputSchema = z.object({
  sessionId: z.string().uuid(),
  reportId: z.string().uuid()
})
export type GetReportInput = z.infer<typeof GetReportInputSchema>

export const AddReportAnnotationInputSchema = z.object({
  sessionId: z.string().uuid(),
  reportSectionId: z.string().uuid(),
  content: z.string().trim().min(1)
})
export type AddReportAnnotationInput = z.infer<typeof AddReportAnnotationInputSchema>

export const UpdateReportAnnotationInputSchema = z.object({
  sessionId: z.string().uuid(),
  annotationId: z.string().uuid(),
  content: z.string().trim().min(1)
})
export type UpdateReportAnnotationInput = z.infer<typeof UpdateReportAnnotationInputSchema>

export const DeleteReportAnnotationInputSchema = z.object({
  sessionId: z.string().uuid(),
  annotationId: z.string().uuid()
})
export type DeleteReportAnnotationInput = z.infer<typeof DeleteReportAnnotationInputSchema>
