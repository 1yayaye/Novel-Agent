import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { ProjectError } from '../src/main/project-store'

describe('ModelGateway createEmbeddings', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  let tempDir: string
  let store: ConnectionStore
  let diagnostics: DiagnosticsService
  let gateway: ModelGateway

  beforeAll(() => new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (requestHandler) {
        requestHandler(req, res)
      } else {
        res.writeHead(404)
        res.end()
      }
    }).listen(0, '127.0.0.1', () => {
      const address = server.address()
      serverPort = typeof address === 'object' && address ? address.port : 0
      serverUrl = `http://127.0.0.1:${serverPort}/v1`
      resolve()
    })
  }))

  afterAll(() => new Promise<void>((resolve) => {
    server.close(() => resolve())
  }))

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-emb-test-'))
    store = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(store, diagnostics)
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('requires content target confirmation before sending content texts', async () => {
    const conn = store.create({
      name: 'Embedding Test',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small',
      apiKey: 'sk-test'
    })

    await expect(
      gateway.createEmbeddings({
        connectionId: conn.id,
        texts: ['测试正文片段'],
        isContentRequest: true
      })
    ).rejects.toThrow('连接目标端点尚未经过作者确认')
  })

  it('successfully creates embeddings and updates connection store metadata', async () => {
    const conn = store.create({
      name: 'Embedding Test',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small',
      apiKey: 'sk-test'
    })

    const expectedFingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, expectedFingerprint)

    requestHandler = async (req, res) => {
      expect(req.headers['authorization']).toBe('Bearer sk-test')
      expect(req.headers['content-type']).toBe('application/json')

      let body = ''
      for await (const chunk of req) {
        body += chunk
      }
      const json = JSON.parse(body)
      expect(json.model).toBe('text-embedding-3-small')
      expect(json.input).toEqual(['文本一', '文本二'])

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { embedding: [0.1, 0.2, 0.3, 0.4], index: 0 },
          { embedding: [0.5, 0.6, 0.7, 0.8], index: 1 }
        ],
        usage: {
          prompt_tokens: 12,
          total_tokens: 12
        }
      }))
    }

    const result = await gateway.createEmbeddings({
      connectionId: conn.id,
      texts: ['文本一', '文本二'],
      isContentRequest: true
    })

    expect(result.dimensions).toBe(4)
    expect(result.embeddings.length).toBe(2)
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(result.embeddings[1]).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(result.usage?.promptTokens).toBe(12)

    // Check that connection metadata was recorded
    const updated = store.get(conn.id)
    expect(updated.recentDimensions).toBe(4)
    expect(updated.connectionFingerprint).toBeTruthy()
  })

  it('handles empty input gracefully without network call', async () => {
    const conn = store.create({
      name: 'Empty Embedding',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small'
    })

    const result = await gateway.createEmbeddings({
      connectionId: conn.id,
      texts: []
    })

    expect(result.embeddings).toEqual([])
    expect(result.dimensions).toBe(0)
  })

  it('validates dimension consistency across batch and throws MODEL_OUTPUT_INVALID if mismatched', async () => {
    const conn = store.create({
      name: 'Mismatch Embedding',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small'
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5], index: 1 } // Mismatched dimension (2 vs 3)
        ]
      }))
    }

    await expect(
      gateway.createEmbeddings({
        connectionId: conn.id,
        texts: ['文本A', '文本B']
      })
    ).rejects.toThrow('Embedding 批次维度不一致')
  })

  it('retries transient 500 errors up to 2 times', async () => {
    const conn = store.create({
      name: 'Retry Embedding',
      kind: 'embedding',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'text-embedding-3-small'
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let attempts = 0
    requestHandler = (_req, res) => {
      attempts++
      if (attempts < 2) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal Server Error' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }]
        }))
      }
    }

    const result = await gateway.createEmbeddings({
      connectionId: conn.id,
      texts: ['文本重试测试']
    })

    expect(attempts).toBe(2)
    expect(result.embeddings.length).toBe(1)
  })
})
