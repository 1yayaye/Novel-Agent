import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'

const folders: string[] = []
function fixture(projectName = 'Story.novelproj') {
  const folder = join(tmpdir(), `novel-agent-outline-test-${randomUUID()}`)
  mkdirSync(folder, { recursive: true })
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data, { recursive: true })
  return { folder, data, project: join(folder, projectName) }
}

let activeStore: ProjectStore | undefined

afterEach(async () => {
  if (activeStore) {
    await activeStore.closeAll()
    activeStore = undefined
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('T01: Outline Database, CRUD, Optimistic Locks & Stale Invalidation', () => {
  it('performs CRUD, versioning and confirmation on BookOutline', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    activeStore = store
    store.create({ destination: project, title: '测试大纲作品', description: '' })
    const opened = await store.open(project)
    const { sessionId } = opened

    // Initially null
    expect(store.getBookOutline(sessionId)).toBeNull()

    // Save initial draft
    const draft = store.saveBookOutline(sessionId, { content: '# 全书主线\n主角踏上修真之路。' })
    expect(draft).toMatchObject({
      id: expect.any(String),
      content: '# 全书主线\n主角踏上修真之路。',
      version: 1,
      state: 'draft'
    })

    // Read back
    expect(store.getBookOutline(sessionId)).toEqual(draft)

    // Update with expectedVersion
    const v2 = store.saveBookOutline(sessionId, { content: '# 全书主线\n主角踏上修真之路，偶得神器。', expectedVersion: 1 })
    expect(v2.version).toBe(2)
    expect(v2.content).toContain('偶得神器')

    // Optimistic lock conflict
    expect(() => store.saveBookOutline(sessionId, { content: '冲突', expectedVersion: 1 })).toThrowError(/覆盖/)

    // Confirm book outline
    const confirmed = store.confirmBookOutline(sessionId, 2)
    expect(confirmed.state).toBe('confirmed')
    expect(confirmed.version).toBe(3)

    // Confirm with wrong version throws
    expect(() => store.confirmBookOutline(sessionId, 2)).toThrowError(/覆盖/)

    store.close(sessionId)
    activeStore = undefined
  })

  it('performs CRUD and reordering on VolumeOutline', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    activeStore = store
    store.create({ destination: project, title: '分卷测试', description: '' })
    const opened = await store.open(project)
    const { sessionId } = opened

    // Create 3 volumes
    const vol1 = store.createVolumeOutline(sessionId, { title: '第一卷 凡人篇', content: '凡尘历练' })
    const vol2 = store.createVolumeOutline(sessionId, { title: '第二卷 宗门篇', content: '进入七玄门' })
    const vol3 = store.createVolumeOutline(sessionId, { title: '第三卷 结丹篇', content: '结成金丹' })

    expect(vol1.position).toBe(0)
    expect(vol2.position).toBe(1)
    expect(vol3.position).toBe(2)

    const list = store.listVolumeOutlines(sessionId)
    expect(list).toHaveLength(3)
    expect(list.map((v) => v.title)).toEqual(['第一卷 凡人篇', '第二卷 宗门篇', '第三卷 结丹篇'])

    // Update volume
    const updatedVol2 = store.updateVolumeOutline(sessionId, vol2.id, { title: '第二卷 宗门试炼' }, vol2.version)
    expect(updatedVol2.title).toBe('第二卷 宗门试炼')
    expect(updatedVol2.version).toBe(2)

    // Reorder volumes
    const reordered = store.reorderVolumeOutlines(sessionId, [
      { id: vol3.id, expectedVersion: vol3.version },
      { id: vol1.id, expectedVersion: vol1.version },
      { id: vol2.id, expectedVersion: updatedVol2.version }
    ])
    expect(reordered.map((v) => v.id)).toEqual([vol3.id, vol1.id, vol2.id])
    expect(reordered.map((v) => v.position)).toEqual([0, 1, 2])

    // Delete volume
    store.deleteVolumeOutline(sessionId, vol1.id, reordered[1].version)
    const remaining = store.listVolumeOutlines(sessionId)
    expect(remaining).toHaveLength(2)
    expect(remaining.map((v) => v.position)).toEqual([0, 1])

    store.close(sessionId)
    activeStore = undefined
  })

  it('performs CRUD, versioning, confirmation and chapter update stale cascading on ChapterOutline', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    activeStore = store
    store.create({ destination: project, title: '章大纲测试', description: '' }, [
      { title: '第一章 启程', content: '韩立背着行囊出发。' }
    ])
    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)

    const opened = await store.open(project)
    const { sessionId } = opened

    const chap1 = chapters.list(sessionId)[0]

    // Create draft chapter outline
    const outline1 = store.saveChapterOutline(sessionId, {
      chapterId: chap1.id,
      content: '【目标】离开家乡\n【场景】村口告别\n【冲突】盘缠不足'
    })
    expect(outline1.state).toBe('draft')
    expect(outline1.chapterVersion).toBe(chap1.version)

    // Confirm chapter outline
    const confirmedOutline = store.confirmChapterOutline(sessionId, outline1.id, outline1.version)
    expect(confirmedOutline.state).toBe('confirmed')

    // Create another draft outline
    const outline2 = store.saveChapterOutline(sessionId, {
      chapterId: chap1.id,
      content: '【新方案】夜间悄悄启程'
    })
    expect(outline2.state).toBe('draft')

    // Confirm outline2, should mark previous confirmed outline as stale
    const confirmedOutline2 = store.confirmChapterOutline(sessionId, outline2.id, outline2.version)
    expect(confirmedOutline2.state).toBe('confirmed')
    const oldOutline = store.getChapterOutline(sessionId, outline1.id)
    expect(oldOutline.state).toBe('stale')

    // Latest returns confirmed outline
    const latest = store.getLatestChapterOutline(sessionId, chap1.id)
    expect(latest?.id).toBe(outline2.id)

    // Modify chapter content -> chapter_outline is marked stale, but book_outline is preserved (ADR 0001)
    store.saveBookOutline(sessionId, { content: '全书概要' })
    chapters.update(sessionId, chap1.id, '韩立在清晨悄然离开家乡，踏上漫漫征途。', chap1.version)

    const afterEditOutline = store.getChapterOutline(sessionId, outline2.id)
    expect(afterEditOutline.state).toBe('stale')

    const afterEditBookOutline = store.getBookOutline(sessionId)
    expect(afterEditBookOutline?.state).toBe('draft')

    store.close(sessionId)
    activeStore = undefined
  })
})
