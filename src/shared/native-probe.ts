import { z } from 'zod'

export const NativeProbeResultSchema = z.object({
  betterSqlite3: z.literal(true),
  sqliteVersion: z.string().min(1),
  fts5Trigram: z.literal(true),
  sqliteVec: z.literal(true),
  vecVersion: z.string().min(1),
  vecKnn: z.literal(true),
  worker: z.literal(true),
  projectPath: z.string().endsWith('.novelproj'),
  sqliteVecPath: z.string().min(1)
})

export type NativeProbeResult = z.infer<typeof NativeProbeResultSchema>
