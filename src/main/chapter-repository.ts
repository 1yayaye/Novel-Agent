import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Chapter, ChapterHeader, ChapterSnapshot, ChapterSnapshotDetail } from '../shared/project'
import { count } from '../shared/text-counter'
import { ProjectError, ProjectStore } from './project-store'

type ChapterRow = { id: string; title: string; position: number; content: string; version: number; created_at: number; updated_at: number }
type SnapshotRow = {
  id: string
  chapter_id: string
  chapter_version: number
  title: string
  name: string | null
  content: string
  snapshot_kind: 'ordinary' | 'ai_apply' | 'split' | 'merge' | 'restore' | 'manual'
  permanent: number
  created_at: number
}

function chapter(row: ChapterRow): Chapter {
  return { id: row.id, title: row.title, position: row.position, content: row.content, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
}

function header(row: ChapterRow): ChapterHeader {
  return {
    id: row.id,
    title: row.title,
    position: row.position,
    version: row.version,
    characterCount: count(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function snapshotSummary(row: SnapshotRow): ChapterSnapshot {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    chapterVersion: row.chapter_version,
    title: row.title,
    name: row.name,
    snapshotKind: row.snapshot_kind,
    permanent: Boolean(row.permanent),
    createdAt: row.created_at
  }
}

function active(database: Database.Database): ChapterHeader[] {
  return (database.prepare('SELECT id,title,position,content,version,created_at,updated_at FROM chapter WHERE deleted_at IS NULL ORDER BY position').all() as ChapterRow[]).map(header)
}

function invalidateContent(database: Database.Database, chapterId: string, now: number, isDeleted = false): void {
  database.prepare("UPDATE content_chunk SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(chapterId)
  database.prepare("UPDATE chapter_summary SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(chapterId)
  database.prepare(`UPDATE source_evidence SET state = ? WHERE chapter_id = ? AND state = 'valid'`).run(isDeleted ? 'missing' : 'stale', chapterId)
  database.prepare("UPDATE consistency_issue SET state = 'stale' WHERE chapter_id = ? AND state NOT IN ('dismissed','stale')").run(chapterId)
  database.prepare("UPDATE candidate SET state = 'stale', updated_at = ? WHERE chapter_id = ? AND state = 'ready'").run(now, chapterId)
  database.prepare("UPDATE chapter_outline SET state = 'stale', updated_at = ? WHERE chapter_id = ? AND state IN ('draft','confirmed','current')").run(now, chapterId)
}

function markSearchDirty(database: Database.Database, now: number): void {
  database.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
}

function requireCurrent(database: Database.Database, chapterId: string, expectedVersion: number): ChapterRow {
  const row = database.prepare('SELECT id,title,position,content,version,created_at,updated_at FROM chapter WHERE id = ? AND deleted_at IS NULL').get(chapterId) as ChapterRow | undefined
  if (!row) throw new ProjectError('VALIDATION_ERROR', '章节不存在')
  if (row.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '章节已被其他修改覆盖，请重新载入')
  return row
}

function protectSurrogate(content: string, offset: number): void {
  if (offset <= 0 || offset >= content.length || (/[\uD800-\uDBFF]/.test(content[offset - 1]) && /[\uDC00-\uDFFF]/.test(content[offset]))) {
    throw new ProjectError('VALIDATION_ERROR', '拆分位置必须位于正文内部，且不能拆开 Unicode 字符')
  }
}

function pruneOrdinarySnapshots(database: Database.Database, chapterId: string): void {
  const countRow = database.prepare('SELECT COUNT(*) as total FROM chapter_snapshot WHERE chapter_id = ? AND permanent = 0').get(chapterId) as { total: number } | undefined
  const total = countRow?.total ?? 0
  if (total > 20) {
    const toDelete = total - 20
    database.prepare(`
      DELETE FROM chapter_snapshot
      WHERE chapter_id = ? AND permanent = 0 AND id IN (
        SELECT id FROM chapter_snapshot
        WHERE chapter_id = ? AND permanent = 0
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      )
    `).run(chapterId, chapterId, toDelete)
  }
}

import type { SearchIndex } from './search-index'

export class ChapterRepository {
  constructor(
    private readonly store: ProjectStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  list(sessionId: string): ChapterHeader[] { return this.store.read(sessionId, active) }
  get(sessionId: string, chapterId: string): Chapter {
    return this.store.read(sessionId, (database) => {
      const row = database.prepare('SELECT id,title,position,content,version,created_at,updated_at FROM chapter WHERE id = ? AND deleted_at IS NULL').get(chapterId) as ChapterRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '章节不存在')
      return chapter(row)
    })
  }
  update(sessionId: string, chapterId: string, content: string, expectedVersion: number): Chapter {
    const updated = this.store.transaction(sessionId, (database) => {
      const row = requireCurrent(database, chapterId, expectedVersion)
      const now = Date.now()
      database.prepare('UPDATE chapter SET content = ?, version = version + 1, updated_at = ? WHERE id = ?').run(content, now, chapterId)
      invalidateContent(database, chapterId, now); markSearchDirty(database, now)
      return { ...chapter(row), content, version: row.version + 1, updatedAt: now }
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return updated
  }
  create(sessionId: string, title: string, content: string): Chapter {
    const created = this.store.transaction(sessionId, (database) => {
      const now = Date.now(); const id = randomUUID()
      const position = Number((database.prepare('SELECT COALESCE(MAX(position), -1) AS value FROM chapter WHERE deleted_at IS NULL').get() as { value: number }).value) + 1
      database.prepare('INSERT INTO chapter(id,title,position,content,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').run(id, title, position, content, now, now)
      markSearchDirty(database, now)
      return { id, title, position, content, version: 1, createdAt: now, updatedAt: now }
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return created
  }
  rename(sessionId: string, chapterId: string, title: string, expectedVersion: number): Chapter {
    const renamed = this.store.transaction(sessionId, (database) => {
      const row = requireCurrent(database, chapterId, expectedVersion); const now = Date.now()
      database.prepare('UPDATE chapter SET title = ?, version = version + 1, updated_at = ? WHERE id = ?').run(title, now, chapterId)
      markSearchDirty(database, now)
      return { ...chapter(row), title, version: row.version + 1, updatedAt: now }
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return renamed
  }
  delete(sessionId: string, chapterId: string, expectedVersion: number): { success: true } {
    const result = this.store.transaction(sessionId, (database) => {
      requireCurrent(database, chapterId, expectedVersion); const now = Date.now()
      database.prepare('UPDATE chapter SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(now, now, chapterId)
      invalidateContent(database, chapterId, now, true); markSearchDirty(database, now)
      return { success: true as const }
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return result
  }
  reorder(sessionId: string, chapters: Array<{ id: string; expectedVersion: number }>): ChapterHeader[] {
    const result = this.store.transaction(sessionId, (database) => {
      const current = active(database)
      if (chapters.length !== current.length || new Set(chapters.map(({ id }) => id)).size !== chapters.length || chapters.some(({ id, expectedVersion }) => current.find((item) => item.id === id)?.version !== expectedVersion)) {
        throw new ProjectError('VERSION_CONFLICT', '章节顺序已变化，请重新载入')
      }
      const now = Date.now()
      database.prepare('UPDATE chapter SET position = -position - 1 WHERE deleted_at IS NULL').run()
      const setPosition = database.prepare('UPDATE chapter SET position = ?, version = version + 1, updated_at = ? WHERE id = ?')
      chapters.forEach(({ id }, position) => setPosition.run(position, now, id))
      return active(database)
    })
    return result
  }
  async split(sessionId: string, chapterId: string, offset: number, newTitle: string, expectedVersion: number): Promise<ChapterHeader[]> {
    await this.store.createPreOperationBackup(sessionId, 'split')
    const result = this.store.transaction(sessionId, (database) => {
      const row = requireCurrent(database, chapterId, expectedVersion); protectSurrogate(row.content, offset)
      const now = Date.now(); const id = randomUUID()

      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'split', 1, ?)
      `).run(randomUUID(), row.id, row.version, row.title, row.content, now)

      database.prepare('UPDATE chapter SET position = -position - 1 WHERE deleted_at IS NULL AND position > ?').run(row.position)
      database.prepare('UPDATE chapter SET content = ?, version = version + 1, updated_at = ? WHERE id = ?').run(row.content.slice(0, offset), now, chapterId)
      database.prepare('INSERT INTO chapter(id,title,position,content,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').run(id, newTitle, row.position + 1, row.content.slice(offset), now, now)
      database.prepare('UPDATE chapter SET position = -position WHERE position < 0').run()
      invalidateContent(database, chapterId, now); markSearchDirty(database, now)
      return active(database)
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return result
  }
  async merge(sessionId: string, chapterId: string, expectedVersion: number, nextExpectedVersion: number): Promise<ChapterHeader[]> {
    await this.store.createPreOperationBackup(sessionId, 'merge')
    const result = this.store.transaction(sessionId, (database) => {
      const first = requireCurrent(database, chapterId, expectedVersion)
      const next = database.prepare('SELECT id,title,position,content,version,created_at,updated_at FROM chapter WHERE position > ? AND deleted_at IS NULL ORDER BY position LIMIT 1').get(first.position) as ChapterRow | undefined
      if (!next) throw new ProjectError('VALIDATION_ERROR', '只能与下一章合并')
      if (next.version !== nextExpectedVersion) throw new ProjectError('VERSION_CONFLICT', '下一章已变化，请重新载入')
      const now = Date.now(); const separator = first.content.endsWith('\n') || next.content.startsWith('\n') ? '' : '\n\n'

      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'merge', 1, ?)
      `).run(randomUUID(), first.id, first.version, first.title, first.content, now)
      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'merge', 1, ?)
      `).run(randomUUID(), next.id, next.version, next.title, next.content, now)

      database.prepare('UPDATE chapter SET content = ?, version = version + 1, updated_at = ? WHERE id = ?').run(first.content + separator + next.content, now, first.id)
      database.prepare('UPDATE chapter SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(now, now, next.id)
      invalidateContent(database, first.id, now); invalidateContent(database, next.id, now, true); markSearchDirty(database, now)
      return active(database)
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return result
  }

  createSnapshot(sessionId: string, chapterId: string, expectedVersion: number, name: string): ChapterSnapshot {
    const trimmedName = name.trim()
    if (!trimmedName) throw new ProjectError('VALIDATION_ERROR', '手动快照名称不能为空')
    return this.store.transaction(sessionId, (database) => {
      const row = requireCurrent(database, chapterId, expectedVersion)
      const now = Date.now()
      const id = randomUUID()
      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, ?)
      `).run(id, row.id, row.version, row.title, trimmedName, row.content, now)
      return {
        id,
        chapterId: row.id,
        chapterVersion: row.version,
        title: row.title,
        name: trimmedName,
        snapshotKind: 'manual',
        permanent: true,
        createdAt: now
      }
    })
  }

  createOrdinarySnapshot(sessionId: string, chapterId: string, expectedVersion: number): ChapterSnapshot | null {
    return this.store.transaction(sessionId, (database) => {
      const row = requireCurrent(database, chapterId, expectedVersion)
      const latest = database.prepare('SELECT content FROM chapter_snapshot WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(chapterId) as { content: string } | undefined
      if (latest && latest.content === row.content) {
        return null
      }
      const now = Date.now()
      const id = randomUUID()
      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'ordinary', 0, ?)
      `).run(id, row.id, row.version, row.title, row.content, now)
      pruneOrdinarySnapshots(database, row.id)
      return {
        id,
        chapterId: row.id,
        chapterVersion: row.version,
        title: row.title,
        name: null,
        snapshotKind: 'ordinary',
        permanent: false,
        createdAt: now
      }
    })
  }

  listSnapshots(sessionId: string, chapterId: string): ChapterSnapshot[] {
    return this.store.read(sessionId, (database) => {
      const rows = database.prepare(`
        SELECT id, chapter_id, chapter_version, title, name, snapshot_kind, permanent, created_at
        FROM chapter_snapshot
        WHERE chapter_id = ?
        ORDER BY created_at DESC, rowid DESC
      `).all(chapterId) as SnapshotRow[]
      return rows.map(snapshotSummary)
    })
  }

  getSnapshot(sessionId: string, snapshotId: string): ChapterSnapshotDetail {
    return this.store.read(sessionId, (database) => {
      const row = database.prepare(`
        SELECT id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at
        FROM chapter_snapshot
        WHERE id = ?
      `).get(snapshotId) as SnapshotRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '快照不存在')
      return {
        ...snapshotSummary(row),
        content: row.content
      }
    })
  }

  restoreSnapshot(sessionId: string, snapshotId: string, expectedVersion: number): Chapter {
    const restored = this.store.transaction(sessionId, (database) => {
      const snapshotRow = database.prepare(`
        SELECT id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at
        FROM chapter_snapshot
        WHERE id = ?
      `).get(snapshotId) as SnapshotRow | undefined
      if (!snapshotRow) throw new ProjectError('VALIDATION_ERROR', '快照不存在')

      const current = requireCurrent(database, snapshotRow.chapter_id, expectedVersion)
      const now = Date.now()

      database.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'restore', 1, ?)
      `).run(randomUUID(), current.id, current.version, current.title, current.content, now)

      database.prepare('UPDATE chapter SET content = ?, version = version + 1, updated_at = ? WHERE id = ?').run(snapshotRow.content, now, current.id)
      invalidateContent(database, current.id, now)
      markSearchDirty(database, now)
      return { ...chapter(current), content: snapshotRow.content, version: current.version + 1, updatedAt: now }
    })
    void this.searchIndex?.sync(sessionId).catch(() => {})
    return restored
  }
}
