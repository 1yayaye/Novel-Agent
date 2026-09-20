import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ProjectStore } from '../src/main/project-store'

const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-export-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  store.create({ destination: project, title: '导出测试作品', description: '' }, [
    { title: '第一章 启程', content: '这是第一章正文内容。\n有两行。' },
    { title: '第二章 遭遇', content: '这是第二章正文内容。' },
    { title: '第三章 决胜', content: '这是第三章正文内容。' }
  ])
  return { folder, project, store, data }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('Project Export', () => {
  it('exports whole book as UTF-8 TXT without BOM in chapter position order', async () => {
    const { folder, project, store } = fixture()
    const opened = await store.open(project)
    const exportPath = join(folder, 'exported_novel.txt')

    const result = store.exportProject(opened.sessionId, 'txt', undefined, exportPath)
    expect(result.savedPath).toBe(exportPath)
    expect(existsSync(exportPath)).toBe(true)

    const buffer = readFileSync(exportPath)
    // Check no UTF-8 BOM (0xEF, 0xBB, 0xBF)
    expect(buffer[0] !== 0xef || buffer[1] !== 0xbb || buffer[2] !== 0xbf).toBe(true)

    const text = buffer.toString('utf8')
    expect(text).toBe(
      '第一章 启程\n\n这是第一章正文内容。\n有两行。\n\n\n' +
      '第二章 遭遇\n\n这是第二章正文内容。\n\n\n' +
      '第三章 决胜\n\n这是第三章正文内容。'
    )

    store.close(opened.sessionId)
  })

  it('exports whole book as UTF-8 Markdown with ATX h1 headers', async () => {
    const { folder, project, store } = fixture()
    const opened = await store.open(project)
    const exportPath = join(folder, 'exported_novel.md')

    const result = store.exportProject(opened.sessionId, 'md', undefined, exportPath)
    expect(result.savedPath).toBe(exportPath)

    const text = readFileSync(exportPath, 'utf8')
    expect(text).toBe(
      '# 第一章 启程\n\n这是第一章正文内容。\n有两行。\n\n' +
      '# 第二章 遭遇\n\n这是第二章正文内容。\n\n' +
      '# 第三章 决胜\n\n这是第三章正文内容。'
    )

    store.close(opened.sessionId)
  })

  it('exports only selected chapters in correct order and rejects empty selection', async () => {
    const { folder, project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    const chapters = repository.list(opened.sessionId)

    // Export only chapter 3 and chapter 1 (passed in reverse order, should still output in position order)
    const exportPath = join(folder, 'partial.txt')
    store.exportProject(opened.sessionId, 'txt', [chapters[2].id, chapters[0].id], exportPath)

    const text = readFileSync(exportPath, 'utf8')
    expect(text).toBe(
      '第一章 启程\n\n这是第一章正文内容。\n有两行。\n\n\n' +
      '第三章 决胜\n\n这是第三章正文内容。'
    )

    // Reject non-existent chapter IDs
    expect(() => store.exportProject(opened.sessionId, 'txt', [randomUUID()], join(folder, 'empty.txt'))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    )

    store.close(opened.sessionId)
  })

  it('keeps an existing target when replacement fails', async () => {
    const { folder, project, store } = fixture()
    const opened = await store.open(project)
    const target = join(folder, 'existing.txt')
    mkdirSync(target)

    expect(() => store.exportProject(opened.sessionId, 'txt', undefined, target)).toThrow(
      expect.objectContaining({ code: 'EXPORT_FAILED' })
    )
    expect(existsSync(target)).toBe(true)

    store.close(opened.sessionId)
  })

})
