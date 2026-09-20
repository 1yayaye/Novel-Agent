import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../src/shared/project'
import { ProjectError, ProjectStore } from '../src/main/project-store'

const folders: string[] = []
function fixture(projectName = 'Story.novelproj') {
  const folder = join(tmpdir(), `novel-agent-store-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  return { folder, data, project: join(folder, projectName) }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('ProjectStore', () => {
  it('creates the complete versioned schema with its required constraints', () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    const summary = store.create({ destination: project, title: '测试作品', description: '简介' })
    expect(summary).toMatchObject({ projectId: expect.any(String), path: resolve(project), title: '测试作品', version: 1, schemaVersion: CURRENT_SCHEMA_VERSION, searchIndexState: 'current' })
    expect(basename(summary.path)).toBe('Story.novelproj')

    const database = new Database(project)
    try {
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>).map(({ name }) => name)
      expect(tables).toEqual(expect.arrayContaining(['project_meta', 'chapter', 'chapter_snapshot', 'style_sample', 'instruction_preset', 'task_route', 'knowledge_entry', 'character_relationship', 'task', 'task_step', 'content_fts', 'search_rowid', 'vector_index_meta', 'candidate', 'chat_session', 'book_outline', 'volume_outline', 'chapter_outline']))
      expect(tables).not.toContain('content_vector')
      expect(database.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
        { version: 1, name: '0001_initial_schema' },
        { version: 2, name: '0002_outline_schema' },
        { version: 3, name: '0003_chat_workflow_schema' },
        { version: 4, name: '0004_context_package_snapshot' }
      ])
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(() => database.prepare("INSERT INTO task(id,type,scope_json,state,cancel_requested,created_at,updated_at) VALUES ('bad','analysis','{}','invalid',0,1,1)").run()).toThrow()
    } finally {
      database.close()
    }
  })

  it('opens, restores interrupted tasks, copies, closes, and remembers a project', async () => {
    const { data, project, folder } = fixture()
    const store = new ProjectStore(data)
    store.create({ destination: project, title: '测试作品', description: '简介' }, [{ title: '第一章', content: '已保存正文' }])
    const now = Date.now()
    const database = new Database(project)
    database.prepare("INSERT INTO task(id,type,scope_json,state,cancel_requested,created_at,updated_at) VALUES ('task','analysis','{}','running',0,?,?)").run(now, now)
    database.prepare("INSERT INTO task_step(id,task_id,position,state,created_at,updated_at) VALUES ('step','task',0,'running',?,?)").run(now, now)
    const chapter = database.prepare('SELECT id FROM chapter LIMIT 1').get() as { id: string }
    database.prepare(`
      INSERT INTO candidate(id, task_id, chapter_id, chapter_version, original_content, raw_output, version, state, created_at, updated_at)
      VALUES ('candidate', 'task', ?, 1, '原始正文', '候选部分输出', 1, 'streaming', ?, ?)
    `).run(chapter.id, now, now)
    database.prepare("INSERT INTO chat_session(id,title,connection_id,version,created_at,updated_at) VALUES ('chat','恢复测试',NULL,1,?,?)").run(now, now)
    database.prepare("INSERT INTO chat_message(id,chat_session_id,role,content,state,created_at) VALUES ('message','chat','assistant','聊天部分输出','streaming',?)").run(now)
    database.close()

    const opened = await store.open(project)
    expect(opened).toMatchObject({ mode: 'read_write', integrity: 'ok', taskRoutes: [] })
    const check = new Database(project, { readonly: true })
    try {
      expect(check.prepare('SELECT state FROM task').get()).toEqual({ state: 'interrupted' })
      expect(check.prepare('SELECT state FROM task_step').get()).toEqual({ state: 'pending' })
      expect(check.prepare('SELECT state, raw_output FROM candidate').get()).toEqual({ state: 'failed', raw_output: '候选部分输出' })
      expect(check.prepare('SELECT state, content FROM chat_message').get()).toEqual({ state: 'failed', content: '聊天部分输出' })
    } finally {
      check.close()
    }

    const copy = join(folder, 'Copy.novelproj')
    expect(await store.saveCopy(opened.sessionId, copy)).toEqual({ savedPath: resolve(copy) })
    const copiedDatabase = new Database(copy, { readonly: true })
    try { expect(copiedDatabase.pragma('integrity_check', { simple: true })).toBe('ok') } finally { copiedDatabase.close() }
    expect(store.close(opened.sessionId)).toEqual({ success: true })
    expect(store.listRecent()).toMatchObject([{ title: '测试作品', isAvailable: true }])
    expect(JSON.parse(readFileSync(join(data, 'recent-projects.json'), 'utf8'))[0]).toEqual(expect.objectContaining({ path: resolve(project), title: '测试作品', lastOpenedAt: expect.any(Number) }))
  })

  it('opens a locked project read-only and rejects its write transaction', async () => {
    const { data, project, folder } = fixture()
    const first = new ProjectStore(data)
    first.create({ destination: project, title: '锁定', description: '' })
    const writable = await first.open(project)
    const second = new ProjectStore(join(folder, 'other-data'))
    const locked = await second.open(project)
    expect(locked).toMatchObject({ mode: 'read_only', readOnlyReason: 'locked' })
    expect(() => second.transaction(locked.sessionId, () => undefined)).toThrow(expect.objectContaining({ code: 'PROJECT_READ_ONLY' }))
    await second.saveCopy(locked.sessionId, join(folder, 'readonly-copy.novelproj'))
    second.close(locked.sessionId)
    first.close(writable.sessionId)
  })

  it('opens a future schema read-only without requiring the current migration record', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    store.create({ destination: project, title: '未来项目', description: '' })
    const database = new Database(project)
    database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`)
    database.prepare('UPDATE project_meta SET schema_version = ?').run(CURRENT_SCHEMA_VERSION + 1)
    database.prepare('DELETE FROM schema_migrations').run()
    database.close()

    const opened = await store.open(project)
    expect(opened).toMatchObject({ mode: 'read_only', readOnlyReason: 'future_schema', integrity: 'ok', metadata: { title: '未来项目', schemaVersion: CURRENT_SCHEMA_VERSION + 1 } })
    store.close(opened.sessionId)
  })

  it('backs up and transactionally migrates an unversioned project', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    store.create({ destination: project, title: '旧项目', description: '' })
    const database = new Database(project)
    database.exec('DROP TABLE schema_migrations')
    database.prepare('UPDATE project_meta SET schema_version = 0').run()
    database.pragma('user_version = 0')
    database.close()

    const opened = await store.open(project)
    expect(opened).toMatchObject({ mode: 'read_write', metadata: { schemaVersion: CURRENT_SCHEMA_VERSION } })
    store.close(opened.sessionId)
    const backups = readdirSync(join(data, 'backups'), { recursive: true }).filter((entry) => String(entry).endsWith('.novelproj'))
    expect(backups).toHaveLength(1)
    const backupPath = join(data, 'backups', String(backups[0]))
    const backup = new Database(backupPath, { readonly: true })
    try { expect(backup.pragma('user_version', { simple: true })).toBe(0) } finally { backup.close() }
  })

  it('maps malformed files and missing sessions to stable specification errors', async () => {
    const { data, project } = fixture()
    writeFileSync(project, 'not sqlite')
    const store = new ProjectStore(data)
    await expect(store.open(project)).rejects.toMatchObject({ code: 'DATABASE_ERROR' } satisfies Partial<ProjectError>)
    expect(() => store.close(randomUUID())).toThrow(expect.objectContaining({ code: 'PROJECT_NOT_OPEN' }))
  })
})
