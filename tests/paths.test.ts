import { describe, expect, it } from 'vitest'
import { dataDirectory } from '../src/main/paths'

describe('dataDirectory', () => {
  it('keeps packaged data beside the executable', () => {
    expect(dataDirectory('C:\\Novel Agent\\Novel Agent.exe', true)).toBe('C:\\Novel Agent\\data')
  })

  it('uses PORTABLE_EXECUTABLE_DIR when running in portable mode', () => {
    const original = process.env.PORTABLE_EXECUTABLE_DIR
    try {
      process.env.PORTABLE_EXECUTABLE_DIR = 'D:\\MyPortableApp'
      expect(dataDirectory('C:\\Temp\\nsis_temp\\Novel Agent.exe', true)).toBe('D:\\MyPortableApp\\data')
    } finally {
      if (original !== undefined) process.env.PORTABLE_EXECUTABLE_DIR = original
      else delete process.env.PORTABLE_EXECUTABLE_DIR
    }
  })

  it('keeps development data outside the source tree', () => {
    expect(dataDirectory('C:\\Novel Agent\\Novel Agent.exe', false)).not.toContain('小说工作流')
  })
})
