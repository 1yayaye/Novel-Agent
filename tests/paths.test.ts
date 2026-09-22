import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataDirectory, novelsDirectory } from '../src/main/paths'

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

  it('keeps development data outside the source tree in test runner', () => {
    expect(dataDirectory('C:\\Novel Agent\\Novel Agent.exe', false)).not.toContain('小说工作流')
  })

  it('defaults to cwd data directory in development mode outside test runner', () => {
    const originalNodeEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      expect(dataDirectory('C:\\Novel Agent\\Novel Agent.exe', false)).toBe(join(process.cwd(), 'data'))
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('creates and returns the novels subdirectory under dataDirectory', () => {
    const tempDir = join(process.cwd(), 'test-results', 'temp-data-dir')
    const novelsDir = novelsDirectory(tempDir)
    expect(novelsDir).toBe(join(tempDir, 'novels'))
  })
})
