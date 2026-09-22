import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { parseImport } from '../src/main/import-parser'
import { ProjectStore } from '../src/main/project-store'
import { count } from '../src/shared/text-counter'

const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-chapter-${randomUUID()}`); mkdirSync(folder); folders.push(folder)
  const data = join(folder, 'data'); mkdirSync(data)
  const project = join(folder, 'story.novelproj'); const store = new ProjectStore(data)
  store.create({ destination: project, title: '测试', description: '' }, [{ title: '第一章', content: '甲乙丙' }, { title: '第二章', content: '丁戊己' }])
  return { folder, project, store }
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('import parser', () => {
  it('detects UTF encodings, GB18030, markdown and Chinese chapter lines', () => {
    const folder = join(tmpdir(), `novel-agent-import-${randomUUID()}`); mkdirSync(folder); folders.push(folder)
    const markdown = join(folder, 'story.md'); writeFileSync(markdown, '# 开篇\r\n甲\r\n\r\n第二章：相遇\r\n乙')
    expect(parseImport(markdown)).toMatchObject({ encoding: 'utf8', confidence: 'high', chapters: [{ title: '开篇', content: '甲' }, { title: '第二章：相遇', content: '乙' }] })
    const utf16 = join(folder, 'utf16.txt'); writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章\n正文', 'utf16le')]))
    expect(parseImport(utf16)).toMatchObject({ encoding: 'utf16le', confidence: 'high', chapters: [{ title: '第一章', content: '正文' }] })
    const gb = join(folder, 'gb.txt'); writeFileSync(gb, Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xd5, 0xfd, 0xce, 0xc4]))
    expect(parseImport(gb)).toMatchObject({ encoding: 'gb18030', confidence: 'low', chapters: [{ title: '第一章', content: '正文' }] })
  })

  it('preserves markdown preambles, ignores markdown syntax in TXT, and rejects invalid bytes', () => {
    const folder = join(tmpdir(), `novel-agent-import-edge-${randomUUID()}`); mkdirSync(folder); folders.push(folder)
    const markdown = join(folder, 'preamble.md'); writeFileSync(markdown, '序言内容\n\n# 第一章\n正文')
    expect(parseImport(markdown).chapters).toEqual([{ title: '正文', content: '序言内容' }, { title: '第一章', content: '正文' }])
    const text = join(folder, 'plain.txt'); writeFileSync(text, '# 不是章节\n正文')
    expect(parseImport(text).chapters).toEqual([{ title: '正文', content: '# 不是章节\n正文' }])
    const prose = join(folder, 'prose.txt'); writeFileSync(prose, '第一章：开始\n正文\n第二章内容')
    expect(parseImport(prose).chapters).toEqual([{ title: '第一章：开始', content: '正文\n第二章内容' }])
    const invalid = join(folder, 'broken.txt'); writeFileSync(invalid, Buffer.from([0xef, 0xbb, 0xbf, 0xff]))
    expect(() => parseImport(invalid)).toThrow(expect.objectContaining({ code: 'FILE_ENCODING_UNKNOWN' }))
    expect(() => parseImport(join(folder, 'missing.txt'))).toThrow(expect.objectContaining({ code: 'IMPORT_INVALID' }))
  })
})

describe('ChapterRepository', () => {
  it('persists confirmed import drafts atomically and retains order after reopening', async () => {
    const { project, store } = fixture(); const opened = await store.open(project); const repository = new ChapterRepository(store)
    const listed = repository.list(opened.sessionId)
    expect(listed.every((item) => !Object.prototype.hasOwnProperty.call(item, 'content'))).toBe(true)
    expect(listed.map(({ title, position, characterCount }) => [title, position, characterCount])).toEqual([['第一章', 0, count('甲乙丙')], ['第二章', 1, count('丁戊己')]])
    expect(listed.map(({ id }) => repository.get(opened.sessionId, id).content)).toEqual(['甲乙丙', '丁戊己'])
    store.close(opened.sessionId)
    const reopened = await store.open(project)
    const reopenedList = repository.list(reopened.sessionId)
    expect(reopenedList.map(({ title, position, characterCount }) => [title, position, characterCount])).toEqual([['第一章', 0, count('甲乙丙')], ['第二章', 1, count('丁戊己')]])
    expect(reopenedList.map(({ id }) => repository.get(reopened.sessionId, id).content)).toEqual(['甲乙丙', '丁戊己'])
    store.close(reopened.sessionId)
  })

  it('enforces versions and supports create, rename, split, merge, reorder and soft delete', async () => {
    const { project, store } = fixture(); const opened = await store.open(project); const repository = new ChapterRepository(store)
    let chapters = repository.list(opened.sessionId); const first = chapters[0]
    const updated = repository.update(opened.sessionId, first.id, '甲😀乙丙', first.version)
    expect(() => repository.update(opened.sessionId, first.id, '旧写入', first.version)).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))
    await expect(repository.split(opened.sessionId, first.id, 2, '第二段', updated.version)).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    chapters = await repository.split(opened.sessionId, first.id, 3, '第二段', updated.version)
    expect(chapters.map(({ title, characterCount }) => [title, characterCount])).toEqual([['第一章', count('甲😀')], ['第二段', count('乙丙')], ['第二章', count('丁戊己')]])
    expect(chapters.map(({ id }) => repository.get(opened.sessionId, id).content)).toEqual(['甲😀', '乙丙', '丁戊己'])
    chapters = await repository.merge(opened.sessionId, chapters[0].id, chapters[0].version, chapters[1].version)
    expect(repository.get(opened.sessionId, chapters[0].id).content).toBe('甲😀\n\n乙丙')
    chapters = await repository.merge(opened.sessionId, chapters[0].id, chapters[0].version, chapters[1].version)
    expect(chapters).toHaveLength(1)
    expect(repository.get(opened.sessionId, chapters[0].id).content).toContain('丁戊己')
    const created = repository.create(opened.sessionId, '尾章', '终')
    chapters = repository.reorder(opened.sessionId, [...repository.list(opened.sessionId)].reverse().map(({ id, version }) => ({ id, expectedVersion: version })))
    expect(chapters[0].id).toBe(created.id)
    expect(repository.delete(opened.sessionId, created.id, chapters[0].version)).toEqual({ success: true })
    expect(repository.list(opened.sessionId).some(({ id }) => id === created.id)).toBe(false)
    store.close(opened.sessionId)
  })

  it('invalidates derived records and increments search revision in the same chapter transaction', async () => {
    const { project, store } = fixture(); const opened = await store.open(project); const repository = new ChapterRepository(store); const item = repository.list(opened.sessionId)[0]
    store.transaction(opened.sessionId, (database) => {
      database.prepare("INSERT INTO content_chunk(id,source_type,source_id,chapter_id,chapter_version,chunk_kind,content,state,created_at) VALUES ('chunk','chapter',?,?,1,'temporary','甲','current',1)").run(item.id, item.id)
      database.prepare("INSERT INTO source_evidence(id,owner_type,owner_id,chapter_id,chapter_version,start_offset,end_offset,excerpt,state,created_at) VALUES ('evidence','x','x',?,1,0,1,'甲','valid',1)").run(item.id)
    })
    repository.update(opened.sessionId, item.id, '新正文', item.version)
    const database = new Database(project, { readonly: true })
    try {
      expect(database.prepare('SELECT state FROM content_chunk').get()).toEqual({ state: 'stale' })
      expect(database.prepare('SELECT state FROM source_evidence').get()).toEqual({ state: 'stale' })
      expect(database.prepare('SELECT search_revision, indexed_revision FROM project_meta').get()).toEqual({ search_revision: 2, indexed_revision: 0 })
    } finally { database.close() }
    store.close(opened.sessionId)
  })

  it('keeps content-derived records current for rename and reorders without extra search revisions', async () => {
    const { project, store } = fixture(); const opened = await store.open(project); const repository = new ChapterRepository(store); const [first, second] = repository.list(opened.sessionId)
    store.transaction(opened.sessionId, (database) => database.prepare("INSERT INTO content_chunk(id,source_type,source_id,chapter_id,chapter_version,chunk_kind,content,state,created_at) VALUES ('keep','chapter',?,?,1,'temporary','甲','current',1)").run(first.id, first.id))
    const renamed = repository.rename(opened.sessionId, first.id, '新标题', first.version)
    const reordered = repository.reorder(opened.sessionId, [{ id: second.id, expectedVersion: second.version }, { id: renamed.id, expectedVersion: renamed.version }])
    const database = new Database(project, { readonly: true })
    try {
      expect(database.prepare('SELECT state FROM content_chunk').get()).toEqual({ state: 'current' })
      expect(database.prepare('SELECT search_revision FROM project_meta').get()).toEqual({ search_revision: 2 })
      expect(reordered.map(({ position }) => position)).toEqual([0, 1])
    } finally { database.close() }
    store.close(opened.sessionId)
  })

  it('supports special character project titles and exposes dataDirectory', () => {
    const { folder, store } = fixture()
    expect(store.dataDirectory).toBe(join(folder, 'data'))
    const specialProject = join(folder, 'data', 'projects', '《末世：寝取校花，物资无限！》.novelproj')
    mkdirSync(join(folder, 'data', 'projects'), { recursive: true })
    const summary = store.create({ destination: specialProject, title: '《末世：寝取校花，物资无限！》', description: '' })
    expect(summary.title).toBe('《末世：寝取校花，物资无限！》')
    expect(existsSync(specialProject)).toBe(true)
  })
})
