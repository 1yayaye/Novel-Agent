import { z } from 'zod'
import { count } from '../text-counter'

export const ChapterDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string()
})
export type ChapterDraft = z.infer<typeof ChapterDraftSchema>

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  position: z.number().int().nonnegative(),
  content: z.string(),
  version: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type Chapter = z.infer<typeof ChapterSchema>

export const ChapterHeaderSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  position: z.number().int().nonnegative(),
  version: z.number().int().min(1),
  characterCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ChapterHeader = z.infer<typeof ChapterHeaderSchema>

export function toChapterHeader(chapter: Chapter): ChapterHeader {
  return {
    id: chapter.id,
    title: chapter.title,
    position: chapter.position,
    version: chapter.version,
    characterCount: count(chapter.content),
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt
  }
}

export const ListChaptersInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListChaptersInput = z.infer<typeof ListChaptersInputSchema>

export const GetChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid()
})
export type GetChapterInput = z.infer<typeof GetChapterInputSchema>

export const UpdateChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  content: z.string(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateChapterInput = z.infer<typeof UpdateChapterInputSchema>

export const CreateChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  content: z.string().default('')
})
export type CreateChapterInput = z.infer<typeof CreateChapterInputSchema>

export const RenameChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  expectedVersion: z.number().int().min(1)
})
export type RenameChapterInput = z.infer<typeof RenameChapterInputSchema>

export const DeleteChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteChapterInput = z.infer<typeof DeleteChapterInputSchema>

export const ReorderChaptersInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapters: z.array(z.object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1)
  })).min(1)
})
export type ReorderChaptersInput = z.infer<typeof ReorderChaptersInputSchema>

export const SplitChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
  newTitle: z.string().trim().min(1).max(300),
  expectedVersion: z.number().int().min(1)
})
export type SplitChapterInput = z.infer<typeof SplitChapterInputSchema>

export const MergeChapterInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  nextExpectedVersion: z.number().int().min(1)
})
export type MergeChapterInput = z.infer<typeof MergeChapterInputSchema>

export const SnapshotKindSchema = z.enum(['ordinary', 'ai_apply', 'split', 'merge', 'restore', 'manual'])
export type SnapshotKind = z.infer<typeof SnapshotKindSchema>

export const ChapterSnapshotSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  title: z.string(),
  name: z.string().nullable(),
  snapshotKind: SnapshotKindSchema,
  permanent: z.boolean(),
  createdAt: z.number().int().nonnegative()
})
export type ChapterSnapshot = z.infer<typeof ChapterSnapshotSchema>

export const ChapterSnapshotDetailSchema = ChapterSnapshotSchema.extend({
  content: z.string()
})
export type ChapterSnapshotDetail = z.infer<typeof ChapterSnapshotDetailSchema>

export const CreateSnapshotInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(200)
})
export type CreateSnapshotInput = z.infer<typeof CreateSnapshotInputSchema>

export const CreateOrdinarySnapshotInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type CreateOrdinarySnapshotInput = z.infer<typeof CreateOrdinarySnapshotInputSchema>

export const ListSnapshotsInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid()
})
export type ListSnapshotsInput = z.infer<typeof ListSnapshotsInputSchema>

export const GetSnapshotInputSchema = z.object({
  sessionId: z.string().uuid(),
  snapshotId: z.string().uuid()
})
export type GetSnapshotInput = z.infer<typeof GetSnapshotInputSchema>

export const RestoreSnapshotInputSchema = z.object({
  sessionId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type RestoreSnapshotInput = z.infer<typeof RestoreSnapshotInputSchema>
