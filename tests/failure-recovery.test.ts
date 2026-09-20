import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { DiagnosticsService } from '../src/main/diagnostics'
import { ensureWritableDirectory } from '../src/main/paths'

describe('Failure Recovery and Edge Cases (SPECS Section 15 & 16.3)', () => {
  it('handles database corruption gracefully and fails integrity check', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-corrupt-test-'))
    const projectPath = join(tempDir, 'corrupt.novelproj')
    const store = new ProjectStore(tempDir)

    try {
      // Write corrupted non-SQLite garbage bytes
      writeFileSync(projectPath, Buffer.from('NOT A VALID SQLITE DATABASE FILE GARBAGE BYTES'))

      let errorThrown = false
      try {
        await store.open(projectPath)
      } catch (error: any) {
        errorThrown = true
        expect(error.code || error.message).toBeDefined()
      }
      expect(errorThrown).toBe(true)
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  })

  it('enforces project path locks and second instance read-only mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-lock-test-'))
    const projectPath = join(tempDir, 'locked.novelproj')
    const store1 = new ProjectStore(join(tempDir, 'data1'))
    const store2 = new ProjectStore(join(tempDir, 'data2'))
    const searchIndex1 = new SearchIndex(store1)
    const chapters1 = new ChapterRepository(store1, searchIndex1)
    const searchIndex2 = new SearchIndex(store2)
    const chapters2 = new ChapterRepository(store2, searchIndex2)

    try {
      store1.create({ destination: projectPath, title: '锁定测试', description: '' }, [
        { title: '第一章', content: '第一章初始正文' }
      ])

      // Instance 1 opens in read-write mode
      const session1 = await store1.open(projectPath)
      expect(session1.mode).toBe('read_write')

      // Instance 2 opens same project -> should fall back to read_only mode
      const session2 = await store2.open(projectPath)
      expect(session2.mode).toBe('read_only')
      expect(session2.readOnlyReason).toBe('locked')

      // Modifying from read_only instance 2 must be rejected
      const list2 = chapters2.list(session2.sessionId)
      expect(() => {
        chapters2.update(session2.sessionId, list2[0].id, '非法写入', list2[0].version)
      }).toThrow(expect.objectContaining({ code: 'PROJECT_READ_ONLY' }))

      // Instance 1 can still write normally
      const list1 = chapters1.list(session1.sessionId)
      const updated1 = chapters1.update(session1.sessionId, list1[0].id, '合法写入', list1[0].version)
      expect(updated1.content).toBe('合法写入')

      await store1.close(session1.sessionId)
      await store2.close(session2.sessionId)
    } finally {
      try {
        await store1.closeAll()
        await store2.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  })

  it('detects search_revision != indexed_revision after crash simulation and recovers with manual rebuild', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-rebuild-test-'))
    const projectPath = join(tempDir, 'rebuild.novelproj')
    const store = new ProjectStore(tempDir)
    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)

    try {
      store.create({ destination: projectPath, title: '重建测试', description: '' }, [
        { title: '第一章', content: '昆仑山巅，大雪纷飞。' }
      ])

      const opened = await store.open(projectPath)
      const sessionId = opened.sessionId
      await searchIndex.sync(sessionId)

      const status1 = searchIndex.getStatus(sessionId)
      expect(status1.state).toBe('current')
      expect(status1.searchRevision).toBe(status1.indexedRevision)

      // Simulate crash after author transaction by manually advancing search_revision in SQLite DB
      store.transaction(sessionId, (db) => {
        db.prepare('UPDATE project_meta SET search_revision = search_revision + 5').run()
      })

      const statusAfterCrash = searchIndex.getStatus(sessionId)
      expect(statusAfterCrash.state).toBe('needs_rebuild')
      expect(statusAfterCrash.searchRevision).toBeGreaterThan(statusAfterCrash.indexedRevision)

      // Execute manual rebuild
      await searchIndex.rebuild(sessionId)

      const statusAfterRebuild = searchIndex.getStatus(sessionId)
      expect(statusAfterRebuild.state).toBe('current')
      expect(statusAfterRebuild.searchRevision).toBe(statusAfterRebuild.indexedRevision)

      await store.close(sessionId)
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  })

  it('handles missing model connection and unresolved task routes safely', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-conn-test-'))
    const projectPath = join(tempDir, 'unresolved.novelproj')
    const connStore = new ConnectionStore(tempDir)
    const store = new ProjectStore(tempDir, connStore)

    try {
      store.create({ destination: projectPath, title: '无连接测试', description: '' }, [
        { title: '第一章', content: '正文内容' }
      ])

      const opened = await store.open(projectPath)
      // Task routes should return unresolved when no connections exist
      for (const route of opened.taskRoutes) {
        expect(route.resolution).toBe('unresolved')
      }

      await store.close(opened.sessionId)
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  })

  it('manages session detailed logging and guarantees cleanup', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-diag-test-'))
    const diagnostics = new DiagnosticsService(tempDir)

    try {
      const stateInitial = diagnostics.getLogState()
      expect(stateInitial.detailedLoggingEnabled).toBe(false)

      diagnostics.setDetailedLogging(true)
      const stateEnabled = diagnostics.getLogState()
      expect(stateEnabled.detailedLoggingEnabled).toBe(true)
      expect(stateEnabled.logDirectory).toBeDefined()

      diagnostics.clearDetailedLogs()
      diagnostics.cleanUp()

      expect(existsSync(stateEnabled.logDirectory)).toBe(false)
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  })
})
