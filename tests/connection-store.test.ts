import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConnectionStore,
  calculateContentTargetFingerprint,
  getFinalEndpointUrl,
  getModelsEndpointUrl,
  normalizeBaseUrl
} from '../src/main/connection-store'
import { ProjectError } from '../src/main/project-store'

describe('ConnectionStore', () => {
  let tempDir: string
  let store: ConnectionStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-conn-test-'))
    store = new ConnectionStore(tempDir)
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  describe('URL normalization and preview', () => {
    it('normalizes base URLs and calculates final endpoints', () => {
      expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
      expect(normalizeBaseUrl('  https://api.siliconflow.cn/v1  ')).toBe('https://api.siliconflow.cn/v1')

      const chatEndpoint = getFinalEndpointUrl('https://api.openai.com/v1', 'chat')
      expect(chatEndpoint.url).toBe('https://api.openai.com/v1/chat/completions')
      expect(chatEndpoint.host).toBe('api.openai.com')

      const embedEndpoint = getFinalEndpointUrl('https://api.openai.com/v1', 'embeddings')
      expect(embedEndpoint.url).toBe('https://api.openai.com/v1/embeddings')
      expect(embedEndpoint.host).toBe('api.openai.com')

      const modelsEndpoint = getModelsEndpointUrl('https://api.openai.com/v1')
      expect(modelsEndpoint.url).toBe('https://api.openai.com/v1/models')
      expect(modelsEndpoint.host).toBe('api.openai.com')

      const modelsEndpointFromChat = getModelsEndpointUrl('https://api.openai.com/v1/chat/completions')
      expect(modelsEndpointFromChat.url).toBe('https://api.openai.com/v1/models')
    })

    it('rejects plain HTTP for non-local remote services', () => {
      expect(() => {
        store.create({
          name: 'Remote Insecure',
          kind: 'generation',
          baseUrl: 'http://api.example.com/v1',
          model: 'gpt-4o',
          isLocalService: false
        })
      }).toThrowError(ProjectError)
    })

    it('allows loopback HTTP when isLocalService is true', () => {
      const conn = store.create({
        name: 'Local Ollama',
        kind: 'generation',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'qwen2.5:72b',
        isLocalService: true
      })
      expect(conn.id).toBeDefined()
      expect(conn.isLocalService).toBe(true)
    })
  })

  describe('CRUD and Version Control', () => {
    it('creates, reads, updates, and deletes model connections with secrets', () => {
      const created = store.create({
        name: 'SiliconFlow Qwen',
        kind: 'generation',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        apiKey: 'sk-secret-token-12345',
        customHeaders: { 'X-Custom-Auth': 'header-value' },
        contextWindow: 128000,
        maxOutputTokens: 4096
      })

      expect(created.version).toBe(1)
      expect(created.hasSecret).toBe(true)
      expect(created.confirmedContentTargetFingerprint).toBeNull()

      // Ensure secret is never exposed in summary
      expect((created as unknown as Record<string, unknown>).apiKey).toBeUndefined()

      // Internal fetch decrypts secret
      const internal = store.getInternal(created.id)
      expect(internal.secret.apiKey).toBe('sk-secret-token-12345')
      expect(internal.secret.customHeaders?.['X-Custom-Auth']).toBe('header-value')

      // Update name and maxOutputTokens
      const updated = store.update({
        connectionId: created.id,
        expectedVersion: 1,
        name: 'SiliconFlow Qwen 72B (Updated)',
        maxOutputTokens: 8192
      })

      expect(updated.version).toBe(2)
      expect(updated.name).toBe('SiliconFlow Qwen 72B (Updated)')
      expect(updated.maxOutputTokens).toBe(8192)

      // Optimistic lock conflict
      expect(() => {
        store.update({
          connectionId: created.id,
          expectedVersion: 1, // Stale version
          name: 'Conflict name'
        })
      }).toThrowError(ProjectError)

      // List filtering
      store.create({
        name: 'BGE-M3 Embeddings',
        kind: 'embedding',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'BAAI/bge-m3',
        batchSize: 32
      })

      const all = store.list()
      expect(all.length).toBe(2)

      const genOnly = store.list('generation')
      expect(genOnly.length).toBe(1)
      expect(genOnly[0].kind).toBe('generation')

      const embedOnly = store.list('embedding')
      expect(embedOnly.length).toBe(1)
      expect(embedOnly[0].kind).toBe('embedding')

      // Delete
      const delResult = store.delete(created.id, 2)
      expect(delResult.success).toBe(true)
      expect(store.list('generation').length).toBe(0)
    })
  })

  describe('Content Target Confirmation (SPEC 12.3)', () => {
    it('manages content target confirmation and invalidates on endpoint change', () => {
      const conn = store.create({
        name: 'DeepSeek Chat',
        kind: 'generation',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
      })

      const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
      expect(conn.confirmedContentTargetFingerprint).toBeNull()

      // Attempting to send content before confirmation fails
      expect(() => {
        store.assertContentTargetConfirmed(conn.id)
      }).toThrowError(/尚未经过作者确认/)

      // Confirm target with wrong fingerprint fails
      expect(() => {
        store.confirmContentTarget(conn.id, 'invalid-fingerprint')
      }).toThrowError(ProjectError)

      // Confirm target with matching fingerprint succeeds
      const confirmRes = store.confirmContentTarget(conn.id, fingerprint)
      expect(confirmRes.confirmedFingerprint).toBe(fingerprint)
      expect(confirmRes.confirmedAt).toBeGreaterThan(0)

      // Now content sending assertion succeeds
      expect(() => {
        store.assertContentTargetConfirmed(conn.id)
      }).not.toThrow()

      // Updating model clears confirmation
      const updatedModel = store.update({
        connectionId: conn.id,
        expectedVersion: 2, // was incremented by confirmContentTarget
        model: 'deepseek-reasoner'
      })

      expect(updatedModel.confirmedContentTargetFingerprint).toBeNull()
      expect(updatedModel.confirmedAt).toBeNull()

      // Content sending assertion fails again until re-confirmed
      expect(() => {
        store.assertContentTargetConfirmed(conn.id)
      }).toThrowError(/尚未经过作者确认/)
    })
  })

  it('rejects production credential writes when safeStorage is unavailable without changing old data', () => {
    const existing = store.create({
      name: 'Existing Secret',
      kind: 'generation',
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      apiKey: 'old-secret'
    })
    const secretPath = join(tempDir, 'secrets', `${existing.id}.enc`)
    const beforeSecret = readFileSync(secretPath)

    const originalVitest = process.env.VITEST
    const originalNodeEnv = process.env.NODE_ENV
    try {
      process.env.VITEST = 'false'
      process.env.NODE_ENV = 'production'

      expect(() => store.update({
        connectionId: existing.id,
        expectedVersion: existing.version,
        apiKey: 'new-secret'
      })).toThrowError(expect.objectContaining({ code: 'CONNECTION_FAILED' }))

      expect(readFileSync(secretPath)).toEqual(beforeSecret)
      expect(store.get(existing.id).version).toBe(existing.version)

      const freshPath = join(tempDir, 'fresh')
      const freshStore = new ConnectionStore(freshPath)
      expect(() => freshStore.create({
        name: 'Unavailable Secret',
        kind: 'generation',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        apiKey: 'new-secret'
      })).toThrowError(expect.objectContaining({ code: 'CONNECTION_FAILED' }))
      expect(readdirSync(join(freshPath, 'secrets'))).toEqual([])
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST
      else process.env.VITEST = originalVitest
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
    }
  })
})
