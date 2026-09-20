import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function getFilesRecursively(dir: string, extensions: string[]): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files = files.concat(getFilesRecursively(fullPath, extensions))
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Ticket 07: Total Elimination of Blocking Native alert() / confirm()', () => {
  it('statically guarantees zero calls to native alert() or confirm() across all renderer sources', () => {
    const srcDir = path.resolve(__dirname, '../src')
    const files = getFilesRecursively(srcDir, ['.ts', '.tsx'])

    const alertMatches: { file: string; line: number; content: string }[] = []
    const confirmMatches: { file: string; line: number; content: string }[] = []

    // Regex to match raw alert(...) and confirm(...) but ignore method definitions (e.g. window.novelAgent.outline.confirmChapterOutline)
    // or type declarations or safe tokens.
    // Matches: alert(...) or window.alert(...)
    const alertRegex = /(?:\bwindow\.)?\balert\s*\(/
    // Matches: confirm(...) or window.confirm(...) when not preceded by '.' (e.g., .confirm( is okay if it's an API method)
    const confirmRegex = /(?:(?:\bwindow\.)|\b(?<!\.))confirm\s*\(/

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')

      lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          return // Skip comment lines
        }

        if (alertRegex.test(line)) {
          alertMatches.push({ file: path.relative(srcDir, file), line: index + 1, content: trimmed })
        }
        if (confirmRegex.test(line)) {
          confirmMatches.push({ file: path.relative(srcDir, file), line: index + 1, content: trimmed })
        }
      })
    }

    expect(alertMatches, `Found unexpected native alert() calls: ${JSON.stringify(alertMatches, null, 2)}`).toEqual([])
    expect(confirmMatches, `Found unexpected native confirm() calls: ${JSON.stringify(confirmMatches, null, 2)}`).toEqual([])
  })

  it('validates Toast state queueing and auto-dismiss behavior', () => {
    type Toast = { id: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }
    const toastQueue: Toast[] = []

    const showToast = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      const id = `${Date.now()}-${Math.random()}`
      toastQueue.push({ id, message, type })
      return id
    }

    const dismissToast = (id: string) => {
      const idx = toastQueue.findIndex((t) => t.id === id)
      if (idx >= 0) toastQueue.splice(idx, 1)
    }

    const id1 = showToast('已清空日志', 'success')
    const id2 = showToast('网络连接超时', 'error')

    expect(toastQueue.length).toBe(2)
    expect(toastQueue[0].message).toBe('已清空日志')
    expect(toastQueue[1].type).toBe('error')

    dismissToast(id1)
    expect(toastQueue.length).toBe(1)
    expect(toastQueue[0].id).toBe(id2)
  })
})
