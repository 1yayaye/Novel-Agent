import { describe, expect, it } from 'vitest'
import { NativeProbeResultSchema } from '../src/shared/native-probe'

describe('NativeProbeResult', () => {
  it('rejects incomplete probe data', () => {
    expect(() => NativeProbeResultSchema.parse({ betterSqlite3: true })).toThrow()
  })
})
