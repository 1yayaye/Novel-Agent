import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseIpcInput, parseIpcOutput } from '../src/shared/ipc-parse'

describe('IPC parsing modes', () => {
  const inputSchema = z.object({ value: z.string() })
  const outputSchema = z.object({ value: z.string() })

  it('keeps input validation in production and skips output validation', () => {
    expect(() => parseIpcInput(inputSchema, { value: 1 })).toThrow()
    expect(() => parseIpcOutput(outputSchema, { value: 1 })).toThrow()

    vi.stubEnv('NODE_ENV', 'production')
    try {
      const invalidOutput = { value: 1 }
      expect(parseIpcOutput(outputSchema, invalidOutput)).toBe(invalidOutput)
      expect(() => parseIpcInput(inputSchema, { value: 1 })).toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
