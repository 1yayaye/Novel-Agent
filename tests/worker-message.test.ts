import { describe, expect, it } from 'vitest'
import { WorkerRequestSchema, WorkerResponseSchema } from '../src/shared/worker-message'

describe('worker messages', () => {
  it('accepts only the phase-0 ping protocol', () => {
    expect(WorkerRequestSchema.parse({ type: 'ping' })).toEqual({ type: 'ping' })
    expect(WorkerResponseSchema.parse({ type: 'pong' })).toEqual({ type: 'pong' })
    expect(() => WorkerRequestSchema.parse({ type: 'write-project' })).toThrow()
  })
})
