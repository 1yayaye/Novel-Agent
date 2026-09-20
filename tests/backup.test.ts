import * as fs from 'node:fs'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ProjectStore } from '../src/main/project-store'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-backup-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  store.create({ destination: project, title: '备份测试作品', description: '简介' }, [
    { title: '第一章', content: '第一章正文' },
    { title: '第二章', content: '第二章正文' }
  ])
  return { folder, project, store, data }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('Project Backup and Recovery', () => {
  it('creates manual backups, rotates to retain at most 5, and updates last_backup_at', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)

    // Create 7 backups
    for (let i = 1; i <= 7; i++) {
      const info = await store.createBackup(opened.sessionId, `v${i}`)
      expect(info.tag).toBe(`v${i}`)
      expect(existsSync(info.path)).toBe(true)
    }

    const backups = store.listBackups(opened.sessionId)
    expect(backups).toHaveLength(5)
    // The latest created should be the first in list
    expect(backups[0].tag).toBe('v7')

    // Check last_backup_at in project_meta
    const database = new Database(project, { readonly: true })
    try {
      const meta = database.prepare('SELECT last_backup_at FROM project_meta').get() as { last_backup_at: number }
      expect(meta.last_backup_at).toBeGreaterThan(0)
    } finally {
      database.close()
    }

    store.close(opened.sessionId)
  })

  it('triggers daily automatic backup on open when last_backup_at is older than 24h', async () => {
    const { project, store } = fixture()
    // Set last_backup_at to 25 hours ago
    const database = new Database(project)
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000
    database.prepare('UPDATE project_meta SET last_backup_at = ?').run(twentyFiveHoursAgo)
    database.close()

    const opened = await store.open(project)
    const backups = store.listBackups(opened.sessionId)
    expect(backups.length).toBeGreaterThanOrEqual(1)
    expect(backups.some((b) => b.tag === 'auto')).toBe(true)

    // Reopening immediately should not create another backup
    const countBefore = backups.length
    store.close(opened.sessionId)
    const reopened = await store.open(project)
    const countAfter = store.listBackups(reopened.sessionId).length
    expect(countAfter).toBe(countBefore)

    store.close(reopened.sessionId)
  })

  it('restores backup safely with pre-restore backup and integrity checks', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const repository = new ChapterRepository(store)
    const chapter = repository.list(opened.sessionId)[0]

    // Create backup of initial state
    const backupInfo = await store.createBackup(opened.sessionId, 'initial')

    // Modify chapter content
    repository.update(opened.sessionId, chapter.id, '已被篡改的正文', chapter.version)
    expect(repository.get(opened.sessionId, chapter.id).content).toBe('已被篡改的正文')

    // Attempt restoring invalid file
    const fakeBackup = join(store.backupDirectory(project), 'broken.novelproj')
    writeFileSync(fakeBackup, 'not a sqlite database')
    await expect(store.restoreBackup(opened.sessionId, fakeBackup)).rejects.toThrow(
      expect.objectContaining({ code: 'DATABASE_ERROR' })
    )

    // Restore from valid backup
    const restoredSession = await store.restoreBackup(opened.sessionId, backupInfo.path)
    expect(restoredSession.integrity).toBe('ok')

    const restoredChapters = repository.list(restoredSession.sessionId)
    expect(restoredChapters[0].content).toBe('第一章正文')

    // Check that pre-restore backup was generated
    const allBackups = store.listBackups(restoredSession.sessionId)
    expect(allBackups.some((b) => b.tag === 'pre-restore')).toBe(true)

    store.close(restoredSession.sessionId)
  })

  it('keeps the original project and session usable when restore replacement fails', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project, { autoBackupDelayMs: 0 })
    const repository = new ChapterRepository(store)
    const chapter = repository.list(opened.sessionId)[0]
    const backupInfo = await store.createBackup(opened.sessionId, 'restore-failure-source')
    repository.update(opened.sessionId, chapter.id, '恢复失败时仍保留的正文', chapter.version)

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const renameMock = vi.mocked(fs.renameSync)
    renameMock.mockImplementation((oldPath, newPath) => {
      if (String(newPath) === project) throw new Error('simulated restore replacement failure')
      return actualFs.renameSync(oldPath, newPath)
    })

    try {
      await expect(store.restoreBackup(opened.sessionId, backupInfo.path)).rejects.toThrow(
        expect.objectContaining({ code: 'DATABASE_ERROR' })
      )
      expect(existsSync(project)).toBe(true)
      expect(repository.get(opened.sessionId, chapter.id).content).toBe('恢复失败时仍保留的正文')
    } finally {
      renameMock.mockImplementation(actualFs.renameSync)
      try { store.close(opened.sessionId) } catch {}
    }
  })

  it('recovers interrupted records when restoring a backup', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project, { autoBackupDelayMs: 0 })
    const chapter = new ChapterRepository(store).list(opened.sessionId)[0]
    const taskId = randomUUID()
    const stepId = randomUUID()
    const candidateId = randomUUID()
    const chatSessionId = randomUUID()
    const messageId = randomUUID()
    const now = Date.now()

    store.transaction(opened.sessionId, (db) => {
      db.prepare(`
        INSERT INTO task(id, type, scope_json, state, cancel_requested, created_at, updated_at)
        VALUES (?, 'chat', '{}', 'running', 0, ?, ?)
      `).run(taskId, now, now)
      db.prepare(`
        INSERT INTO task_step(id, task_id, chapter_id, chapter_version, position, state, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, 'running', 0, ?, ?)
      `).run(stepId, taskId, chapter.id, now, now)
      db.prepare(`
        INSERT INTO candidate(id, task_id, chapter_id, chapter_version, original_content, raw_output, version, state, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, 1, 'streaming', ?, ?)
      `).run(candidateId, taskId, chapter.id, chapter.content, '已落盘的候选片段', now, now)
      db.prepare(`
        INSERT INTO chat_session(id, title, connection_id, version, created_at, updated_at)
        VALUES (?, '恢复测试', NULL, 1, ?, ?)
      `).run(chatSessionId, now, now)
      db.prepare(`
        INSERT INTO chat_message(id, chat_session_id, role, content, state, created_at)
        VALUES (?, ?, 'assistant', ?, 'streaming', ?)
      `).run(messageId, chatSessionId, '已落盘的聊天片段', now)
    })

    try {
      const backupInfo = await store.createBackup(opened.sessionId, 'interrupted-state')
      const restored = await store.restoreBackup(opened.sessionId, backupInfo.path)
      const recovered = store.read(restored.sessionId, (db) => ({
        task: db.prepare('SELECT state FROM task WHERE id = ?').get(taskId) as { state: string },
        step: db.prepare('SELECT state FROM task_step WHERE id = ?').get(stepId) as { state: string },
        candidate: db.prepare('SELECT state, raw_output FROM candidate WHERE id = ?').get(candidateId) as { state: string; raw_output: string },
        message: db.prepare('SELECT state, content FROM chat_message WHERE id = ?').get(messageId) as { state: string; content: string }
      }))

      expect(recovered.task.state).toBe('interrupted')
      expect(recovered.step.state).toBe('pending')
      expect(recovered.candidate).toEqual({ state: 'failed', raw_output: '已落盘的候选片段' })
      expect(recovered.message).toEqual({ state: 'failed', content: '已落盘的聊天片段' })
      store.close(restored.sessionId)
    } finally {
      try { store.close(opened.sessionId) } catch {}
    }
  })

  it('restores the oldest backup without rotating away the selected source', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project, { autoBackupDelayMs: 0 })
    const repository = new ChapterRepository(store)
    const chapter = repository.list(opened.sessionId)[0]
    const backups = []

    for (let i = 0; i < 5; i++) {
      repository.update(opened.sessionId, chapter.id, `历史正文 ${i}`, i + 1)
      backups.push(await store.createBackup(opened.sessionId, `history-${i}`))
    }
    repository.update(opened.sessionId, chapter.id, '恢复前正文', 6)

    const restored = await store.restoreBackup(opened.sessionId, backups[0].path)
    expect(new ChapterRepository(store).list(restored.sessionId)[0].content).toBe('历史正文 0')
    expect(store.listBackups(restored.sessionId)).toHaveLength(5)
    expect(new ChapterRepository(store).list(restored.sessionId)[0].content).not.toBe('恢复前正文')

    store.close(restored.sessionId)
  })

  it('provides safe restricted backup location path', async () => {
    const { project, store } = fixture()
    const opened = await store.open(project)
    const folder = store.openBackupLocation(opened.sessionId)
    expect(existsSync(folder)).toBe(true)
    expect(folder).toContain('backups')
    store.close(opened.sessionId)
  })
})
