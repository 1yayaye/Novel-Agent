import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CreativeRule,
  InstructionPreset,
  StyleSample,
  SuccessResult
} from '../shared/project'
import { ProjectError, ProjectStore } from './project-store'
import type { SearchIndex } from './search-index'

type StyleSampleRow = {
  id: string
  name: string
  content: string
  tags_json: string
  version: number
  created_at: number
  updated_at: number
}

type InstructionPresetRow = {
  id: string
  task_type: 'chat' | 'knowledge' | 'report' | 'continue' | 'rewrite' | 'polish'
  name: string
  instruction: string
  version: number
  created_at: number
  updated_at: number
}

function parseJsonArray(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapStyleSample(row: StyleSampleRow): StyleSample {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    tags: parseJsonArray(row.tags_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapInstructionPreset(row: InstructionPresetRow): InstructionPreset {
  return {
    id: row.id,
    taskType: row.task_type,
    name: row.name,
    instruction: row.instruction,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class CreativeRepository {
  constructor(
    private readonly store: ProjectStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  getRules(sessionId: string): CreativeRule {
    return this.store.read(sessionId, (db) => {
      const meta = db.prepare('SELECT creative_rules, version FROM project_meta LIMIT 1').get() as {
        creative_rules: string
        version: number
      } | undefined

      if (!meta) {
        throw new ProjectError('DATABASE_ERROR', '缺少项目元数据')
      }

      return {
        content: meta.creative_rules,
        version: meta.version
      }
    })
  }

  updateRules(sessionId: string, content: string, expectedVersion: number): CreativeRule {
    let newVersion = 0
    this.store.transaction(sessionId, (db) => {
      const meta = db.prepare('SELECT version FROM project_meta LIMIT 1').get() as { version: number } | undefined
      if (!meta) throw new ProjectError('DATABASE_ERROR', '缺少项目元数据')
      if (meta.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '创作规则已被其他修改覆盖，请重新载入')
      }

      const now = Date.now()
      newVersion = meta.version + 1
      db.prepare(`
        UPDATE project_meta
        SET creative_rules = ?, version = ?, search_revision = search_revision + 1, updated_at = ?
      `).run(content, newVersion, now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return { content, version: newVersion }
  }

  listSamples(sessionId: string): StyleSample[] {
    return this.store.read(sessionId, (db) => {
      const rows = db.prepare('SELECT id, name, content, tags_json, version, created_at, updated_at FROM style_sample ORDER BY created_at ASC').all() as StyleSampleRow[]
      return rows.map(mapStyleSample)
    })
  }

  getSample(sessionId: string, sampleId: string): StyleSample {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare('SELECT id, name, content, tags_json, version, created_at, updated_at FROM style_sample WHERE id = ?').get(sampleId) as StyleSampleRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '风格样本不存在')
      return mapStyleSample(row)
    })
  }

  createSample(sessionId: string, name: string, content: string, tags: string[] = []): StyleSample {
    const id = randomUUID()
    const now = Date.now()
    const tagsJson = JSON.stringify(tags)

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO style_sample(id, name, content, tags_json, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(id, name, content, tagsJson, now, now)

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return {
      id,
      name,
      content,
      tags,
      version: 1,
      createdAt: now,
      updatedAt: now
    }
  }

  updateSample(
    sessionId: string,
    sampleId: string,
    name: string,
    content: string,
    tags: string[] = [],
    expectedVersion: number
  ): StyleSample {
    const now = Date.now()
    const tagsJson = JSON.stringify(tags)
    let updatedSample: StyleSample | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, version, created_at FROM style_sample WHERE id = ?').get(sampleId) as {
        id: string
        version: number
        created_at: number
      } | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '风格样本不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '风格样本已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE style_sample
        SET name = ?, content = ?, tags_json = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(name, content, tagsJson, nextVersion, now, sampleId)

      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)

      updatedSample = {
        id: sampleId,
        name,
        content,
        tags,
        version: nextVersion,
        createdAt: row.created_at,
        updatedAt: now
      }
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return updatedSample!
  }

  deleteSample(sessionId: string, sampleId: string, expectedVersion: number): SuccessResult {
    const now = Date.now()
    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, version FROM style_sample WHERE id = ?').get(sampleId) as {
        id: string
        version: number
      } | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '风格样本不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '风格样本已被其他修改覆盖，请重新载入')
      }

      db.prepare('DELETE FROM style_sample WHERE id = ?').run(sampleId)
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    return { success: true }
  }

  listPresets(sessionId: string, taskType?: 'chat' | 'knowledge' | 'report' | 'continue' | 'rewrite' | 'polish'): InstructionPreset[] {
    return this.store.read(sessionId, (db) => {
      let rows: InstructionPresetRow[]
      if (taskType) {
        rows = db.prepare('SELECT id, task_type, name, instruction, version, created_at, updated_at FROM instruction_preset WHERE task_type = ? ORDER BY created_at ASC').all(taskType) as InstructionPresetRow[]
      } else {
        rows = db.prepare('SELECT id, task_type, name, instruction, version, created_at, updated_at FROM instruction_preset ORDER BY created_at ASC').all() as InstructionPresetRow[]
      }
      return rows.map(mapInstructionPreset)
    })
  }

  getPreset(sessionId: string, presetId: string): InstructionPreset {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare('SELECT id, task_type, name, instruction, version, created_at, updated_at FROM instruction_preset WHERE id = ?').get(presetId) as InstructionPresetRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '指令预设不存在')
      return mapInstructionPreset(row)
    })
  }

  createPreset(
    sessionId: string,
    taskType: 'chat' | 'knowledge' | 'report' | 'continue' | 'rewrite' | 'polish',
    name: string,
    instruction: string
  ): InstructionPreset {
    const id = randomUUID()
    const now = Date.now()

    this.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO instruction_preset(id, task_type, name, instruction, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(id, taskType, name, instruction, now, now)
    })

    return {
      id,
      taskType,
      name,
      instruction,
      version: 1,
      createdAt: now,
      updatedAt: now
    }
  }

  updatePreset(
    sessionId: string,
    presetId: string,
    name: string,
    instruction: string,
    expectedVersion: number
  ): InstructionPreset {
    const now = Date.now()
    let updatedPreset: InstructionPreset | undefined

    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, task_type, version, created_at FROM instruction_preset WHERE id = ?').get(presetId) as InstructionPresetRow | undefined
      if (!row) throw new ProjectError('VALIDATION_ERROR', '指令预设不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '指令预设已被其他修改覆盖，请重新载入')
      }

      const nextVersion = row.version + 1
      db.prepare(`
        UPDATE instruction_preset
        SET name = ?, instruction = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(name, instruction, nextVersion, now, presetId)

      updatedPreset = {
        id: presetId,
        taskType: row.task_type,
        name,
        instruction,
        version: nextVersion,
        createdAt: row.created_at,
        updatedAt: now
      }
    })

    return updatedPreset!
  }

  deletePreset(sessionId: string, presetId: string, expectedVersion: number): SuccessResult {
    this.store.transaction(sessionId, (db) => {
      const row = db.prepare('SELECT id, version FROM instruction_preset WHERE id = ?').get(presetId) as {
        id: string
        version: number
      } | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '指令预设不存在')
      if (row.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '指令预设已被其他修改覆盖，请重新载入')
      }

      db.prepare('DELETE FROM instruction_preset WHERE id = ?').run(presetId)
    })

    return { success: true }
  }
}
