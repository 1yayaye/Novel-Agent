import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copySourceToNovels } from '../src/main/project-ipc'
import { ProjectStore } from '../src/main/project-store'
import { parseImport } from '../src/main/import-parser'

describe('novel import copying to data/novels', () => {
  it('copies external file to data/novels and preserves exact content', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const dataDir = join(tempDir, 'data')
    const externalDir = join(tempDir, 'external')
    mkdirSync(externalDir, { recursive: true })

    const externalFile = join(externalDir, '斗破苍穹.txt')
    const content = '第一章 陨落的天才\n“斗之力，三段！”望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情。'
    writeFileSync(externalFile, content, 'utf8')

    const copiedPath = copySourceToNovels(externalFile, dataDir)

    expect(copiedPath).toBe(join(dataDir, 'novels', '斗破苍穹.txt'))
    expect(existsSync(copiedPath)).toBe(true)
    expect(readFileSync(copiedPath, 'utf8')).toBe(content)
  })

  it('is idempotent and does not duplicate if already inside data/novels', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const dataDir = join(tempDir, 'data')
    const externalDir = join(tempDir, 'external')
    mkdirSync(externalDir, { recursive: true })

    const externalFile = join(externalDir, '凡人修仙传.txt')
    writeFileSync(externalFile, '第一章 山边小村\n山峰高耸入云。', 'utf8')

    const firstCopy = copySourceToNovels(externalFile, dataDir)
    expect(firstCopy).toBe(join(dataDir, 'novels', '凡人修仙传.txt'))

    // Second call with the already-copied path should return the exact same path without creating a (1) duplicate
    const secondCopy = copySourceToNovels(firstCopy, dataDir)
    expect(secondCopy).toBe(firstCopy)
  })

  it('handles name collisions gracefully by generating numbered suffixes', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const dataDir = join(tempDir, 'data')
    const externalDir1 = join(tempDir, 'ext1')
    const externalDir2 = join(tempDir, 'ext2')
    mkdirSync(externalDir1, { recursive: true })
    mkdirSync(externalDir2, { recursive: true })

    const file1 = join(externalDir1, '同名作品.txt')
    const file2 = join(externalDir2, '同名作品.txt')
    writeFileSync(file1, '内容一', 'utf8')
    writeFileSync(file2, '内容二', 'utf8')

    const copy1 = copySourceToNovels(file1, dataDir)
    const copy2 = copySourceToNovels(file2, dataDir)

    expect(copy1).toBe(join(dataDir, 'novels', '同名作品.txt'))
    expect(copy2).toBe(join(dataDir, 'novels', '同名作品 (1).txt'))
    expect(readFileSync(copy1, 'utf8')).toBe('内容一')
    expect(readFileSync(copy2, 'utf8')).toBe('内容二')
  })

  it('throws IMPORT_INVALID when external file does not exist', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const dataDir = join(tempDir, 'data')

    expect(() => copySourceToNovels(join(tempDir, 'non-existent.txt'), dataDir)).toThrow(
      expect.objectContaining({ code: 'IMPORT_INVALID' })
    )
  })

  it('stores sourcePath in ProjectStore create and persists to recent projects', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const store = new ProjectStore(tempDir)
    const projectPath = join(tempDir, 'test.novelproj')
    const sourceCopyPath = join(tempDir, 'novels', 'test.txt')

    const summary = store.create(
      { destination: projectPath, title: '测试作品', description: '', sourcePath: sourceCopyPath },
      [{ title: '第一章', content: '测试内容' }]
    )

    expect(summary.sourcePath).toBe(sourceCopyPath)

    const recent = store.listRecent()
    expect(recent.length).toBe(1)
    expect(recent[0].sourcePath).toBe(sourceCopyPath)
  })

  it('allows full import workflow to succeed even if original external file is removed', () => {
    const tempDir = join(tmpdir(), `novel-agent-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    const dataDir = join(tempDir, 'data')
    const externalDir = join(tempDir, 'external')
    mkdirSync(externalDir, { recursive: true })

    const externalFile = join(externalDir, '遮天.txt')
    writeFileSync(externalFile, '第一章 星空中的九龙拉棺\n冰冷与黑暗并存的宇宙深处，九具庞大的龙尸拉着一口青铜巨棺。', 'utf8')

    // Step 1: Copy to data/novels and parse import
    const copyPath = copySourceToNovels(externalFile, dataDir)
    const preview = parseImport(copyPath)
    expect(preview.source).toBe(copyPath)
    expect(preview.chapters.length).toBe(1)

    // Step 2: Simulate original external file deletion (e.g. user moved or deleted file from Downloads)
    unlinkSync(externalFile)
    expect(existsSync(externalFile)).toBe(false)

    // Step 3: Parse and re-read from copyPath still succeeds completely
    const reloaded = parseImport(preview.source)
    expect(reloaded.chapters[0].title).toBe('第一章 星空中的九龙拉棺')

    // Step 4: Create project referencing the copy in data/novels
    const store = new ProjectStore(dataDir)
    const projectPath = join(dataDir, 'projects', '遮天.novelproj')
    mkdirSync(join(dataDir, 'projects'), { recursive: true })
    const summary = store.create(
      { destination: projectPath, title: preview.suggestedTitle, description: '', sourcePath: preview.source },
      reloaded.chapters
    )
    expect(summary.sourcePath).toBe(copyPath)
    expect(existsSync(projectPath)).toBe(true)
  })
})
