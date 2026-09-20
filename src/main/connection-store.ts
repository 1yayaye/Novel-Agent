import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import {
  type ConfirmContentTargetResult,
  type CreateModelConnectionInput,
  type ModelCapabilities,
  type ModelConnectionKind,
  type ModelConnectionSummary,
  type SuccessResult,
  type UpdateModelConnectionInput
} from '../shared/project'
import { ProjectError } from './project-store'

interface StoredSecret {
  apiKey?: string
  customHeaders?: Record<string, string>
}

interface StoredConnectionRecord {
  id: string
  name: string
  kind: ModelConnectionKind
  baseUrl: string
  model: string
  isLocalService: boolean
  contextWindow: number
  maxOutputTokens: number
  safetyMarginRatio: number
  tokenEstimationRatio: number
  batchSize: number
  recentDimensions?: number | null
  connectionFingerprint?: string | null
  capabilities: ModelCapabilities
  version: number
  confirmedContentTargetFingerprint: string | null
  confirmedAt: number | null
  createdAt: number
  updatedAt: number
}

export function normalizeBaseUrl(urlStr: string): string {
  const trimmed = urlStr.trim()
  return trimmed.replace(/\/+$/, '')
}

export function validateBaseUrl(baseUrl: string, isLocalService: boolean): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new ProjectError('VALIDATION_ERROR', '无效的 Base URL 格式')
  }

  if (parsed.protocol === 'https:') {
    return
  }

  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase()
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    if (isLocalService && isLoopback) {
      return
    }
    throw new ProjectError('VALIDATION_ERROR', 'HTTP 协议仅在启用“本地服务”且目标为主机回环地址 (localhost / 127.0.0.1) 时允许')
  }

  throw new ProjectError('VALIDATION_ERROR', '模型连接仅支持 HTTPS 协议或本地 HTTP 服务')
}

export function calculateContentTargetFingerprint(baseUrl: string, model: string): string {
  const normalizedUrl = normalizeBaseUrl(baseUrl)
  const normalizedModel = model.trim()
  return createHash('sha256').update(`${normalizedUrl}:${normalizedModel}`).digest('hex').slice(0, 24)
}

export function getFinalEndpointUrl(baseUrl: string, kind: 'chat' | 'embeddings'): { url: string; host: string } {
  const normalized = normalizeBaseUrl(baseUrl)
  let finalUrl = normalized
  if (kind === 'chat') {
    if (normalized.endsWith('/chat/completions')) {
      finalUrl = normalized
    } else if (normalized.endsWith('/v1')) {
      finalUrl = `${normalized}/chat/completions`
    } else {
      finalUrl = `${normalized}/chat/completions`
    }
  } else {
    if (normalized.endsWith('/embeddings')) {
      finalUrl = normalized
    } else if (normalized.endsWith('/v1')) {
      finalUrl = `${normalized}/embeddings`
    } else {
      finalUrl = `${normalized}/embeddings`
    }
  }

  try {
    const parsed = new URL(finalUrl)
    return { url: finalUrl, host: parsed.host }
  } catch {
    return { url: finalUrl, host: '' }
  }
}

export function getModelsEndpointUrl(baseUrl: string): { url: string; host: string } {
  let normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) {
    normalized = normalized.slice(0, -'/chat/completions'.length)
  } else if (normalized.endsWith('/embeddings')) {
    normalized = normalized.slice(0, -'/embeddings'.length)
  }
  normalized = normalizeBaseUrl(normalized)

  const finalUrl = normalized.endsWith('/models') ? normalized : `${normalized}/models`

  try {
    const parsed = new URL(finalUrl)
    return { url: finalUrl, host: parsed.host }
  } catch {
    return { url: finalUrl, host: '' }
  }
}



export class ConnectionStore {
  private readonly configPath: string
  private readonly secretsDir: string
  private readonly fallbackKeyPath: string
  private fallbackMasterKey?: Buffer

  constructor(private readonly dataPath: string) {
    mkdirSync(dataPath, { recursive: true })
    this.configPath = join(dataPath, 'connections.json')
    this.secretsDir = join(dataPath, 'secrets')
    mkdirSync(this.secretsDir, { recursive: true })
    this.fallbackKeyPath = join(this.secretsDir, '.master.key')
  }

  list(kind?: ModelConnectionKind): ModelConnectionSummary[] {
    const connections = this.readConnections()
    const filtered = kind ? connections.filter((c) => c.kind === kind) : connections
    return filtered.map((c) => this.toSummary(c))
  }

  get(connectionId: string): ModelConnectionSummary {
    const conn = this.findConnection(connectionId)
    if (!conn) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')
    return this.toSummary(conn)
  }

  getInternal(connectionId: string): { connection: ModelConnectionSummary; secret: StoredSecret } {
    const conn = this.findConnection(connectionId)
    if (!conn) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')
    const secret = this.readSecret(connectionId)
    return { connection: this.toSummary(conn), secret }
  }

  create(input: CreateModelConnectionInput): ModelConnectionSummary {
    const normalizedUrl = normalizeBaseUrl(input.baseUrl)
    validateBaseUrl(normalizedUrl, input.isLocalService ?? false)

    const connections = this.readConnections()
    const now = Date.now()
    const id = randomUUID()

    const defaultCapabilities: ModelCapabilities = {
      streaming: input.capabilities?.streaming ?? true,
      jsonSchema: input.capabilities?.jsonSchema ?? true,
      temperature: input.capabilities?.temperature ?? true,
      usage: input.capabilities?.usage ?? true
    }

    const record: StoredConnectionRecord = {
      id,
      name: input.name.trim(),
      kind: input.kind,
      baseUrl: normalizedUrl,
      model: input.model.trim(),
      isLocalService: input.isLocalService ?? false,
      contextWindow: input.contextWindow ?? 128000,
      maxOutputTokens: input.maxOutputTokens ?? 4096,
      safetyMarginRatio: input.safetyMarginRatio ?? 0.1,
      tokenEstimationRatio: input.tokenEstimationRatio ?? 1.5,
      batchSize: input.batchSize ?? 16,
      capabilities: defaultCapabilities,
      version: 1,
      confirmedContentTargetFingerprint: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now
    }

    if (input.apiKey || input.customHeaders) {
      this.writeSecret(id, {
        apiKey: input.apiKey,
        customHeaders: input.customHeaders
      })
    }

    connections.push(record)
    this.writeConnections(connections)
    return this.toSummary(record)
  }

  update(input: UpdateModelConnectionInput): ModelConnectionSummary {
    const connections = this.readConnections()
    const index = connections.findIndex((c) => c.id === input.connectionId)
    if (index === -1) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')

    const existing = connections[index]
    if (existing.version !== input.expectedVersion) {
      throw new ProjectError('VERSION_CONFLICT', '模型连接已被其他修改覆盖，请重新载入')
    }

    const newBaseUrl = input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : existing.baseUrl
    const newIsLocalService = input.isLocalService !== undefined ? input.isLocalService : existing.isLocalService
    validateBaseUrl(newBaseUrl, newIsLocalService)

    const newModel = input.model !== undefined ? input.model.trim() : existing.model

    const urlOrModelChanged = newBaseUrl !== existing.baseUrl || newModel !== existing.model

    const nextVersion = existing.version + 1
    const now = Date.now()

    const updated: StoredConnectionRecord = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      kind: existing.kind,
      baseUrl: newBaseUrl,
      model: newModel,
      isLocalService: newIsLocalService,
      contextWindow: input.contextWindow !== undefined ? input.contextWindow : existing.contextWindow,
      maxOutputTokens: input.maxOutputTokens !== undefined ? input.maxOutputTokens : existing.maxOutputTokens,
      safetyMarginRatio: input.safetyMarginRatio !== undefined ? input.safetyMarginRatio : existing.safetyMarginRatio,
      tokenEstimationRatio: input.tokenEstimationRatio !== undefined ? input.tokenEstimationRatio : existing.tokenEstimationRatio,
      batchSize: input.batchSize !== undefined ? input.batchSize : existing.batchSize,
      capabilities: input.capabilities ? { ...existing.capabilities, ...input.capabilities } : existing.capabilities,
      version: nextVersion,
      confirmedContentTargetFingerprint: urlOrModelChanged ? null : existing.confirmedContentTargetFingerprint,
      confirmedAt: urlOrModelChanged ? null : existing.confirmedAt,
      updatedAt: now
    }

    if (input.apiKey !== undefined || input.customHeaders !== undefined) {
      const existingSecret = this.readSecret(input.connectionId)
      this.writeSecret(input.connectionId, {
        apiKey: input.apiKey !== undefined ? input.apiKey : existingSecret.apiKey,
        customHeaders: input.customHeaders !== undefined ? input.customHeaders : existingSecret.customHeaders
      })
    }

    connections[index] = updated
    this.writeConnections(connections)
    return this.toSummary(updated)
  }

  delete(connectionId: string, expectedVersion: number): SuccessResult {
    const connections = this.readConnections()
    const index = connections.findIndex((c) => c.id === connectionId)
    if (index === -1) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')

    const existing = connections[index]
    if (existing.version !== expectedVersion) {
      throw new ProjectError('VERSION_CONFLICT', '模型连接已被其他修改覆盖，请重新载入')
    }

    connections.splice(index, 1)
    this.writeConnections(connections)
    this.deleteSecret(connectionId)
    return { success: true }
  }

  confirmContentTarget(connectionId: string, displayedFingerprint: string): ConfirmContentTargetResult {
    const connections = this.readConnections()
    const index = connections.findIndex((c) => c.id === connectionId)
    if (index === -1) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')

    const existing = connections[index]
    const currentFingerprint = calculateContentTargetFingerprint(existing.baseUrl, existing.model)

    if (displayedFingerprint !== currentFingerprint) {
      throw new ProjectError('VALIDATION_ERROR', '联网目标指纹不匹配或端点配置已变更，请重新确认')
    }

    const now = Date.now()
    const updated: StoredConnectionRecord = {
      ...existing,
      confirmedContentTargetFingerprint: currentFingerprint,
      confirmedAt: now,
      version: existing.version + 1,
      updatedAt: now
    }

    connections[index] = updated
    this.writeConnections(connections)
    return {
      confirmedFingerprint: currentFingerprint,
      confirmedAt: now
    }
  }

  updateEmbeddingMetadata(connectionId: string, dimensions: number, fingerprint: string): void {
    const connections = this.readConnections()
    const index = connections.findIndex((c) => c.id === connectionId)
    if (index === -1) return
    const existing = connections[index]
    if (existing.recentDimensions === dimensions && existing.connectionFingerprint === fingerprint) return
    const updated: StoredConnectionRecord = {
      ...existing,
      recentDimensions: dimensions,
      connectionFingerprint: fingerprint,
      updatedAt: Date.now()
    }
    connections[index] = updated
    this.writeConnections(connections)
  }

  assertContentTargetConfirmed(connectionId: string): void {
    const conn = this.findConnection(connectionId)
    if (!conn) throw new ProjectError('CONNECTION_NOT_FOUND', '模型连接不存在')
    const currentFingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    if (!conn.confirmedContentTargetFingerprint || conn.confirmedContentTargetFingerprint !== currentFingerprint) {
      throw new ProjectError('CONTENT_TARGET_CONFIRMATION_REQUIRED', '连接目标端点尚未经过作者确认，请先确认联网目标')
    }
  }

  private findConnection(id: string): StoredConnectionRecord | undefined {
    return this.readConnections().find((c) => c.id === id)
  }

  private toSummary(record: StoredConnectionRecord): ModelConnectionSummary {
    const hasSecret = this.hasSecret(record.id)
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      baseUrl: record.baseUrl,
      model: record.model,
      isLocalService: record.isLocalService,
      contextWindow: record.contextWindow,
      maxOutputTokens: record.maxOutputTokens,
      safetyMarginRatio: record.safetyMarginRatio,
      tokenEstimationRatio: record.tokenEstimationRatio,
      batchSize: record.batchSize,
      recentDimensions: record.recentDimensions,
      connectionFingerprint: record.connectionFingerprint,
      capabilities: record.capabilities,
      hasSecret,
      version: record.version,
      confirmedContentTargetFingerprint: record.confirmedContentTargetFingerprint,
      confirmedAt: record.confirmedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  private hasSecret(connectionId: string): boolean {
    const secretPath = join(this.secretsDir, `${connectionId}.enc`)
    return existsSync(secretPath)
  }

  private readConnections(): StoredConnectionRecord[] {
    try {
      if (!existsSync(this.configPath)) return []
      const content = readFileSync(this.configPath, 'utf8')
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private writeConnections(connections: StoredConnectionRecord[]): void {
    writeFileSync(this.configPath, JSON.stringify(connections, null, 2), 'utf8')
  }

  private readSecret(connectionId: string): StoredSecret {
    const secretPath = join(this.secretsDir, `${connectionId}.enc`)
    if (!existsSync(secretPath)) return {}
    try {
      const buffer = readFileSync(secretPath)
      const decryptedJson = this.decrypt(buffer)
      return JSON.parse(decryptedJson) as StoredSecret
    } catch {
      return {}
    }
  }

  private writeSecret(connectionId: string, secret: StoredSecret): void {
    const secretPath = join(this.secretsDir, `${connectionId}.enc`)
    const raw = JSON.stringify(secret)
    const encrypted = this.encrypt(raw)
    writeFileSync(secretPath, encrypted)
  }

  private deleteSecret(connectionId: string): void {
    const secretPath = join(this.secretsDir, `${connectionId}.enc`)
    if (existsSync(secretPath)) {
      try {
        unlinkSync(secretPath)
      } catch {}
    }
  }

  private getFallbackMasterKey(create = false): Buffer {
    if (this.fallbackMasterKey) return this.fallbackMasterKey
    if (existsSync(this.fallbackKeyPath)) {
      try {
        const existingKey = readFileSync(this.fallbackKeyPath)
        if (existingKey.length === 32) {
          this.fallbackMasterKey = existingKey
          return existingKey
        }
      } catch {}
    }
    if (!create || !this.isTestFallbackAllowed()) {
      throw new ProjectError('CONNECTION_FAILED', '系统加密存储不可用，无法保存连接凭据')
    }
    const newKey = randomBytes(32)
    writeFileSync(this.fallbackKeyPath, newKey)
    this.fallbackMasterKey = newKey
    return newKey
  }

  private encrypt(plainText: string): Buffer {
    try {
      if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainText)
        return Buffer.concat([Buffer.from('SAFE:'), encrypted])
      }
    } catch {}

    if (!this.isTestFallbackAllowed()) {
      throw new ProjectError('CONNECTION_FAILED', '系统加密存储不可用，无法保存连接凭据')
    }

    const key = this.getFallbackMasterKey(true)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from('FALL:'), iv, tag, encrypted])
  }

  private decrypt(buffer: Buffer): string {
    const prefix = buffer.subarray(0, 5).toString('utf8')
    if (prefix === 'SAFE:') {
      const payload = buffer.subarray(5)
      return safeStorage.decryptString(payload)
    }

    if (prefix === 'FALL:') {
      const iv = buffer.subarray(5, 17)
      const tag = buffer.subarray(17, 33)
      const encrypted = buffer.subarray(33)
      const key = this.getFallbackMasterKey()
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    }

    // Direct plain JSON fallback if unencrypted or legacy
    return buffer.toString('utf8')
  }

  private isTestFallbackAllowed(): boolean {
    return process.env.VITEST === 'true' && process.env.NODE_ENV === 'test'
  }
}
