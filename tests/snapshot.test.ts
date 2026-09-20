import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ProjectStore } from '../src/main/project-store'

const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-snapshot-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  store.create({ destination: project, title: '快照测试', description: '' }, [
    { title: '第一章', content: '第一章初始正文' },
    { title: '第二章', content: '第二章初始正文' }
  ])
  return { folder, project, store, data }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('Chapter Snapshots', () => {
  it('creates manual snapshots with required name and preserves permanence', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    const chapter = repository.list(opened.sessionId)[0]

    expect(() => repository.createSnapshot(opened.sessionId, chapter.id, chapter.version, '   ')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    )

    const manual = repository.createSnapshot(opened.sessionId, chapter.id, chapter.version, '大纲调整前')
    expect(manual).toMatchObject({
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      title: '第一章',
      name: '大纲调整前',
      snapshotKind: 'manual',
      permanent: true
    })

    const list = repository.listSnapshots(opened.sessionId, chapter.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(manual.id)

    const detail = repository.getSnapshot(opened.sessionId, manual.id)
    expect(detail.content).toBe('第一章初始正文')

    store.close(opened.sessionId)
  })

  it('rotates ordinary snapshots up to 20 per chapter and retains permanent snapshots', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    let chapter = repository.list(opened.sessionId)[0]

    // Create 1 manual permanent snapshot
    repository.createSnapshot(opened.sessionId, chapter.id, chapter.version, '重要里程碑')

    // Create 25 ordinary snapshots by modifying content
    for (let i = 1; i <= 25; i++) {
      chapter = repository.update(opened.sessionId, chapter.id, `正文版本 ${i}`, chapter.version)
      const ordinary = repository.createOrdinarySnapshot(opened.sessionId, chapter.id, chapter.version)
      expect(ordinary).not.toBeNull()
    }

    // Creating again without content change should return null
    const duplicate = repository.createOrdinarySnapshot(opened.sessionId, chapter.id, chapter.version)
    expect(duplicate).toBeNull()

    const list = repository.listSnapshots(opened.sessionId, chapter.id)
    const ordinaryList = list.filter((s) => s.snapshotKind === 'ordinary')
    const permanentList = list.filter((s) => s.permanent)

    // Ordinary snapshots should be capped at 20
    expect(ordinaryList).toHaveLength(20)
    // Permanent manual snapshot should still exist
    expect(permanentList.some((s) => s.snapshotKind === 'manual')).toBe(true)

    store.close(opened.sessionId)
  })

  it('restores snapshot safely: creates restore snapshot of current content and propagates invalidations', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    const original = repository.list(opened.sessionId)[0]

    const snapshot = repository.createSnapshot(opened.sessionId, original.id, original.version, '原版')

    // Update chapter twice
    const v2 = repository.update(opened.sessionId, original.id, '第二版修改', original.version)
    const v3 = repository.update(opened.sessionId, original.id, '第三版修改', v2.version)

    // Version conflict on restore
    expect(() => repository.restoreSnapshot(opened.sessionId, snapshot.id, v2.version)).toThrow(
      expect.objectContaining({ code: 'VERSION_CONFLICT' })
    )

    // Successful restore
    const restored = repository.restoreSnapshot(opened.sessionId, snapshot.id, v3.version)
    expect(restored.content).toBe('第一章初始正文')
    expect(restored.version).toBe(v3.version + 1)

    // Check that a 'restore' snapshot of v3 content was created
    const snapshots = repository.listSnapshots(opened.sessionId, original.id)
    const restoreSnapshot = snapshots.find((s) => s.snapshotKind === 'restore')
    expect(restoreSnapshot).toBeDefined()
    expect(restoreSnapshot?.permanent).toBe(true)

    const restoreDetail = repository.getSnapshot(opened.sessionId, restoreSnapshot!.id)
    expect(restoreDetail.content).toBe('第三版修改')

    // Check that search revision was incremented
    const database = new Database(project, { readonly: true })
    try {
      const meta = database.prepare('SELECT search_revision FROM project_meta').get() as { search_revision: number }
      expect(meta.search_revision).toBeGreaterThan(3)
    } finally {
      database.close()
    }

    store.close(opened.sessionId)
  })

  it('creates split and merge permanent snapshots before structural modifications', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    const chapters = repository.list(opened.sessionId)

    // Split chapter 1
    const splitChapters = await repository.split(opened.sessionId, chapters[0].id, 4, '第一章后半', chapters[0].version)
    expect(splitChapters).toHaveLength(3)

    const splitSnapshots = repository.listSnapshots(opened.sessionId, chapters[0].id)
    expect(splitSnapshots.some((s) => s.snapshotKind === 'split' && s.permanent)).toBe(true)

    // Merge chapter 1 and 2
    const merged = await repository.merge(
      opened.sessionId,
      splitChapters[0].id,
      splitChapters[0].version,
      splitChapters[1].version
    )
    expect(merged).toHaveLength(2)

    const mergeSnapshotsFirst = repository.listSnapshots(opened.sessionId, splitChapters[0].id)
    expect(mergeSnapshotsFirst.some((s) => s.snapshotKind === 'merge' && s.permanent)).toBe(true)

    const mergeSnapshotsSecond = repository.listSnapshots(opened.sessionId, splitChapters[1].id)
    expect(mergeSnapshotsSecond.some((s) => s.snapshotKind === 'merge' && s.permanent)).toBe(true)

    store.close(opened.sessionId)
  })
})
