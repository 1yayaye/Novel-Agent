import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  DEFAULT_PRESET_STORE,
  PresetStoreDataSchema,
  type PresetStoreData,
  type PromptSettingsState,
  type PromptSnapshot,
  type NovelPromptPreset
} from '../shared/prompt-settings.js'
import { PROMPT_DEFINITION_FINGERPRINT } from './prompt-preset.js'
import { ProjectError } from './project-store.js'

export function presetContentFingerprint(preset: NovelPromptPreset): string {
  return createHash('sha256').update(JSON.stringify({
    name: preset.name,
    description: preset.description,
    blocks: preset.blocks.map((block) => ({
      name: block.name, role: block.role, content: block.content, enabled: block.enabled,
      position: block.position, depth: block.depth, order: block.order, marker: block.marker
    }))
  })).digest('hex')
}

export class PromptSettingsStore {
  private readonly configPath?: string
  private store: PresetStoreData = structuredClone(DEFAULT_PRESET_STORE)
  private warnings: string[] = []

  constructor(dataPath?: string) {
    if (!dataPath) return
    this.configPath = join(dataPath, 'prompt-presets.json')
    if (!existsSync(this.configPath)) return
    try {
      this.store = PresetStoreDataSchema.parse(JSON.parse(readFileSync(this.configPath, 'utf8')))
      this.updateConversionReports(this.store)
    } catch {
      this.warnings = ['预设库配置文件无法读取，已采用空预设库。原配置文件已保留，可检查后重新保存。']
    }
  }

  get(): PromptSettingsState {
    return { store: structuredClone(this.store), warnings: [...this.warnings] }
  }

  getActivePreset(): NovelPromptPreset | null {
    if (!this.store.activePresetId) return null
    const preset = this.store.presets.find((item) => item.id === this.store.activePresetId)
    return preset ? structuredClone(preset) : null
  }

  save(input: PresetStoreData): PromptSettingsState {
    const result = PresetStoreDataSchema.safeParse(input)
    if (!result.success) throw new ProjectError('VALIDATION_ERROR', '预设库数据格式无效')
    this.updateConversionReports(result.data)
    if (this.configPath) {
      try {
        mkdirSync(dirname(this.configPath), { recursive: true })
        const temporaryPath = `${this.configPath}.tmp`
        writeFileSync(temporaryPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8')
        renameSync(temporaryPath, this.configPath)
      } catch {
        throw new ProjectError('DATABASE_ERROR', '保存预设库失败，请检查数据目录是否可写')
      }
    }
    this.store = result.data
    this.warnings = []
    return this.get()
  }

  private updateConversionReports(store: PresetStoreData): void {
    for (const preset of store.presets) {
      if (preset.conversionReport) {
        preset.conversionReport.modified = presetContentFingerprint(preset) !== preset.conversionReport.convertedFingerprint
      }
    }
  }

  snapshot(connection?: {
    id: string
    version: number
    contextWindow: number
    maxOutputTokens: number
    safetyMarginRatio: number
    tokenEstimationRatio: number
  }): PromptSnapshot {
    const activePreset = this.getActivePreset()
    const definitionFingerprint = PROMPT_DEFINITION_FINGERPRINT
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ activePreset, definitionFingerprint }))
      .digest('hex')
    const budget = connection ? {
      connectionId: connection.id,
      connectionVersion: connection.version,
      contextWindow: connection.contextWindow,
      maxOutputTokens: connection.maxOutputTokens,
      safetyMarginRatio: connection.safetyMarginRatio,
      tokenEstimationRatio: connection.tokenEstimationRatio
    } : undefined
    return { activePreset, definitionFingerprint, fingerprint, budget }
  }
}
