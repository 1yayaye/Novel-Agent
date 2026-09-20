import { z } from 'zod'

export const WorkerPingRequestSchema = z.object({ type: z.literal('ping') })
export const WorkerDiffRequestSchema = z.object({
  type: z.literal('diff'),
  orig: z.string(),
  cand: z.string()
})
export const WorkerRequestSchema = z.discriminatedUnion('type', [
  WorkerPingRequestSchema,
  WorkerDiffRequestSchema
])

export const WorkerPongResponseSchema = z.object({ type: z.literal('pong') })
export const WorkerDiffResponseSchema = z.object({
  type: z.literal('diff-result'),
  matches: z.array(z.object({ aIndex: z.number(), bIndex: z.number() }))
})
export const WorkerResponseSchema = z.discriminatedUnion('type', [
  WorkerPongResponseSchema,
  WorkerDiffResponseSchema
])

export type WorkerRequest = z.infer<typeof WorkerRequestSchema>
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>
