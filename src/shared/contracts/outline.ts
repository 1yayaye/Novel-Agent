import { z } from 'zod'

export const OutlineStateSchema = z.enum(['draft', 'confirmed', 'current', 'stale'])
export type OutlineState = z.infer<typeof OutlineStateSchema>

export const BookOutlineSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  sourceVersions: z.record(z.string(), z.number().int()).default({}),
  version: z.number().int().min(1),
  state: OutlineStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type BookOutline = z.infer<typeof BookOutlineSchema>

export const GetBookOutlineInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type GetBookOutlineInput = z.infer<typeof GetBookOutlineInputSchema>

export const SaveBookOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string(),
  expectedVersion: z.number().int().min(1).optional(),
  state: OutlineStateSchema.optional(),
  sourceVersions: z.record(z.string(), z.number().int()).optional()
})
export type SaveBookOutlineInput = z.infer<typeof SaveBookOutlineInputSchema>

export const ConfirmBookOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type ConfirmBookOutlineInput = z.infer<typeof ConfirmBookOutlineInputSchema>

export const VolumeOutlineSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  position: z.number().int().nonnegative(),
  content: z.string(),
  version: z.number().int().min(1),
  state: OutlineStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type VolumeOutline = z.infer<typeof VolumeOutlineSchema>

export const ListVolumeOutlinesInputSchema = z.object({
  sessionId: z.string().uuid()
})
export type ListVolumeOutlinesInput = z.infer<typeof ListVolumeOutlinesInputSchema>

export const GetVolumeOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  volumeId: z.string().uuid()
})
export type GetVolumeOutlineInput = z.infer<typeof GetVolumeOutlineInputSchema>

export const CreateVolumeOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  content: z.string().default('')
})
export type CreateVolumeOutlineInput = z.infer<typeof CreateVolumeOutlineInputSchema>

export const UpdateVolumeOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  volumeId: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().optional(),
  state: OutlineStateSchema.optional(),
  expectedVersion: z.number().int().min(1)
})
export type UpdateVolumeOutlineInput = z.infer<typeof UpdateVolumeOutlineInputSchema>

export const DeleteVolumeOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  volumeId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteVolumeOutlineInput = z.infer<typeof DeleteVolumeOutlineInputSchema>

export const ReorderVolumeOutlinesInputSchema = z.object({
  sessionId: z.string().uuid(),
  volumes: z.array(z.object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1)
  })).min(1)
})
export type ReorderVolumeOutlinesInput = z.infer<typeof ReorderVolumeOutlinesInputSchema>

export const ChapterOutlineSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().min(1),
  volumeId: z.string().uuid().nullable(),
  content: z.string(),
  version: z.number().int().min(1),
  state: OutlineStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type ChapterOutline = z.infer<typeof ChapterOutlineSchema>

export const ListChapterOutlinesInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid()
})
export type ListChapterOutlinesInput = z.infer<typeof ListChapterOutlinesInputSchema>

export const GetChapterOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  outlineId: z.string().uuid()
})
export type GetChapterOutlineInput = z.infer<typeof GetChapterOutlineInputSchema>

export const GetLatestChapterOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  chapterId: z.string().uuid()
})
export type GetLatestChapterOutlineInput = z.infer<typeof GetLatestChapterOutlineInputSchema>

export const SaveChapterOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  outlineId: z.string().uuid().optional(),
  chapterId: z.string().uuid(),
  content: z.string(),
  volumeId: z.string().uuid().nullable().optional(),
  state: OutlineStateSchema.optional(),
  expectedVersion: z.number().int().min(1).optional()
})
export type SaveChapterOutlineInput = z.infer<typeof SaveChapterOutlineInputSchema>

export const ConfirmChapterOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  outlineId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type ConfirmChapterOutlineInput = z.infer<typeof ConfirmChapterOutlineInputSchema>

export const DeleteChapterOutlineInputSchema = z.object({
  sessionId: z.string().uuid(),
  outlineId: z.string().uuid(),
  expectedVersion: z.number().int().min(1)
})
export type DeleteChapterOutlineInput = z.infer<typeof DeleteChapterOutlineInputSchema>

export const GenerateBookOutlineDraftInputSchema = z.object({
  sessionId: z.string().uuid(),
  connectionId: z.string().uuid().optional()
})
export type GenerateBookOutlineDraftInput = z.infer<typeof GenerateBookOutlineDraftInputSchema>
