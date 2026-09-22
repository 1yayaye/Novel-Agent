import { accessSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import initialSchema from './migrations/0001_initial_schema.sql?raw'
import outlineSchema from './migrations/0002_outline_schema.sql?raw'
import workflowSchema from './migrations/0003_chat_workflow_schema.sql?raw'
import contextPackageSchema from './migrations/0004_context_package_snapshot.sql?raw'
import { seedDefaultCreativePresets } from './default-presets'
import { splitIntoChunks } from './chunker'
import {
  CURRENT_SCHEMA_VERSION,
  ProjectSummarySchema,
  TaskRouteSummarySchema,
  type BackupInfo,
  type BookOutline,
  type BookSynopsis,
  type Chapter,
  type ChapterOutline,
  type ChapterSummary,
  type ConsistencyIssue,
  type ConsistencyIssueSeverity,
  type ConsistencyIssueState,
  type ConsistencyIssueType,
  type CreateProjectInput,
  type ExportFormat,
  type KnowledgeKind,
  type LiteraryReportDetail,
  type LiteraryReportSummary,
  type OpenProjectResult,
  type OutlineState,
  type ProjectErrorCode,
  type ProjectSummary,
  type ReportAnnotation,
  type ReportSection,
  type ReportSectionType,
  type SourceEvidence,
  type TaskDetail,
  type TaskProgressEvent,
  type TaskRouteSummary,
  type TaskState,
  type TaskStep,
  type TaskStepResultState,
  type TaskStepState,
  type TaskSummary,
  type TaskType,
  type VolumeOutline
} from '../shared/project'
import type { ConnectionStore } from './connection-store'

type DatabaseHandle = Database.Database
type Session = { database: DatabaseHandle; path: string; readOnly: boolean; lock?: ProjectLock; restoring?: boolean }
type RecentEntry = { path: string; title: string; lastOpenedAt: number; sourcePath?: string }
type ProjectMetaRow = {
  id: string
  title: string
  description: string
  version: number
  schema_version: number
  updated_at: number
  search_revision: number
  indexed_revision: number
}

type BookOutlineRow = {
  id: string
  content: string
  source_versions_json: string
  version: number
  state: OutlineState
  created_at: number
  updated_at: number
}

type VolumeOutlineRow = {
  id: string
  title: string
  position: number
  content: string
  version: number
  state: OutlineState
  created_at: number
  updated_at: number
}

type ChapterOutlineRow = {
  id: string
  chapter_id: string
  volume_id: string | null
  chapter_version: number
  content: string
  version: number
  state: OutlineState
  created_at: number
  updated_at: number
}

function parseSourceVersions(json: string): Record<string, number> {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number>
    }
    return {}
  } catch {
    return {}
  }
}

function mapBookOutline(row: BookOutlineRow): BookOutline {
  return {
    id: row.id,
    content: row.content,
    sourceVersions: parseSourceVersions(row.source_versions_json),
    version: row.version,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapVolumeOutline(row: VolumeOutlineRow): VolumeOutline {
  return {
    id: row.id,
    title: row.title,
    position: row.position,
    content: row.content,
    version: row.version,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapChapterOutline(row: ChapterOutlineRow): ChapterOutline {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    chapterVersion: row.chapter_version,
    volumeId: row.volume_id,
    content: row.content,
    version: row.version,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

class ProjectLock {
  private constructor(private readonly lockPath: string, private readonly token: string) {}

  static acquire(projectPath: string): ProjectLock | undefined {
    const lockPath = `${projectPath}.lock`
    const create = (): ProjectLock | undefined => {
      const token = randomUUID()
      let descriptor: number | undefined
      try {
        descriptor = openSync(lockPath, 'wx')
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }))
        closeSync(descriptor)
        return new ProjectLock(lockPath, token)
      } catch (error) {
        if (descriptor !== undefined) try { closeSync(descriptor) } catch {}
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') try { unlinkSync(lockPath) } catch {}
        return undefined
      }
    }

    const lock = create()
    if (lock) return lock
    try {
      const record = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number }
      if (typeof record.pid !== 'number' || isProcessAlive(record.pid)) return undefined
      unlinkSync(lockPath)
    } catch {
      return undefined
    }
    return create()
  }

  release(): void {
    try {
      const record = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { token?: string }
      if (record.token === this.token) unlinkSync(this.lockPath)
    } catch {}
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function projectPath(path: string): string {
  if (extname(path).toLowerCase() !== '.novelproj') throw new ProjectError('VALIDATION_ERROR', '项目路径必须使用 .novelproj 扩展名')
  return normalize(resolve(path))
}

function pathKey(path: string): string {
  const normalized = normalize(resolve(path))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function assertProjectHeader(path: string): void {
  if (!existsSync(path)) throw new ProjectError('DATABASE_ERROR', '项目文件不存在')
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const header = Buffer.alloc(16)
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length || header.toString('ascii') !== 'SQLite format 3\u0000') {
      throw new ProjectError('DATABASE_ERROR', '项目文件不是有效的 SQLite 数据库')
    }
  } catch (error) {
    if (error instanceof ProjectError) throw error
    throw new ProjectError('DATABASE_ERROR', '无法读取项目文件')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    accessSync(dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export class ProjectStore {
  private readonly sessions = new Map<string, Session>()
  private readonly recentPath: string
  private readonly pendingBackups = new Set<Promise<void>>()
  private readonly protectedBackupPaths = new Set<string>()
  private readonly deferredBackupTimers = new Map<string, NodeJS.Timeout>()
  private readonly autoBackupDelayMs: number
  private connectionStore?: ConnectionStore

  constructor(
    private readonly dataPath: string,
    connectionStore?: ConnectionStore,
    autoBackupDelayMs?: number
  ) {
    mkdirSync(dataPath, { recursive: true })
    this.recentPath = join(dataPath, 'recent-projects.json')
    this.connectionStore = connectionStore
    this.autoBackupDelayMs = autoBackupDelayMs !== undefined
      ? autoBackupDelayMs
      : (process.env.NODE_ENV === 'test' ? 0 : 5000)
  }

  setConnectionStore(connectionStore: ConnectionStore): void {
    this.connectionStore = connectionStore
  }

  get dataDirectory(): string {
    return this.dataPath
  }

  create(input: CreateProjectInput, chapters: Array<Pick<Chapter, 'title' | 'content'>> = []): ProjectSummary {
    const path = projectPath(input.destination)
    if (!existsSync(dirname(path)) || !isWritable(dirname(path))) throw new ProjectError('VALIDATION_ERROR', '目标目录不存在或不可写')
    if (existsSync(path)) throw new ProjectError('VALIDATION_ERROR', '目标项目已存在')
    const lock = ProjectLock.acquire(path)
    if (!lock) throw new ProjectError('PROJECT_LOCKED', '目标项目正在被其他实例使用')

    let database: DatabaseHandle | undefined
    try {
      database = new Database(path)
      this.configureWritable(database)
      const summary = this.initialize(database, path, input.title, input.description, chapters)
      if (input.sourcePath) {
        summary.sourcePath = input.sourcePath
      }
      database.pragma('wal_checkpoint(TRUNCATE)')
      database.close()
      database = undefined
      this.writeRecent(summary)
      return summary
    } catch (error) {
      try { database?.close() } catch {}
      for (const suffix of ['', '-wal', '-shm']) try { if (existsSync(`${path}${suffix}`)) unlinkSync(`${path}${suffix}`) } catch {}
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '无法创建项目数据库')
    } finally {
      lock.release()
    }
  }

  async open(pathInput: string, options?: { autoBackupDelayMs?: number }): Promise<OpenProjectResult> {
    const path = projectPath(pathInput)
    assertProjectHeader(path)
    let database: DatabaseHandle | undefined
    let lock: ProjectLock | undefined
    let readOnly = false
    let readOnlyReason: OpenProjectResult['readOnlyReason']

    try {
      const writable = isWritable(path)
      if (!writable) {
        readOnly = true
        readOnlyReason = 'not_writable'
      } else {
        lock = ProjectLock.acquire(path)
        if (!lock) {
          readOnly = true
          readOnlyReason = 'locked'
        }
      }

      if (readOnly) {
        database = new Database(path, { readonly: true, fileMustExist: true })
        try { database.loadExtension(sqliteVec.getLoadablePath()) } catch {}
        database.pragma('query_only = ON')
      } else {
        try {
          database = new Database(path, { fileMustExist: true })
          this.configureWritable(database)
        } catch {
          if (lock) {
            lock.release()
            lock = undefined
          }
          readOnly = true
          readOnlyReason = 'not_writable'
          try { database?.close() } catch {}
          database = new Database(path, { readonly: true, fileMustExist: true })
          try { database.loadExtension(sqliteVec.getLoadablePath()) } catch {}
          database.pragma('query_only = ON')
        }
      }

      const schemaVersion = Number(database.pragma('user_version', { simple: true }))
      let integrity: OpenProjectResult['integrity'] = 'failed'
      try { integrity = database.pragma('quick_check(1)', { simple: true }) === 'ok' ? 'ok' : 'failed' } catch {}

      if (integrity === 'failed') {
        readOnly = true
        readOnlyReason = 'integrity_failed'
        if (lock) {
          lock.release()
          lock = undefined
        }
        database.pragma('query_only = ON')
      } else if (schemaVersion > CURRENT_SCHEMA_VERSION) {
        readOnly = true
        readOnlyReason = 'future_schema'
        if (lock) {
          lock.release()
          lock = undefined
        }
        database.pragma('query_only = ON')
      } else if (schemaVersion < CURRENT_SCHEMA_VERSION) {
        if (!writable) throw new ProjectError('PROJECT_READ_ONLY', '旧版项目需要迁移，但项目不可写')
        if (!lock) throw new ProjectError('PROJECT_LOCKED', '旧版项目需要迁移，但项目已被锁定')
        await this.backupBeforeMigration(database, path, schemaVersion)
        this.migrate(database, schemaVersion)
        database.prepare('UPDATE project_meta SET last_backup_at = ?').run(Date.now())
        readOnly = false
      }

      const effectiveSchemaVersion = Number(database.pragma('user_version', { simple: true }))
      const metadata = effectiveSchemaVersion === CURRENT_SCHEMA_VERSION && integrity === 'ok'
        ? this.currentSummary(database, path)
        : this.relaxedSummary(database, path, effectiveSchemaVersion)
      const taskRoutes = this.readTaskRoutes(database)
      const sessionId = randomUUID()

      if (!readOnly) {
        this.recoverInterruptedTasks(database)
        try {
          seedDefaultCreativePresets(database)
        } catch {}

        const delay = options?.autoBackupDelayMs !== undefined ? options.autoBackupDelayMs : this.autoBackupDelayMs
        if (delay <= 0) {
          await this.executeAutoBackupSync(path, database)
        } else {
          this.scheduleDeferredAutoBackup(sessionId, path, database, delay)
        }
      }

      const result: OpenProjectResult = {
        sessionId,
        mode: readOnly ? 'read_only' : 'read_write',
        ...(readOnlyReason ? { readOnlyReason } : {}),
        integrity,
        metadata,
        taskRoutes
      }
      this.sessions.set(sessionId, { database, path, readOnly, lock })
      database = undefined
      lock = undefined
      this.writeRecent(metadata)
      return result
    } catch (error) {
      try { database?.close() } catch {}
      lock?.release()
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '无法打开项目数据库')
    }
  }

  private scheduleDeferredAutoBackup(
    sessionId: string,
    path: string,
    database: DatabaseHandle,
    delayMs: number
  ): void {
    const timer = setTimeout(() => {
      this.deferredBackupTimers.delete(sessionId)
      const session = this.sessions.get(sessionId)
      if (!session || session.readOnly) return

      try {
        const lastRow = database.prepare('SELECT last_backup_at FROM project_meta LIMIT 1').get() as { last_backup_at: number | null } | undefined
        const lastBackupAt = lastRow?.last_backup_at
        const now = Date.now()
        if (!lastBackupAt || (now - lastBackupAt) > 24 * 60 * 60 * 1000) {
          const folder = this.backupDirectory(path)
          mkdirSync(folder, { recursive: true })
          const autoBackupPath = join(folder, `backup-auto-${now}-${randomUUID().slice(0, 8)}.novelproj`)
          const backupPromise = this.backupDatabase(database, autoBackupPath)
            .then(() => {
              this.pruneBackups(folder, 5, this.protectedBackupPaths)
              try {
                database.prepare('UPDATE project_meta SET last_backup_at = ?').run(now)
              } catch {}
            })
            .catch(() => {})
          this.pendingBackups.add(backupPromise)
          backupPromise.finally(() => this.pendingBackups.delete(backupPromise))
        }
      } catch {}
    }, delayMs)

    timer.unref?.()
    this.deferredBackupTimers.set(sessionId, timer)
  }

  private async executeAutoBackupSync(path: string, database: DatabaseHandle): Promise<void> {
    try {
      const lastRow = database.prepare('SELECT last_backup_at FROM project_meta LIMIT 1').get() as { last_backup_at: number | null } | undefined
      const lastBackupAt = lastRow?.last_backup_at
      const now = Date.now()
      if (!lastBackupAt || (now - lastBackupAt) > 24 * 60 * 60 * 1000) {
        const folder = this.backupDirectory(path)
        mkdirSync(folder, { recursive: true })
        const autoBackupPath = join(folder, `backup-auto-${now}-${randomUUID().slice(0, 8)}.novelproj`)
        await this.backupDatabase(database, autoBackupPath)
        this.pruneBackups(folder, 5, this.protectedBackupPaths)
        database.prepare('UPDATE project_meta SET last_backup_at = ?').run(now)
      }
    } catch {}
  }

  close(sessionId: string): { success: true } {
    const timer = this.deferredBackupTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deferredBackupTimers.delete(sessionId)
    }
    const session = this.session(sessionId)
    this.sessions.delete(sessionId)
    let checkpointError = false
    try {
      if (!session.readOnly) session.database.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      checkpointError = true
    } finally {
      try { session.database.close() } finally { session.lock?.release() }
    }
    if (checkpointError) throw new ProjectError('DATABASE_ERROR', '项目已关闭，但 WAL checkpoint 失败')
    return { success: true }
  }

  transaction<T>(sessionId: string, action: (database: DatabaseHandle) => T): T {
    const session = this.session(sessionId)
    if (session.readOnly) throw new ProjectError('PROJECT_READ_ONLY', '项目以只读模式打开')
    if (session.restoring) throw new ProjectError('DATABASE_ERROR', '项目正在恢复，请稍后重试')
    try {
      return session.database.transaction(() => action(session.database))()
    } catch (error) {
      if (error instanceof ProjectError) throw error
      const msg = error instanceof Error ? error.message : String(error)
      throw new ProjectError('DATABASE_ERROR', `项目事务失败: ${msg}`)
    }
  }

  read<T>(sessionId: string, action: (database: DatabaseHandle) => T): T {
    return action(this.session(sessionId).database)
  }

  async saveCopy(sessionId: string, destination: string): Promise<{ savedPath: string }> {
    const session = this.session(sessionId)
    const target = projectPath(destination)
    if (!existsSync(dirname(target)) || !isWritable(dirname(target)) || existsSync(target)) throw new ProjectError('VALIDATION_ERROR', '副本目标必须是可写目录中的新文件')
    const backup = this.backupDatabase(session.database, target)
    this.pendingBackups.add(backup)
    try {
      await backup
      return { savedPath: target }
    } finally {
      this.pendingBackups.delete(backup)
    }
  }

  listRecent(): Array<RecentEntry & { isAvailable: boolean }> {
    return this.readRecent().map((entry) => ({ ...entry, isAvailable: existsSync(entry.path) }))
  }

  async drainPendingBackups(): Promise<void> {
    await Promise.allSettled([...this.pendingBackups])
  }

  async closeAll(): Promise<void> {
    for (const timer of this.deferredBackupTimers.values()) {
      clearTimeout(timer)
    }
    this.deferredBackupTimers.clear()
    await Promise.allSettled([...this.pendingBackups])
    for (const sessionId of [...this.sessions.keys()]) {
      try { this.close(sessionId) } catch {}
    }
  }

  backupDirectory(projectPath: string): string {
    const key = createHash('sha256').update(pathKey(projectPath)).digest('hex').slice(0, 24)
    return join(this.dataPath, 'backups', key)
  }

  async createBackup(sessionId: string, tag = 'manual'): Promise<BackupInfo> {
    const session = this.session(sessionId)
    const folder = this.backupDirectory(session.path)
    mkdirSync(folder, { recursive: true })
    const now = Date.now()
    const filename = `backup-${tag}-${now}-${randomUUID().slice(0, 8)}.novelproj`
    const targetPath = join(folder, filename)
    const backup = this.backupDatabase(session.database, targetPath)
    this.pendingBackups.add(backup)
    try {
      await backup
      this.pruneBackups(folder, 5, this.protectedBackupPaths)
      if (!session.readOnly) {
        session.database.prepare('UPDATE project_meta SET last_backup_at = ?').run(now)
      }
      return {
        id: filename,
        path: targetPath,
        sizeBytes: statSync(targetPath).size,
        createdAt: now,
        tag
      }
    } finally {
      this.pendingBackups.delete(backup)
    }
  }

  listBackups(sessionId: string): BackupInfo[] {
    const session = this.session(sessionId)
    const folder = this.backupDirectory(session.path)
    if (!existsSync(folder)) return []
    try {
      return readdirSync(folder)
        .filter((file) => file.endsWith('.novelproj'))
        .map((file) => {
          const filePath = join(folder, file)
          const stat = statSync(filePath)
          let tag: string | undefined
          const match = file.match(/^backup-([a-zA-Z0-9_-]+)-\d+-/)
          if (match) tag = match[1]
          return {
            id: file,
            path: filePath,
            sizeBytes: stat.size,
            createdAt: Math.trunc(stat.mtimeMs),
            tag
          }
        })
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  openBackupLocation(sessionId: string): string {
    const session = this.session(sessionId)
    const folder = this.backupDirectory(session.path)
    mkdirSync(folder, { recursive: true })
    return folder
  }

  async createPreOperationBackup(sessionId: string, tag: string): Promise<void> {
    try {
      await this.createBackup(sessionId, tag)
    } catch (error) {
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', `高风险结构操作前备份失败（${tag}）`)
    }
  }

  async restoreBackup(sessionId: string, backupPathInput: string): Promise<OpenProjectResult> {
    const session = this.session(sessionId)
    if (session.readOnly) throw new ProjectError('PROJECT_READ_ONLY', '只读项目无法执行恢复')
    if (session.restoring) throw new ProjectError('DATABASE_ERROR', '项目正在恢复，请稍后重试')
    const backupPath = resolve(backupPathInput)
    assertProjectHeader(backupPath)
    const testDb = new Database(backupPath, { readonly: true, fileMustExist: true })
    try {
      if (testDb.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new ProjectError('DATABASE_ERROR', '备份文件完整性检查失败')
      }
    } finally {
      testDb.close()
    }

    const projectFilePath = session.path
    const protectedRestore = `${projectFilePath}.restore-source-${randomUUID().slice(0, 8)}`
    const tempRestore = `${projectFilePath}.restore-tmp-${randomUUID().slice(0, 8)}`
    const timer = this.deferredBackupTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.deferredBackupTimers.delete(sessionId)
    }
    session.restoring = true
    this.protectedBackupPaths.add(backupPath)
    try {
      copyFileSync(backupPath, protectedRestore)
      const protectedDb = new Database(protectedRestore, { readonly: true, fileMustExist: true })
      try {
        if (protectedDb.pragma('integrity_check', { simple: true }) !== 'ok') {
          throw new ProjectError('DATABASE_ERROR', '恢复源完整性检查失败')
        }
      } finally {
        protectedDb.close()
      }

      await this.createBackup(sessionId, 'pre-restore')
      await this.drainPendingBackups()
      const checkpoint = session.database.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy?: number }>
      if (!Array.isArray(checkpoint) || checkpoint[0]?.busy !== 0) {
        throw new ProjectError('DATABASE_ERROR', '恢复前 WAL checkpoint 失败')
      }

      const copyDb = new Database(protectedRestore, { readonly: true, fileMustExist: true })
      try {
        await copyDb.backup(tempRestore)
      } finally {
        copyDb.close()
      }
      const verifyDb = new Database(tempRestore, { readonly: true, fileMustExist: true })
      try {
        if (verifyDb.pragma('integrity_check', { simple: true }) !== 'ok') {
          throw new ProjectError('DATABASE_ERROR', '恢复副本完整性检查失败')
        }
      } finally {
        verifyDb.close()
      }
      session.database.close()
      renameSync(tempRestore, projectFilePath)
    } catch (error) {
      try { if (existsSync(tempRestore)) unlinkSync(tempRestore) } catch {}
      try { if (existsSync(protectedRestore)) unlinkSync(protectedRestore) } catch {}
      this.protectedBackupPaths.delete(backupPath)
      session.restoring = false
      if (!session.database.open) {
        try {
          session.database = new Database(projectFilePath, { fileMustExist: true })
          this.configureWritable(session.database)
        } catch {}
      }
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '恢复备份文件写入失败')
    }

    try {
      const database = new Database(projectFilePath, { fileMustExist: true })
      this.configureWritable(database)
      const integrity = database.pragma('quick_check(1)', { simple: true }) === 'ok' ? 'ok' : 'failed'
      if (integrity !== 'ok') throw new ProjectError('DATABASE_ERROR', '恢复后的项目完整性检查失败')
      this.recoverInterruptedTasks(database)
      const metadata = this.currentSummary(database, projectFilePath)
      const result: OpenProjectResult = {
        sessionId,
        mode: 'read_write',
        integrity,
        metadata,
        taskRoutes: this.readTaskRoutes(database)
      }
      this.sessions.set(sessionId, { ...session, database, restoring: false })
      this.writeRecent(metadata)
      this.protectedBackupPaths.delete(backupPath)
      this.pruneBackups(this.backupDirectory(projectFilePath), 5)
      try { if (existsSync(protectedRestore)) unlinkSync(protectedRestore) } catch {}
      return result
    } catch (error) {
      this.protectedBackupPaths.delete(backupPath)
      session.restoring = false
      try { if (existsSync(protectedRestore)) unlinkSync(protectedRestore) } catch {}
      this.sessions.delete(sessionId)
      try { session.database.close() } catch {}
      session.lock?.release()
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '恢复后的项目无法重新打开')
    }
  }

  exportProject(sessionId: string, format: ExportFormat, chapterIds?: string[], destination?: string): { savedPath: string } {
    const session = this.session(sessionId)
    if (!destination) throw new ProjectError('VALIDATION_ERROR', '缺少导出目标路径')
    const target = resolve(destination)
    if (!existsSync(dirname(target)) || !isWritable(dirname(target))) {
      throw new ProjectError('VALIDATION_ERROR', '导出目标目录不存在或不可写')
    }
    const allChapters = session.database.prepare('SELECT id, title, content, position FROM chapter WHERE deleted_at IS NULL ORDER BY position').all() as Array<{ id: string; title: string; content: string; position: number }>
    const filtered = chapterIds && chapterIds.length > 0
      ? allChapters.filter((c) => chapterIds.includes(c.id))
      : allChapters
    if (filtered.length === 0) {
      throw new ProjectError('VALIDATION_ERROR', '没有可导出的章节')
    }

    let outputText: string
    if (format === 'txt') {
      outputText = filtered.map((c) => `${c.title}\n\n${c.content}`).join('\n\n\n')
    } else {
      outputText = filtered.map((c) => `# ${c.title}\n\n${c.content}`).join('\n\n')
    }

    const temp = `${target}.tmp-${randomUUID().slice(0, 8)}`
    try {
      writeFileSync(temp, Buffer.from(outputText, 'utf8'))
      renameSync(temp, target)
      return { savedPath: target }
    } catch (error) {
      try { if (existsSync(temp)) unlinkSync(temp) } catch {}
      if (error instanceof ProjectError) throw error
      throw new ProjectError('EXPORT_FAILED', '导出作品文件失败')
    }
  }

  private pruneBackups(folder: string, maxCount = 5, protectedPaths = new Set<string>()): void {
    try {
      if (!existsSync(folder)) return
      const files = readdirSync(folder)
        .filter((file) => file.endsWith('.novelproj'))
        .map((file) => {
          const filePath = join(folder, file)
          return { file, filePath, mtime: statSync(filePath).mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)

      for (let i = maxCount; i < files.length; i++) {
        if (protectedPaths.has(files[i].filePath)) continue
        try { unlinkSync(files[i].filePath) } catch {}
      }
    } catch {}
  }

  private initialize(database: DatabaseHandle, path: string, title: string, description: string, chapters: Array<Pick<Chapter, 'title' | 'content'>>): ProjectSummary {
    const now = Date.now()
    database.transaction(() => {
      database.exec(initialSchema)
      database.exec(outlineSchema)
      database.exec(workflowSchema)
      database.exec(contextPackageSchema)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(1, '0001_initial_schema', now)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(2, '0002_outline_schema', now)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(3, '0003_chat_workflow_schema', now)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(4, '0004_context_package_snapshot', now)
      database.prepare('INSERT INTO project_meta(id,title,description,version,created_at,updated_at,schema_version,creative_rules,last_backup_at,search_revision,indexed_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), title.trim(), description, 1, now, now, CURRENT_SCHEMA_VERSION, '', null, chapters.length ? 1 : 0, 0)
      database.prepare("INSERT INTO vector_index_meta(id,state,updated_at) VALUES (1,'missing',?)").run(now)
      const insertChapter = database.prepare('INSERT INTO chapter(id,title,position,content,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
      chapters.forEach((chapter, position) => {
        insertChapter.run(randomUUID(), chapter.title, position, chapter.content, now, now)
      })
      database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
      seedDefaultCreativePresets(database)
    })()
    return this.currentSummary(database, path)
  }

  private migrate(database: DatabaseHandle, version: number): void {
    if (version < 0 || version >= CURRENT_SCHEMA_VERSION) throw new ProjectError('UNSUPPORTED_SCHEMA', `不支持从 schema ${version} 迁移`)
    const now = Date.now()
    try {
      database.transaction(() => {
        if (version === 0) {
          database.exec(initialSchema)
          database.prepare('INSERT OR REPLACE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(1, '0001_initial_schema', now)
          database.prepare("INSERT OR IGNORE INTO vector_index_meta(id,state,updated_at) VALUES (1,'missing',?)").run(now)
        }
        if (version < 2) {
          database.exec(outlineSchema)
          database.prepare('INSERT OR REPLACE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(2, '0002_outline_schema', now)
        }
        if (version < 3) {
          const chatColumns = (database.pragma('table_info(chat_session)') as Array<{ name: string }>).map((c) => c.name)
          if (!chatColumns.includes('workflow_type')) {
            database.exec(workflowSchema)
          }
          database.prepare('INSERT OR REPLACE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(3, '0003_chat_workflow_schema', now)
        }
        if (version < 4) {
          const packageColumns = (database.pragma('table_info(context_package)') as Array<{ name: string }>).map((c) => c.name)
          const itemColumns = (database.pragma('table_info(context_item)') as Array<{ name: string }>).map((c) => c.name)
          if (!packageColumns.includes('task_type') || !itemColumns.includes('title')) {
            database.exec(contextPackageSchema)
          }
          database.prepare('INSERT OR REPLACE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(4, '0004_context_package_snapshot', now)
        }
        const meta = database.prepare('SELECT id FROM project_meta LIMIT 1').get() as { id: string } | undefined
        if (!meta) throw new ProjectError('UNSUPPORTED_SCHEMA', '旧版数据库缺少项目元数据')
        database.prepare('UPDATE project_meta SET schema_version = ?').run(CURRENT_SCHEMA_VERSION)
        database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
      })()
    } catch (error) {
      if (error instanceof ProjectError) throw error
      throw new ProjectError('UNSUPPORTED_SCHEMA', '旧版项目结构无法迁移')
    }
  }

  private recoverInterruptedTasks(database: DatabaseHandle): void {
    const now = Date.now()
    database.transaction(() => {
      database.prepare("UPDATE task SET state = 'interrupted', updated_at = ? WHERE state = 'running'").run(now)
      database.prepare("UPDATE task_step SET state = 'pending', updated_at = ? WHERE state = 'running'").run(now)
      database.prepare("UPDATE candidate SET state = 'failed', updated_at = ? WHERE state = 'streaming'").run(now)
      database.prepare("UPDATE chat_message SET state = 'failed' WHERE state = 'streaming'").run()
    })()
  }

  private async backupBeforeMigration(database: DatabaseHandle, path: string, fromVersion: number): Promise<void> {
    const folder = this.backupDirectory(path)
    try {
      mkdirSync(folder, { recursive: true })
      await this.backupDatabase(database, join(folder, `migration-${fromVersion}-${CURRENT_SCHEMA_VERSION}-${Date.now()}-${randomUUID().slice(0, 8)}.novelproj`))
    } catch (error) {
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '迁移前备份失败')
    }
  }

  private async backupDatabase(database: DatabaseHandle, target: string): Promise<void> {
    if (existsSync(target)) throw new ProjectError('VALIDATION_ERROR', '目标文件已存在')
    const temp = `${target}.tmp-${randomUUID().slice(0, 8)}`
    try {
      await database.backup(temp)
      const copy = new Database(temp, { readonly: true, fileMustExist: true })
      try {
        if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new ProjectError('DATABASE_ERROR', '生成的项目副本完整性检查失败')
      } finally {
        copy.close()
      }
      if (existsSync(target)) throw new ProjectError('VALIDATION_ERROR', '目标文件已存在')
      renameSync(temp, target)
    } catch (error) {
      if (error instanceof ProjectError) throw error
      throw new ProjectError('DATABASE_ERROR', '无法创建一致性项目副本')
    } finally {
      try { if (existsSync(temp)) unlinkSync(temp) } catch {}
    }
  }

  private configureWritable(database: DatabaseHandle): void {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
    database.pragma('synchronous = NORMAL')
    database.pragma('cache_size = -64000')
    database.pragma('mmap_size = 268435456')
    database.pragma('temp_store = MEMORY')
    try {
      database.loadExtension(sqliteVec.getLoadablePath())
    } catch {}
  }

  private currentSummary(database: DatabaseHandle, path: string): ProjectSummary {
    const meta = database.prepare('SELECT id,title,description,version,schema_version,updated_at,search_revision,indexed_revision FROM project_meta LIMIT 1').get() as ProjectMetaRow | undefined
    const migration = database.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(CURRENT_SCHEMA_VERSION) as { version: number } | undefined
    if (!meta || !migration || meta.schema_version !== CURRENT_SCHEMA_VERSION || Number(database.pragma('user_version', { simple: true })) !== CURRENT_SCHEMA_VERSION) {
      throw new ProjectError('UNSUPPORTED_SCHEMA', '项目 schema 版本记录不一致')
    }
    return {
      projectId: meta.id,
      path,
      title: meta.title,
      description: meta.description,
      version: meta.version,
      schemaVersion: meta.schema_version,
      updatedAt: meta.updated_at,
      searchIndexState: meta.search_revision === meta.indexed_revision ? 'current' : 'needs_rebuild'
    }
  }

  private relaxedSummary(database: DatabaseHandle, path: string, schemaVersion: number): ProjectSummary {
    try {
      const meta = database.prepare('SELECT id,title,description,version,updated_at,search_revision,indexed_revision FROM project_meta LIMIT 1').get() as Omit<ProjectMetaRow, 'schema_version'> | undefined
      if (meta) {
        const parsed = ProjectSummarySchema.safeParse({
          projectId: meta.id,
          path,
          title: meta.title,
          description: meta.description,
          version: meta.version,
          schemaVersion,
          updatedAt: meta.updated_at,
          searchIndexState: meta.search_revision === meta.indexed_revision ? 'current' : 'needs_rebuild'
        })
        if (parsed.success) return parsed.data
      }
    } catch {}
    const modifiedAt = Math.trunc(statSync(path).mtimeMs)
    return { projectId: null, path, title: basename(path, extname(path)), description: '', version: null, schemaVersion, updatedAt: modifiedAt, searchIndexState: 'unknown' }
  }

  setTaskRoute(
    sessionId: string,
    taskType: TaskType,
    connectionId: string | null,
    expectedVersion?: number
  ): TaskRouteSummary | null {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, task_type as taskType, connection_id as connectionId, version, updated_at as updatedAt FROM task_route WHERE task_type = ?').get(taskType) as {
        id: string
        taskType: TaskType
        connectionId: string
        version: number
        updatedAt: number
      } | undefined

      if (connectionId === null) {
        if (!existing) return null
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          throw new ProjectError('VERSION_CONFLICT', '任务路由已被其他修改覆盖，请重新载入')
        }
        db.prepare('DELETE FROM task_route WHERE task_type = ?').run(taskType)
        return null
      }

      if (existing) {
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          throw new ProjectError('VERSION_CONFLICT', '任务路由已被其他修改覆盖，请重新载入')
        }
        const nextVersion = existing.version + 1
        db.prepare('UPDATE task_route SET connection_id = ?, version = ?, updated_at = ? WHERE id = ?').run(connectionId, nextVersion, now, existing.id)

        const resolution = this.resolveConnectionId(connectionId)
        return {
          id: existing.id,
          taskType,
          connectionId,
          version: nextVersion,
          updatedAt: now,
          resolution
        }
      } else {
        const id = randomUUID()
        db.prepare('INSERT INTO task_route(id, task_type, connection_id, version, updated_at) VALUES (?, ?, ?, 1, ?)').run(id, taskType, connectionId, now)
        const resolution = this.resolveConnectionId(connectionId)
        return {
          id,
          taskType,
          connectionId,
          version: 1,
          updatedAt: now,
          resolution
        }
      }
    })
  }

  // --- Phase 7: Tasks & Steps ---

  createTask(
    sessionId: string,
    type: string,
    scopeJson: string,
    connectionId: string | null,
    chapterIds: string[]
  ): TaskDetail {
    return this.transaction(sessionId, (database) => {
      const now = Date.now()
      const taskId = randomUUID()
      database
        .prepare(
          'INSERT INTO task(id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)'
        )
        .run(taskId, type, scopeJson, connectionId, 'queued', now, now)

      const steps: TaskStep[] = []
      const insertStep = database.prepare(
        'INSERT INTO task_step(id, task_id, chapter_id, chapter_version, position, state, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
      )

      if (chapterIds.length > 0) {
        chapterIds.forEach((chapterId, position) => {
          const stepId = randomUUID()
          const chapterRow = database
            .prepare('SELECT version, title FROM chapter WHERE id = ? AND deleted_at IS NULL')
            .get(chapterId) as { version: number; title: string } | undefined
          const version = chapterRow?.version ?? 1
          insertStep.run(stepId, taskId, chapterId, version, position, 'pending', now, now)
          steps.push({
            id: stepId,
            taskId,
            chapterId,
            chapterVersion: version,
            position,
            state: 'pending',
            attemptCount: 0,
            resultState: null,
            createdAt: now,
            updatedAt: now,
            chapterTitle: chapterRow?.title
          })
        })
      } else {
        const stepId = randomUUID()
        insertStep.run(stepId, taskId, null, null, 0, 'pending', now, now)
        steps.push({
          id: stepId,
          taskId,
          chapterId: null,
          chapterVersion: null,
          position: 0,
          state: 'pending',
          attemptCount: 0,
          resultState: null,
          createdAt: now,
          updatedAt: now
        })
      }

      return {
        id: taskId,
        type,
        scopeJson,
        connectionId,
        state: 'queued',
        cancelRequested: false,
        inputTokens: 0,
        outputTokens: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        steps
      }
    })
  }

  getTask(sessionId: string, taskId: string): TaskDetail {
    return this.read(sessionId, (database) => {
      const row = database
        .prepare(
          'SELECT id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, error_code, error_message, created_at, updated_at, started_at, completed_at FROM task WHERE id = ?'
        )
        .get(taskId) as any
      if (!row) throw new ProjectError('VALIDATION_ERROR', '任务不存在')

      const stepRows = database
        .prepare(
          `SELECT ts.id, ts.task_id, ts.chapter_id, ts.chapter_version, ts.position, ts.state, ts.attempt_count, ts.checkpoint_json, ts.result_state, ts.created_at, ts.updated_at, c.title as chapter_title
           FROM task_step ts
           LEFT JOIN chapter c ON ts.chapter_id = c.id
           WHERE ts.task_id = ?
           ORDER BY ts.position ASC`
        )
        .all(taskId) as any[]

      const steps: TaskStep[] = stepRows.map((s) => ({
        id: s.id,
        taskId: s.task_id,
        chapterId: s.chapter_id,
        chapterVersion: s.chapter_version,
        position: s.position,
        state: s.state,
        attemptCount: s.attempt_count,
        checkpointJson: s.checkpoint_json,
        resultState: s.result_state,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        chapterTitle: s.chapter_title ?? undefined
      }))

      return {
        id: row.id,
        type: row.type,
        scopeJson: row.scope_json,
        connectionId: row.connection_id,
        state: row.state,
        cancelRequested: Boolean(row.cancel_requested),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        steps
      }
    })
  }

  listTasks(sessionId: string, type?: string, state?: TaskState): TaskSummary[] {
    return this.read(sessionId, (database) => {
      let query = 'SELECT id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, error_code, error_message, created_at, updated_at, started_at, completed_at FROM task WHERE 1=1'
      const params: any[] = []
      if (type) {
        query += ' AND type = ?'
        params.push(type)
      }
      if (state) {
        query += ' AND state = ?'
        params.push(state)
      }
      query += ' ORDER BY created_at DESC'
      const rows = database.prepare(query).all(...params) as any[]
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        scopeJson: row.scope_json,
        connectionId: row.connection_id,
        state: row.state,
        cancelRequested: Boolean(row.cancel_requested),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at
      }))
    })
  }

  updateTask(
    sessionId: string,
    taskId: string,
    updates: {
      state?: TaskState
      cancelRequested?: boolean
      inputTokens?: number
      outputTokens?: number
      errorCode?: string | null
      errorMessage?: string | null
      startedAt?: number | null
      completedAt?: number | null
    }
  ): void {
    this.transaction(sessionId, (database) => {
      const now = Date.now()
      const sets: string[] = ['updated_at = ?']
      const params: any[] = [now]
      if (updates.state !== undefined) {
        sets.push('state = ?')
        params.push(updates.state)
      }
      if (updates.cancelRequested !== undefined) {
        sets.push('cancel_requested = ?')
        params.push(updates.cancelRequested ? 1 : 0)
      }
      if (updates.inputTokens !== undefined) {
        sets.push('input_tokens = ?')
        params.push(updates.inputTokens)
      }
      if (updates.outputTokens !== undefined) {
        sets.push('output_tokens = ?')
        params.push(updates.outputTokens)
      }
      if (updates.errorCode !== undefined) {
        sets.push('error_code = ?')
        params.push(updates.errorCode)
      }
      if (updates.errorMessage !== undefined) {
        sets.push('error_message = ?')
        params.push(updates.errorMessage)
      }
      if (updates.startedAt !== undefined) {
        sets.push('started_at = ?')
        params.push(updates.startedAt)
      }
      if (updates.completedAt !== undefined) {
        sets.push('completed_at = ?')
        params.push(updates.completedAt)
      }
      params.push(taskId)
      database.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    })
  }

  updateTaskStep(
    sessionId: string,
    stepId: string,
    updates: {
      state?: TaskStepState
      attemptCount?: number
      checkpointJson?: string | null
      resultState?: TaskStepResultState | null
    }
  ): void {
    this.transaction(sessionId, (database) => {
      const now = Date.now()
      const sets: string[] = ['updated_at = ?']
      const params: any[] = [now]
      if (updates.state !== undefined) {
        sets.push('state = ?')
        params.push(updates.state)
      }
      if (updates.attemptCount !== undefined) {
        sets.push('attempt_count = ?')
        params.push(updates.attemptCount)
      }
      if (updates.checkpointJson !== undefined) {
        sets.push('checkpoint_json = ?')
        params.push(updates.checkpointJson)
      }
      if (updates.resultState !== undefined) {
        sets.push('result_state = ?')
        params.push(updates.resultState)
      }
      params.push(stepId)
      database.prepare(`UPDATE task_step SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    })
  }

  retryTaskStep(sessionId: string, taskId: string, stepId: string): TaskSummary {
    return this.transaction(sessionId, (database) => {
      const step = database.prepare('SELECT id, task_id, state FROM task_step WHERE id = ? AND task_id = ?').get(stepId, taskId) as { id: string; task_id: string; state: string } | undefined
      if (!step) throw new ProjectError('VALIDATION_ERROR', '步骤不存在')
      if (step.state !== 'failed') throw new ProjectError('INVALID_STATE_TRANSITION', '只有失败的步骤可以重试')

      const now = Date.now()
      database.prepare("UPDATE task_step SET state = 'pending', updated_at = ? WHERE id = ?").run(now, stepId)
      database.prepare("UPDATE task SET state = 'queued', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(now, taskId)

      const row = database.prepare('SELECT id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, error_code, error_message, created_at, updated_at, started_at, completed_at FROM task WHERE id = ?').get(taskId) as any
      return {
        id: row.id,
        type: row.type,
        scopeJson: row.scope_json,
        connectionId: row.connection_id,
        state: row.state,
        cancelRequested: Boolean(row.cancel_requested),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at
      }
    })
  }

  skipTaskStep(sessionId: string, taskId: string, stepId: string): TaskSummary {
    return this.transaction(sessionId, (database) => {
      const step = database.prepare('SELECT id, task_id, state FROM task_step WHERE id = ? AND task_id = ?').get(stepId, taskId) as { id: string; task_id: string; state: string } | undefined
      if (!step) throw new ProjectError('VALIDATION_ERROR', '步骤不存在')
      if (step.state !== 'failed') throw new ProjectError('INVALID_STATE_TRANSITION', '只有失败的步骤可以跳过')

      const now = Date.now()
      database.prepare("UPDATE task_step SET state = 'skipped', updated_at = ? WHERE id = ?").run(now, stepId)
      database.prepare("UPDATE task SET state = 'queued', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(now, taskId)

      const row = database.prepare('SELECT id, type, scope_json, connection_id, state, cancel_requested, input_tokens, output_tokens, error_code, error_message, created_at, updated_at, started_at, completed_at FROM task WHERE id = ?').get(taskId) as any
      return {
        id: row.id,
        type: row.type,
        scopeJson: row.scope_json,
        connectionId: row.connection_id,
        state: row.state,
        cancelRequested: Boolean(row.cancel_requested),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at
      }
    })
  }

  cancelTask(sessionId: string, taskId: string): { success: true } {
    return this.transaction(sessionId, (database) => {
      const now = Date.now()
      const task = database.prepare('SELECT id, state FROM task WHERE id = ?').get(taskId) as { id: string; state: string } | undefined
      if (!task) throw new ProjectError('VALIDATION_ERROR', '任务不存在')
      if (task.state === 'queued') {
        database.prepare("UPDATE task SET state = 'cancelled', cancel_requested = 1, updated_at = ?, completed_at = ? WHERE id = ?").run(now, now, taskId)
        database.prepare("UPDATE task_step SET state = 'skipped', updated_at = ? WHERE task_id = ? AND state = 'pending'").run(now, taskId)
      } else {
        database.prepare('UPDATE task SET cancel_requested = 1, updated_at = ? WHERE id = ?').run(now, taskId)
      }
      return { success: true as const }
    })
  }

  // --- Phase 7: Single-Chapter Analysis Commit Gate ---

  commitChapterAnalysis(
    sessionId: string,
    input: {
      taskId: string
      stepId: string
      chapterId: string
      capturedChapterVersion: number
      capturedSourceHash: string
      summary: string
      semanticChunks?: Array<{ startOffset: number; endOffset: number; content: string }>
      suggestions?: Array<{
        knowledgeKind: KnowledgeKind
        normalizedSubject: string
        predicate: string
        valueJson: string
        displayText: string
        confidence?: number
        evidence?: { startOffset: number; endOffset: number; excerpt: string }
      }>
      consistencyIssues?: Array<{
        issueType: ConsistencyIssueType
        severity: ConsistencyIssueSeverity
        description: string
        evidence?: { startOffset: number; endOffset: number; excerpt: string }
      }>
    }
  ): { resultState: 'current' | 'stale'; semanticBoundariesApplied: boolean } {
    return this.transaction(sessionId, (database) => {
      const chapter = database
        .prepare('SELECT id, content, version FROM chapter WHERE id = ? AND deleted_at IS NULL')
        .get(input.chapterId) as { id: string; content: string; version: number } | undefined

      const now = Date.now()
      const currentContent = chapter?.content ?? ''
      const currentHash = createHash('sha256').update(currentContent).digest('hex')
      const isMatch = chapter && chapter.version === input.capturedChapterVersion && currentHash === input.capturedSourceHash
      const resultState: 'current' | 'stale' = isMatch ? 'current' : 'stale'

      let semanticBoundariesApplied = false

      // 1. Semantic Chunking (SPEC 6.6, SPEC 11.4)
      if (resultState === 'current' && input.semanticChunks && input.semanticChunks.length > 0) {
        let valid = true
        let expectedOffset = 0
        for (let i = 0; i < input.semanticChunks.length; i++) {
          const chunk = input.semanticChunks[i]
          if (chunk.startOffset !== expectedOffset || chunk.endOffset <= chunk.startOffset || chunk.endOffset > currentContent.length) {
            valid = false
            break
          }
          if (currentContent.slice(chunk.startOffset, chunk.endOffset) !== chunk.content) {
            valid = false
            break
          }
          expectedOffset = chunk.endOffset
        }
        if (valid && expectedOffset === currentContent.length) {
          database.prepare("UPDATE content_chunk SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(input.chapterId)
          const insertChunk = database.prepare(
            "INSERT INTO content_chunk(id, source_type, source_id, chapter_id, chapter_version, chunk_kind, start_offset, end_offset, content, state, created_at) VALUES (?, 'chapter', ?, ?, ?, 'semantic', ?, ?, ?, 'current', ?)"
          )
          for (const chunk of input.semanticChunks) {
            insertChunk.run(randomUUID(), input.chapterId, input.chapterId, chapter?.version ?? input.capturedChapterVersion, chunk.startOffset, chunk.endOffset, chunk.content, now)
          }
          database.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
          semanticBoundariesApplied = true
        }
      }

      // 2. Chapter Summary
      if (resultState === 'current') {
        database.prepare("UPDATE chapter_summary SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(input.chapterId)
      }
      database
        .prepare(
          'INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), input.chapterId, chapter?.version ?? input.capturedChapterVersion, input.summary, resultState, input.taskId, now)

      // 3. AI Fact Suggestions & Evidence
      if (input.suggestions) {
        for (const sug of input.suggestions) {
          const existing = database
            .prepare(
              "SELECT id, confidence, state FROM ai_fact_suggestion WHERE knowledge_kind = ? AND normalized_subject = ? AND predicate = ? AND state IN ('pending', 'conflict') LIMIT 1"
            )
            .get(sug.knowledgeKind, sug.normalizedSubject, sug.predicate) as { id: string; confidence: number | null; state: string } | undefined

          let suggestionId: string
          if (existing) {
            suggestionId = existing.id
            if (sug.confidence !== undefined && (existing.confidence === null || sug.confidence > existing.confidence)) {
              database
                .prepare('UPDATE ai_fact_suggestion SET display_text = ?, value_json = ?, confidence = ?, version = version + 1 WHERE id = ?')
                .run(sug.displayText, sug.valueJson, sug.confidence, suggestionId)
            }
          } else {
            let state: 'pending' | 'conflict' = 'pending'
            const activeEntry = database
              .prepare(
                "SELECT id, author_content FROM knowledge_entry WHERE knowledge_kind = ? AND (title = ? OR aliases_json LIKE ?) AND state = 'active' LIMIT 1"
              )
              .get(sug.knowledgeKind, sug.normalizedSubject, `%"${sug.normalizedSubject}"%`) as { id: string; author_content: string } | undefined

            if (activeEntry) {
              if (activeEntry.author_content && !activeEntry.author_content.includes(sug.displayText) && sug.confidence !== undefined && sug.confidence < 0.5) {
                state = 'conflict'
              }
            }

            suggestionId = randomUUID()
            database
              .prepare(
                'INSERT INTO ai_fact_suggestion(id, knowledge_entry_id, knowledge_kind, normalized_subject, predicate, value_json, display_text, state, confidence, analysis_task_id, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
              )
              .run(
                suggestionId,
                activeEntry?.id ?? null,
                sug.knowledgeKind,
                sug.normalizedSubject,
                sug.predicate,
                sug.valueJson,
                sug.displayText,
                state,
                sug.confidence ?? null,
                input.taskId,
                now
              )
          }

          if (sug.evidence) {
            database
              .prepare(
                'INSERT INTO source_evidence(id, owner_type, owner_id, chapter_id, chapter_version, start_offset, end_offset, excerpt, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
              )
              .run(
                randomUUID(),
                'ai_fact_suggestion',
                suggestionId,
                input.chapterId,
                chapter?.version ?? input.capturedChapterVersion,
                Math.max(0, sug.evidence.startOffset),
                Math.max(0, sug.evidence.endOffset),
                sug.evidence.excerpt,
                resultState === 'current' ? 'valid' : 'stale',
                now
              )
          }
        }
      }

      // 4. Consistency Issues & Evidence
      if (input.consistencyIssues) {
        for (const issue of input.consistencyIssues) {
          const issueId = randomUUID()
          database
            .prepare(
              'INSERT INTO consistency_issue(id, chapter_id, chapter_version, issue_type, severity, description, version, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)'
            )
            .run(
              issueId,
              input.chapterId,
              chapter?.version ?? input.capturedChapterVersion,
              issue.issueType,
              issue.severity,
              issue.description,
              resultState === 'current' ? 'open' : 'stale',
              input.taskId,
              now
            )

          if (issue.evidence) {
            database
              .prepare(
                'INSERT INTO source_evidence(id, owner_type, owner_id, chapter_id, chapter_version, start_offset, end_offset, excerpt, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
              )
              .run(
                randomUUID(),
                'consistency_issue',
                issueId,
                input.chapterId,
                chapter?.version ?? input.capturedChapterVersion,
                Math.max(0, issue.evidence.startOffset),
                Math.max(0, issue.evidence.endOffset),
                issue.evidence.excerpt,
                resultState === 'current' ? 'valid' : 'stale',
                now
              )
          }
        }
      }

      // 5. Update step state
      database
        .prepare("UPDATE task_step SET state = 'completed', result_state = ?, updated_at = ? WHERE id = ?")
        .run(resultState, now, input.stepId)

      return { resultState, semanticBoundariesApplied }
    })
  }

  // --- Phase 7: Book Synopsis ---

  commitBookSynopsis(sessionId: string, summary: string, sourceVersionsJson: string, taskId: string, isStale = false): BookSynopsis {
    return this.transaction(sessionId, (database) => {
      const now = Date.now()
      if (!isStale) {
        database.prepare("UPDATE book_synopsis SET state = 'stale' WHERE state = 'current'").run()
      }
      const id = randomUUID()
      const state = isStale ? 'stale' : 'current'
      database
        .prepare('INSERT INTO book_synopsis(id, summary, source_versions_json, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, summary, sourceVersionsJson, state, taskId, now)
      return {
        id,
        summary,
        sourceVersionsJson,
        state,
        analysisTaskId: taskId,
        createdAt: now
      }
    })
  }

  getSynopsis(sessionId: string): BookSynopsis | null {
    return this.read(sessionId, (database) => {
      const row = database
        .prepare("SELECT id, summary, source_versions_json, state, analysis_task_id, created_at FROM book_synopsis ORDER BY CASE WHEN state = 'current' THEN 0 ELSE 1 END, created_at DESC LIMIT 1")
        .get() as any
      if (!row) return null
      return {
        id: row.id,
        summary: row.summary,
        sourceVersionsJson: row.source_versions_json,
        state: row.state,
        analysisTaskId: row.analysis_task_id,
        createdAt: row.created_at
      }
    })
  }

  // --- Phase 7: Chapter Summary ---

  getChapterSummary(sessionId: string, chapterId: string): ChapterSummary | null {
    return this.read(sessionId, (database) => {
      const row = database
        .prepare("SELECT cs.id, cs.chapter_id, cs.chapter_version, cs.summary, cs.state, cs.analysis_task_id, cs.created_at, c.title as chapter_title FROM chapter_summary cs LEFT JOIN chapter c ON cs.chapter_id = c.id WHERE cs.chapter_id = ? ORDER BY CASE WHEN cs.state = 'current' THEN 0 ELSE 1 END, cs.created_at DESC LIMIT 1")
        .get(chapterId) as any
      if (!row) return null
      return {
        id: row.id,
        chapterId: row.chapter_id,
        chapterVersion: row.chapter_version,
        summary: row.summary,
        state: row.state,
        analysisTaskId: row.analysis_task_id,
        createdAt: row.created_at,
        chapterTitle: row.chapter_title ?? undefined
      }
    })
  }

  listChapterSummaries(sessionId: string): ChapterSummary[] {
    return this.read(sessionId, (database) => {
      const rows = database
        .prepare("SELECT cs.id, cs.chapter_id, cs.chapter_version, cs.summary, cs.state, cs.analysis_task_id, cs.created_at, c.title as chapter_title FROM chapter_summary cs LEFT JOIN chapter c ON cs.chapter_id = c.id WHERE cs.state = 'current' ORDER BY c.position ASC, cs.created_at DESC")
        .all() as any[]
      return rows.map((row) => ({
        id: row.id,
        chapterId: row.chapter_id,
        chapterVersion: row.chapter_version,
        summary: row.summary,
        state: row.state,
        analysisTaskId: row.analysis_task_id,
        createdAt: row.created_at,
        chapterTitle: row.chapter_title ?? undefined
      }))
    })
  }

  // --- Phase 7: Consistency Issues ---

  listConsistencyIssues(sessionId: string, filters?: { chapterId?: string; state?: ConsistencyIssueState; severity?: ConsistencyIssueSeverity }): ConsistencyIssue[] {
    return this.read(sessionId, (database) => {
      let query = `SELECT ci.id, ci.chapter_id, ci.chapter_version, ci.issue_type, ci.severity, ci.description, ci.version, ci.state, ci.analysis_task_id, ci.created_at, ci.reviewed_at, c.title as chapter_title
                   FROM consistency_issue ci
                   LEFT JOIN chapter c ON ci.chapter_id = c.id
                   WHERE 1=1`
      const params: any[] = []
      if (filters?.chapterId) {
        query += ' AND ci.chapter_id = ?'
        params.push(filters.chapterId)
      }
      if (filters?.state) {
        query += ' AND ci.state = ?'
        params.push(filters.state)
      }
      if (filters?.severity) {
        query += ' AND ci.severity = ?'
        params.push(filters.severity)
      }
      query += ' ORDER BY ci.created_at DESC'

      const rows = database.prepare(query).all(...params) as any[]
      const getEvidences = database.prepare(
        `SELECT se.id, se.owner_type, se.owner_id, se.chapter_id, se.chapter_version, se.start_offset, se.end_offset, se.excerpt, se.state, se.created_at, c.title as chapter_title
         FROM source_evidence se
         LEFT JOIN chapter c ON se.chapter_id = c.id
         WHERE se.owner_type = 'consistency_issue' AND se.owner_id = ?`
      )

      return rows.map((row) => {
        const evidenceRows = getEvidences.all(row.id) as any[]
        const evidences: SourceEvidence[] = evidenceRows.map((e) => ({
          id: e.id,
          ownerType: e.owner_type,
          ownerId: e.owner_id,
          chapterId: e.chapter_id,
          chapterVersion: e.chapter_version,
          startOffset: e.start_offset,
          endOffset: e.end_offset,
          excerpt: e.excerpt,
          state: e.state,
          createdAt: e.created_at,
          chapterTitle: e.chapter_title ?? undefined
        }))
        return {
          id: row.id,
          chapterId: row.chapter_id,
          chapterVersion: row.chapter_version,
          issueType: row.issue_type,
          severity: row.severity,
          description: row.description,
          version: row.version,
          state: row.state,
          analysisTaskId: row.analysis_task_id,
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at ?? undefined,
          chapterTitle: row.chapter_title ?? undefined,
          evidences
        }
      })
    })
  }

  reviewConsistencyIssue(sessionId: string, issueId: string, state: 'acknowledged' | 'dismissed', expectedVersion: number): ConsistencyIssue {
    return this.transaction(sessionId, (database) => {
      const row = database
        .prepare('SELECT id, chapter_id, chapter_version, issue_type, severity, description, version, state, analysis_task_id, created_at, reviewed_at FROM consistency_issue WHERE id = ?')
        .get(issueId) as any
      if (!row) throw new ProjectError('VALIDATION_ERROR', '一致性问题不存在')
      if (row.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '问题状态已被修改，请重新载入')

      const now = Date.now()
      database
        .prepare('UPDATE consistency_issue SET state = ?, version = version + 1, reviewed_at = ? WHERE id = ?')
        .run(state, now, issueId)

      const chapterRow = database.prepare('SELECT title FROM chapter WHERE id = ?').get(row.chapter_id) as { title: string } | undefined
      const evidenceRows = database
        .prepare(
          `SELECT se.id, se.owner_type, se.owner_id, se.chapter_id, se.chapter_version, se.start_offset, se.end_offset, se.excerpt, se.state, se.created_at, c.title as chapter_title
           FROM source_evidence se
           LEFT JOIN chapter c ON se.chapter_id = c.id
           WHERE se.owner_type = 'consistency_issue' AND se.owner_id = ?`
        )
        .all(issueId) as any[]

      const evidences: SourceEvidence[] = evidenceRows.map((e) => ({
        id: e.id,
        ownerType: e.owner_type,
        ownerId: e.owner_id,
        chapterId: e.chapter_id,
        chapterVersion: e.chapter_version,
        startOffset: e.start_offset,
        endOffset: e.end_offset,
        excerpt: e.excerpt,
        state: e.state,
        createdAt: e.created_at,
        chapterTitle: e.chapter_title ?? undefined
      }))

      return {
        id: row.id,
        chapterId: row.chapter_id,
        chapterVersion: row.chapter_version,
        issueType: row.issue_type,
        severity: row.severity,
        description: row.description,
        version: row.version + 1,
        state,
        analysisTaskId: row.analysis_task_id,
        createdAt: row.created_at,
        reviewedAt: now,
        chapterTitle: chapterRow?.title,
        evidences
      }
    })
  }

  // --- Phase 7: Literary Reports & Annotations ---

  createLiteraryReport(
    sessionId: string,
    scopeJson: string,
    chapterVersionsJson: string,
    connectionId: string | null,
    taskId: string | null,
    sectionsData: Array<{
      sectionType: ReportSectionType
      content: string
      conclusion: string
      position: number
      evidences?: Array<{ chapterId: string; chapterVersion: number; startOffset: number; endOffset: number; excerpt: string }>
    }>
  ): string {
    return this.transaction(sessionId, (database) => {
      const now = Date.now()
      database.prepare("UPDATE literary_report SET state = 'stale' WHERE state = 'current'").run()

      const reportId = randomUUID()
      database
        .prepare('INSERT INTO literary_report(id, scope_json, chapter_versions_json, state, connection_id, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(reportId, scopeJson, chapterVersionsJson, 'current', connectionId, taskId, now)

      const insertSection = database.prepare(
        'INSERT INTO report_section(id, literary_report_id, section_type, content, conclusion, position) VALUES (?, ?, ?, ?, ?, ?)'
      )
      const insertEvidence = database.prepare(
        'INSERT INTO source_evidence(id, owner_type, owner_id, chapter_id, chapter_version, start_offset, end_offset, excerpt, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )

      for (const sec of sectionsData) {
        const sectionId = randomUUID()
        insertSection.run(sectionId, reportId, sec.sectionType, sec.content, sec.conclusion, sec.position)
        if (sec.evidences) {
          for (const ev of sec.evidences) {
            insertEvidence.run(randomUUID(), 'report_section', sectionId, ev.chapterId, ev.chapterVersion, Math.max(0, ev.startOffset), Math.max(0, ev.endOffset), ev.excerpt, 'valid', now)
          }
        }
      }

      return reportId
    })
  }

  listLiteraryReports(sessionId: string): LiteraryReportSummary[] {
    return this.read(sessionId, (database) => {
      const rows = database
        .prepare(
          `SELECT lr.id, lr.scope_json, lr.chapter_versions_json, lr.state, lr.connection_id, lr.analysis_task_id, lr.created_at, COUNT(rs.id) as section_count
           FROM literary_report lr
           LEFT JOIN report_section rs ON lr.id = rs.literary_report_id
           GROUP BY lr.id
           ORDER BY lr.created_at DESC`
        )
        .all() as any[]

      return rows.map((r) => ({
        id: r.id,
        scopeJson: r.scope_json,
        chapterVersionsJson: r.chapter_versions_json,
        state: r.state,
        connectionId: r.connection_id ?? undefined,
        analysisTaskId: r.analysis_task_id ?? undefined,
        createdAt: r.created_at,
        sectionCount: Number(r.section_count) || 6
      }))
    })
  }

  getLiteraryReport(sessionId: string, reportId: string): LiteraryReportDetail {
    return this.read(sessionId, (database) => {
      const row = database
        .prepare('SELECT id, scope_json, chapter_versions_json, state, connection_id, analysis_task_id, created_at FROM literary_report WHERE id = ?')
        .get(reportId) as any
      if (!row) throw new ProjectError('VALIDATION_ERROR', '文学报告不存在')

      const sectionRows = database
        .prepare('SELECT id, literary_report_id, section_type, content, conclusion, position FROM report_section WHERE literary_report_id = ? ORDER BY position ASC')
        .all(reportId) as any[]

      const getEvidences = database.prepare(
        `SELECT se.id, se.owner_type, se.owner_id, se.chapter_id, se.chapter_version, se.start_offset, se.end_offset, se.excerpt, se.state, se.created_at, c.title as chapter_title
         FROM source_evidence se
         LEFT JOIN chapter c ON se.chapter_id = c.id
         WHERE se.owner_type = 'report_section' AND se.owner_id = ?`
      )

      const getAnnotations = database.prepare(
        'SELECT id, report_section_id, content, created_at, updated_at FROM report_annotation WHERE report_section_id = ? ORDER BY created_at ASC'
      )

      const sections: ReportSection[] = sectionRows.map((s) => {
        const evidenceRows = getEvidences.all(s.id) as any[]
        const annotationRows = getAnnotations.all(s.id) as any[]
        return {
          id: s.id,
          literaryReportId: s.literary_report_id,
          sectionType: s.section_type as ReportSectionType,
          content: s.content,
          conclusion: s.conclusion,
          position: s.position,
          evidences: evidenceRows.map((e) => ({
            id: e.id,
            ownerType: e.owner_type,
            ownerId: e.owner_id,
            chapterId: e.chapter_id,
            chapterVersion: e.chapter_version,
            startOffset: e.start_offset,
            endOffset: e.end_offset,
            excerpt: e.excerpt,
            state: e.state,
            createdAt: e.created_at,
            chapterTitle: e.chapter_title ?? undefined
          })),
          annotations: annotationRows.map((a) => ({
            id: a.id,
            reportSectionId: a.report_section_id,
            content: a.content,
            createdAt: a.created_at,
            updatedAt: a.updated_at
          }))
        }
      })

      return {
        id: row.id,
        scopeJson: row.scope_json,
        chapterVersionsJson: row.chapter_versions_json,
        state: row.state,
        connectionId: row.connection_id ?? undefined,
        analysisTaskId: row.analysis_task_id ?? undefined,
        createdAt: row.created_at,
        sectionCount: sections.length,
        sections
      }
    })
  }

  addReportAnnotation(sessionId: string, reportSectionId: string, content: string): ReportAnnotation {
    return this.transaction(sessionId, (database) => {
      const section = database.prepare('SELECT id FROM report_section WHERE id = ?').get(reportSectionId)
      if (!section) throw new ProjectError('VALIDATION_ERROR', '报告栏目不存在')

      const now = Date.now()
      const id = randomUUID()
      database
        .prepare('INSERT INTO report_annotation(id, report_section_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, reportSectionId, content, now, now)

      return {
        id,
        reportSectionId,
        content,
        createdAt: now,
        updatedAt: now
      }
    })
  }

  updateReportAnnotation(sessionId: string, annotationId: string, content: string): ReportAnnotation {
    return this.transaction(sessionId, (database) => {
      const existing = database.prepare('SELECT id, report_section_id, created_at FROM report_annotation WHERE id = ?').get(annotationId) as { id: string; report_section_id: string; created_at: number } | undefined
      if (!existing) throw new ProjectError('VALIDATION_ERROR', '批注不存在')

      const now = Date.now()
      database.prepare('UPDATE report_annotation SET content = ?, updated_at = ? WHERE id = ?').run(content, now, annotationId)

      return {
        id: existing.id,
        reportSectionId: existing.report_section_id,
        content,
        createdAt: existing.created_at,
        updatedAt: now
      }
    })
  }

  deleteReportAnnotation(sessionId: string, annotationId: string): { success: true } {
    return this.transaction(sessionId, (database) => {
      const res = database.prepare('DELETE FROM report_annotation WHERE id = ?').run(annotationId)
      if (res.changes === 0) throw new ProjectError('VALIDATION_ERROR', '批注不存在')
      return { success: true as const }
    })
  }

  private resolveConnectionId(connectionId: string): 'resolved' | 'unresolved' {
    if (!this.connectionStore) return 'unresolved'
    try {
      const conn = this.connectionStore.get(connectionId)
      return conn && conn.kind === 'generation' ? 'resolved' : 'unresolved'
    } catch {
      return 'unresolved'
    }
  }

  private readTaskRoutes(database: DatabaseHandle): OpenProjectResult['taskRoutes'] {
    try {
      const rows = database.prepare('SELECT id, task_type as taskType, connection_id as connectionId, version, updated_at as updatedAt FROM task_route ORDER BY task_type').all() as Array<{
        id: string
        taskType: TaskType
        connectionId: string
        version: number
        updatedAt: number
      }>
      return rows.flatMap((row) => {
        const resolution = this.resolveConnectionId(row.connectionId)
        const parsed = TaskRouteSummarySchema.safeParse({ ...row, resolution })
        return parsed.success ? [parsed.data] : []
      })
    } catch {
      return []
    }
  }

  // --- Outline Management (T01) ---

  getBookOutline(sessionId: string): BookOutline | null {
    return this.read(sessionId, (db) => {
      const row = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline ORDER BY updated_at DESC LIMIT 1').get() as BookOutlineRow | undefined
      return row ? mapBookOutline(row) : null
    })
  }

  saveBookOutline(sessionId: string, input: { content: string; expectedVersion?: number; state?: OutlineState; sourceVersions?: Record<string, number> }): BookOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline LIMIT 1').get() as BookOutlineRow | undefined
      const state = input.state ?? (existing?.state === 'confirmed' ? 'confirmed' : 'draft')
      const sourceVersionsJson = JSON.stringify(input.sourceVersions ?? (existing ? parseSourceVersions(existing.source_versions_json) : {}))

      if (!existing) {
        const id = randomUUID()
        db.prepare('INSERT INTO book_outline(id, content, source_versions_json, version, state, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(id, input.content, sourceVersionsJson, state, now, now)
        const row = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline WHERE id = ?').get(id) as BookOutlineRow
        return mapBookOutline(row)
      }

      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '全书大纲已被其他修改覆盖，请重新载入')
      }

      const nextVersion = existing.version + 1
      db.prepare('UPDATE book_outline SET content = ?, source_versions_json = ?, version = ?, state = ?, updated_at = ? WHERE id = ?').run(input.content, sourceVersionsJson, nextVersion, state, now, existing.id)
      const row = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline WHERE id = ?').get(existing.id) as BookOutlineRow
      return mapBookOutline(row)
    })
  }

  confirmBookOutline(sessionId: string, expectedVersion: number): BookOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline LIMIT 1').get() as BookOutlineRow | undefined
      if (!existing) {
        throw new ProjectError('VALIDATION_ERROR', '全书大纲不存在')
      }
      if (existing.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '全书大纲已被其他修改覆盖，请重新载入')
      }
      const nextVersion = existing.version + 1
      db.prepare("UPDATE book_outline SET state = 'confirmed', version = ?, updated_at = ? WHERE id = ?").run(nextVersion, now, existing.id)
      const row = db.prepare('SELECT id, content, source_versions_json, version, state, created_at, updated_at FROM book_outline WHERE id = ?').get(existing.id) as BookOutlineRow
      return mapBookOutline(row)
    })
  }

  listVolumeOutlines(sessionId: string): VolumeOutline[] {
    return this.read(sessionId, (db) => {
      const rows = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline ORDER BY position ASC').all() as VolumeOutlineRow[]
      return rows.map(mapVolumeOutline)
    })
  }

  getVolumeOutline(sessionId: string, volumeId: string): VolumeOutline {
    return this.read(sessionId, (db) => {
      const row = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline WHERE id = ?').get(volumeId) as VolumeOutlineRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '卷大纲不存在')
      return mapVolumeOutline(row)
    })
  }

  createVolumeOutline(sessionId: string, input: { title: string; content?: string }): VolumeOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const maxPosRow = db.prepare('SELECT MAX(position) as maxPos FROM volume_outline').get() as { maxPos: number | null } | undefined
      const nextPos = (maxPosRow?.maxPos ?? -1) + 1
      const id = randomUUID()
      db.prepare('INSERT INTO volume_outline(id, title, position, content, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').run(id, input.title.trim(), nextPos, input.content ?? '', 'draft', now, now)
      const row = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline WHERE id = ?').get(id) as VolumeOutlineRow
      return mapVolumeOutline(row)
    })
  }

  updateVolumeOutline(sessionId: string, volumeId: string, input: { title?: string; content?: string; state?: OutlineState }, expectedVersion: number): VolumeOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline WHERE id = ?').get(volumeId) as VolumeOutlineRow | undefined
      if (!existing) throw new ProjectError('VALIDATION_ERROR', '卷大纲不存在')
      if (existing.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '卷大纲已被其他修改覆盖，请重新载入')
      const nextVersion = existing.version + 1
      const newTitle = input.title !== undefined ? input.title.trim() : existing.title
      const newContent = input.content !== undefined ? input.content : existing.content
      const newState = input.state !== undefined ? input.state : existing.state
      db.prepare('UPDATE volume_outline SET title = ?, content = ?, state = ?, version = ?, updated_at = ? WHERE id = ?').run(newTitle, newContent, newState, nextVersion, now, volumeId)
      const row = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline WHERE id = ?').get(volumeId) as VolumeOutlineRow
      return mapVolumeOutline(row)
    })
  }

  deleteVolumeOutline(sessionId: string, volumeId: string, expectedVersion: number): { success: true } {
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, position, version FROM volume_outline WHERE id = ?').get(volumeId) as { id: string; position: number; version: number } | undefined
      if (!existing) throw new ProjectError('VALIDATION_ERROR', '卷大纲不存在')
      if (existing.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '卷大纲已被其他修改覆盖，请重新载入')
      db.prepare('DELETE FROM volume_outline WHERE id = ?').run(volumeId)
      const remaining = db.prepare('SELECT id FROM volume_outline ORDER BY position ASC').all() as Array<{ id: string }>
      const updatePos = db.prepare('UPDATE volume_outline SET position = ? WHERE id = ?')
      remaining.forEach((r, idx) => updatePos.run(idx, r.id))
      return { success: true }
    })
  }

  reorderVolumeOutlines(sessionId: string, items: Array<{ id: string; expectedVersion: number }>): VolumeOutline[] {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const all = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline').all() as VolumeOutlineRow[]
      const map = new Map(all.map((r) => [r.id, r]))
      if (items.length !== all.length) throw new ProjectError('VALIDATION_ERROR', '重排序列表数量不匹配')
      for (const item of items) {
        const existing = map.get(item.id)
        if (!existing) throw new ProjectError('VALIDATION_ERROR', `未找到卷大纲: ${item.id}`)
        if (existing.version !== item.expectedVersion) throw new ProjectError('VERSION_CONFLICT', '卷大纲已被其他修改覆盖，请重新载入')
      }
      db.prepare('UPDATE volume_outline SET position = -position - 1').run()
      const updatePos = db.prepare('UPDATE volume_outline SET position = ?, version = version + 1, updated_at = ? WHERE id = ?')
      items.forEach((item, idx) => {
        updatePos.run(idx, now, item.id)
      })
      const rows = db.prepare('SELECT id, title, position, content, version, state, created_at, updated_at FROM volume_outline ORDER BY position ASC').all() as VolumeOutlineRow[]
      return rows.map(mapVolumeOutline)
    })
  }

  listChapterOutlines(sessionId: string, chapterId: string): ChapterOutline[] {
    return this.read(sessionId, (db) => {
      const rows = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE chapter_id = ? ORDER BY created_at DESC').all(chapterId) as ChapterOutlineRow[]
      return rows.map(mapChapterOutline)
    })
  }

  getChapterOutline(sessionId: string, outlineId: string): ChapterOutline {
    return this.read(sessionId, (db) => {
      const row = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(outlineId) as ChapterOutlineRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '章大纲不存在')
      return mapChapterOutline(row)
    })
  }

  getLatestChapterOutline(sessionId: string, chapterId: string): ChapterOutline | null {
    return this.read(sessionId, (db) => {
      const confirmedRow = db.prepare("SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE chapter_id = ? AND state IN ('confirmed', 'current') ORDER BY updated_at DESC LIMIT 1").get(chapterId) as ChapterOutlineRow | undefined
      if (confirmedRow) return mapChapterOutline(confirmedRow)
      const latestRow = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE chapter_id = ? ORDER BY updated_at DESC LIMIT 1').get(chapterId) as ChapterOutlineRow | undefined
      return latestRow ? mapChapterOutline(latestRow) : null
    })
  }

  saveChapterOutline(sessionId: string, input: { chapterId: string; content: string; volumeId?: string | null; expectedVersion?: number; outlineId?: string; state?: OutlineState }): ChapterOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const chapRow = db.prepare('SELECT id, version FROM chapter WHERE id = ? AND deleted_at IS NULL').get(input.chapterId) as { id: string; version: number } | undefined
      if (!chapRow) throw new ProjectError('VALIDATION_ERROR', '章节不存在')

      if (input.outlineId) {
        const existing = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(input.outlineId) as ChapterOutlineRow | undefined
        if (!existing) throw new ProjectError('VALIDATION_ERROR', '章大纲记录不存在')
        if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
          throw new ProjectError('VERSION_CONFLICT', '章大纲已被其他修改覆盖，请重新载入')
        }
        const nextVersion = existing.version + 1
        const nextVolumeId = input.volumeId !== undefined ? input.volumeId : existing.volume_id
        const nextState = input.state !== undefined ? input.state : existing.state
        db.prepare('UPDATE chapter_outline SET content = ?, volume_id = ?, chapter_version = ?, state = ?, version = ?, updated_at = ? WHERE id = ?').run(input.content, nextVolumeId, chapRow.version, nextState, nextVersion, now, input.outlineId)
        const row = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(input.outlineId) as ChapterOutlineRow
        return mapChapterOutline(row)
      }

      const id = randomUUID()
      const state = input.state ?? 'draft'
      db.prepare('INSERT INTO chapter_outline(id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').run(id, input.chapterId, input.volumeId ?? null, chapRow.version, input.content, state, now, now)
      const row = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(id) as ChapterOutlineRow
      return mapChapterOutline(row)
    })
  }

  confirmChapterOutline(sessionId: string, outlineId: string, expectedVersion: number): ChapterOutline {
    const now = Date.now()
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(outlineId) as ChapterOutlineRow | undefined
      if (!existing) throw new ProjectError('VALIDATION_ERROR', '章大纲记录不存在')
      if (existing.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '章大纲已被其他修改覆盖，请重新载入')

      const chapRow = db.prepare('SELECT id, version FROM chapter WHERE id = ? AND deleted_at IS NULL').get(existing.chapter_id) as { id: string; version: number } | undefined
      if (!chapRow) throw new ProjectError('VALIDATION_ERROR', '关联章节不存在')

      db.prepare("UPDATE chapter_outline SET state = 'stale', updated_at = ? WHERE chapter_id = ? AND id != ? AND state IN ('confirmed', 'current')").run(now, existing.chapter_id, outlineId)

      const nextVersion = existing.version + 1
      db.prepare("UPDATE chapter_outline SET state = 'confirmed', chapter_version = ?, version = ?, updated_at = ? WHERE id = ?").run(chapRow.version, nextVersion, now, outlineId)
      const row = db.prepare('SELECT id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at FROM chapter_outline WHERE id = ?').get(outlineId) as ChapterOutlineRow
      return mapChapterOutline(row)
    })
  }

  deleteChapterOutline(sessionId: string, outlineId: string, expectedVersion: number): { success: true } {
    return this.transaction(sessionId, (db) => {
      const existing = db.prepare('SELECT id, version FROM chapter_outline WHERE id = ?').get(outlineId) as { id: string; version: number } | undefined
      if (!existing) throw new ProjectError('VALIDATION_ERROR', '章大纲记录不存在')
      if (existing.version !== expectedVersion) throw new ProjectError('VERSION_CONFLICT', '章大纲已被其他修改覆盖，请重新载入')
      db.prepare('DELETE FROM chapter_outline WHERE id = ?').run(outlineId)
      return { success: true }
    })
  }

  private session(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) throw new ProjectError('PROJECT_NOT_OPEN', '项目会话不存在或已经关闭')
    return session
  }

  private readRecent(): RecentEntry[] {
    try {
      const entries = JSON.parse(readFileSync(this.recentPath, 'utf8')) as RecentEntry[]
      return entries.filter((entry) => typeof entry.path === 'string' && typeof entry.title === 'string' && Number.isInteger(entry.lastOpenedAt) && existsSync(entry.path))
    } catch {
      return []
    }
  }

  private writeRecent(summary: Pick<ProjectSummary, 'path' | 'title' | 'sourcePath'>): void {
    try {
      const key = pathKey(summary.path)
      const existing = this.readRecent().find((entry) => pathKey(entry.path) === key)
      const entries = this.readRecent().filter((entry) => pathKey(entry.path) !== key)
      const resolvedSourcePath = summary.sourcePath ?? existing?.sourcePath
      entries.unshift({
        path: summary.path,
        title: summary.title,
        lastOpenedAt: Date.now(),
        ...(resolvedSourcePath ? { sourcePath: resolvedSourcePath } : {})
      })
      writeFileSync(this.recentPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
    } catch {}
  }
}
