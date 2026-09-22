import { z } from 'zod'
import { ipcResultSchema } from './contracts/system'

export function shouldParseIpcOutput(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function parseIpcInput<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value)
}

export function parseIpcOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  if (!shouldParseIpcOutput()) return value as T
  return schema.parse(value)
}

export function parseIpcResult<T>(schema: z.ZodType<T>, value: unknown): z.infer<ReturnType<typeof ipcResultSchema<z.ZodType<T>>>> {
  if (!shouldParseIpcOutput()) return value as never
  return ipcResultSchema(schema).parse(value)
}
