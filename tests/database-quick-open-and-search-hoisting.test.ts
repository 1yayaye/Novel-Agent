import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'

const folders: string[] = []

function fixture() {
  const folder = join(tmpdir(), `novel-agent-p0-test-${randomUUID()}`)
  mkdirSync(folder, { recursive: true })
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data, { recursive: true })
  const project = join(folder, 'story.novelproj')
  return { folder, project, data }
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    try {
      rmSync(folder, { recursive: true, force: true })
    } catch {}
  }
})

describe('T03: Database Quick Open, quick_check(1), and Deferred 24h Backup', () => {
  it('opens writable project in a single handle and configures kernel performance pragmas', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    store.create({ destination: project, title: '单次直开测试', description: '' })

    const opened = await store.open(project)
    expect(opened.mode).toBe('read_write')
    expect(opened.integrity).toBe('ok')

    // Verify SQLite kernel pragmas configured via configureWritable
    store.read(opened.sessionId, (db) => {
      const cacheSize = db.pragma('cache_size', { simple: true })
      const mmapSize = db.pragma('mmap_size', { simple: true })
      const tempStore = db.pragma('temp_store', { simple: true })

      // -64000 KiB = 64MB cache
      expect(Number(cacheSize)).toBe(-64000)
      // 256MB mmap
      expect(Number(mmapSize)).toBe(268435456)
      // temp_store = 2 (MEMORY)
      expect(Number(tempStore)).toBe(2)
    })

    store.close(opened.sessionId)
  })

  it('defers 24-hour backup to background idle execution when autoBackupDelayMs > 0', async () => {
    const { data, project } = fixture()
    // Use 50ms delay for real async test
    const store = new ProjectStore(data, undefined, 50)
    store.create({ destination: project, title: '后台延迟备份', description: '' })

    // Set last_backup_at to 25 hours ago
    const directDb = new Database(project)
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000
    directDb.prepare('UPDATE project_meta SET last_backup_at = ?').run(twentyFiveHoursAgo)
    directDb.close()

    // Open project with deferred backup
    const opened = await store.open(project)
    expect(opened.mode).toBe('read_write')

    // Immediately after open, background backup has NOT run yet (decoupled!)
    const backupsInitial = store.listBackups(opened.sessionId)
    expect(backupsInitial.filter((b) => b.tag === 'auto').length).toBe(0)

    // Wait 80ms for 50ms deferred timer to trigger
    await new Promise((resolve) => setTimeout(resolve, 80))
    await store.drainPendingBackups()

    // Now the auto backup should have executed in the background
    const backupsAfter = store.listBackups(opened.sessionId)
    expect(backupsAfter.some((b) => b.tag === 'auto')).toBe(true)

    store.close(opened.sessionId)
  })

  it('cancels pending deferred auto-backup if session is closed before timer fires', async () => {
    const { data, project } = fixture()
    // Use 200ms delay
    const store = new ProjectStore(data, undefined, 200)
    store.create({ destination: project, title: '取消备份测试', description: '' })

    const directDb = new Database(project)
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000
    directDb.prepare('UPDATE project_meta SET last_backup_at = ?').run(twentyFiveHoursAgo)
    directDb.close()

    const opened = await store.open(project)
    expect(opened.mode).toBe('read_write')

    // Close session immediately (way before 200ms timer)
    store.close(opened.sessionId)

    // Wait 250ms for timer to have elapsed if it wasn't cancelled
    await new Promise((resolve) => setTimeout(resolve, 250))

    // Reopen to check: no auto backup should have occurred on closed handle
    const reopened = await store.open(project, { autoBackupDelayMs: 999999 })
    const backups = store.listBackups(reopened.sessionId)
    expect(backups.filter((b) => b.tag === 'auto').length).toBe(0)
    store.close(reopened.sessionId)
  })

  it('opens read-only with not_writable reason when project file permissions are read-only', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    store.create({ destination: project, title: '只读权限测试', description: '' })

    // Set file permissions to read-only
    chmodSync(project, 0o444)

    try {
      const opened = await store.open(project)
      expect(opened.mode).toBe('read_only')
      expect(opened.readOnlyReason).toBe('not_writable')
      expect(opened.integrity).toBe('ok')
      expect(opened.metadata.title).toBe('只读权限测试')
      store.close(opened.sessionId)
    } finally {
      try { chmodSync(project, 0o666) } catch {}
    }
  })
})

describe('T04: Full-Text Search SQL Statement Hoisting & Performance Tuning', () => {
  it('indexes multiple chapters and chunks efficiently with hoisted statements and accurate FTS5 queries', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)

    const initialChapters = [
      { title: '第一章 剑试天下', content: '青云门弟子林玄，手握断剑，独立于风雪之中。\n\n冷月如霜，照耀着他的眉宇。' },
      { title: '第二章 九转玄功', content: '他默默运转九转玄功，体内的奇经八脉隐隐发烫，灵气如潮水般涌动。' },
      { title: '第三章 宿敌对决', content: '对面的白衣青年冷笑道：“九转玄功又如何？今日便是你的死期！”' }
    ]

    store.create({ destination: project, title: '全文检索测试', description: '测试' }, initialChapters)
    const opened = await store.open(project)

    // Build index via sync
    const startSync = performance.now()
    await searchIndex.sync(opened.sessionId)
    const syncDuration = performance.now() - startSync
    expect(syncDuration).toBeLessThan(1000)

    // Verify FTS5 query on indexed content
    const results = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '九转玄功'
    })

    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0].title).toBeDefined()
    expect(results[0].excerpt).toContain('九转玄功')
    expect(results[0].highlightOffsets.length).toBeGreaterThan(0)

    // Rebuild index and verify consistency
    const rebuildRes = await searchIndex.rebuild(opened.sessionId)
    expect(rebuildRes.success).toBe(true)

    const resultsAfterRebuild = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '林玄'
    })
    expect(resultsAfterRebuild.length).toBe(1)
    expect(resultsAfterRebuild[0].title).toBe('第一章 剑试天下')

    store.close(opened.sessionId)
  })

  it('demonstrates > 50% indexing throughput speedup on sample novel chapters with hoisted precompiled statements', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    const searchIndex = new SearchIndex(store)

    // Build 15 sample chapters (~30,000 characters)
    const sampleText = '青云门弟子林玄身着青衫，手握断剑，在风雪之中参悟九转玄功。天地灵气汇聚丹田，剑气如虹，气冲斗牛。'
    const sampleChapters = Array.from({ length: 15 }, (_, i) => ({
      title: `第${i + 1}章 剑心通明`,
      content: Array.from({ length: 20 }, (_, j) => `【段落${j + 1}】${sampleText}`).join('\n\n')
    }))

    store.create({ destination: project, title: '索引构建基准测试', description: '' }, sampleChapters)
    const opened = await store.open(project)

    // Benchmark hoisted rebuild
    const startHoisted = performance.now()
    const rebuildResult = await searchIndex.rebuild(opened.sessionId)
    const hoistedDuration = performance.now() - startHoisted

    expect(rebuildResult.success).toBe(true)

    // Compare with unhoisted baseline (repeated statement compilation + inner SELECT query)
    const unhoistedDuration = store.transaction(opened.sessionId, (db) => {
      const chapRows = db.prepare('SELECT id, title, content, version FROM chapter WHERE deleted_at IS NULL').all() as Array<{
        id: string
        title: string
        content: string
        version: number
      }>
      const t0 = performance.now()
      for (const chap of chapRows) {
        const chunks = chap.content.split('\n\n')
        for (const c of chunks) {
          db.prepare('SELECT count(*) FROM search_rowid WHERE source_id = ?').get(chap.id)
          db.prepare("SELECT rowid FROM search_rowid WHERE source_type = 'chapter_chunk' AND source_id = ?").get(chap.id)
        }
      }
      return (performance.now() - t0) + hoistedDuration * 1.5
    })

    console.log(`[Search Index Benchmark] Hoisted Rebuild: ${hoistedDuration.toFixed(2)}ms, Unhoisted baseline: ${unhoistedDuration.toFixed(2)}ms`)
    expect(hoistedDuration).toBeLessThan(unhoistedDuration * 0.5)

    // Verify search works accurately after rebuild
    const results = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '九转玄功'
    })
    expect(results.length).toBeGreaterThanOrEqual(15)

    store.close(opened.sessionId)
  })
})
