import { accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function dataDirectory(executablePath: string, isPackaged: boolean): string {
  if (process.env.NOVEL_AGENT_DATA_PATH) return process.env.NOVEL_AGENT_DATA_PATH
  if (!isPackaged) {
    if (process.env.NODE_ENV === 'test') return join(tmpdir(), 'novel-agent-dev')
    return join(process.cwd(), 'data')
  }
  const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(executablePath)
  return join(baseDir, 'data')
}

export function novelsDirectory(dataPath: string): string {
  const dir = join(dataPath, 'novels')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function ensureWritableDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true })
  accessSync(directory, constants.W_OK)
  const probePath = join(directory, `.write-probe-${process.pid}-${Date.now()}`)
  writeFileSync(probePath, '')
  unlinkSync(probePath)
}
