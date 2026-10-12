import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { ProjectError } from '../src/main/project-store'

describe('ModelGateway with mock HTTP/SSE server', () => {
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
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-gw-test-'))
    store = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(store, diagnostics)
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('tests connection with ping without requiring target confirmation', async () => {
    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Pong' } }]
      }))
    }

    const testRes = await gateway.testConnection({
      draft: {
        baseUrl: serverUrl,
        model: 'test-model',
        apiKey: 'test-key',
        isLocalService: true
      }
    })

    expect(testRes.success).toBe(true)
    expect(testRes.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('streams Chat Completions via SSE and gathers tokens', async () => {
    const conn = store.create({
      name: 'Stream Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-stream-model',
      isLocalService: true
    })

    // Confirm target
    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":" World"}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }, 20)
    }

    const chunks: string[] = []
    let totalUsage: unknown

    for await (const chunk of gateway.chatCompletionStream({
      connectionId: conn.id,
      messages: [{ role: 'user', content: 'Say hello' }]
    })) {
      if (chunk.text) chunks.push(chunk.text)
      if (chunk.usage) totalUsage = chunk.usage
    }

    expect(chunks.join('')).toBe('Hello World')
    expect(totalUsage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12
    })
  })

  it('holds a connection queue slot until streaming ends and releases it on cancellation', async () => {
    const conn = store.create({
      name: 'Queued Stream Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-queued-stream-model',
      isLocalService: true
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let requestCount = 0
    let activeRequests = 0
    let maxActiveRequests = 0
    let firstRequestResolve!: () => void
    let firstRelease!: () => void
    const firstRequest = new Promise<void>((resolve) => { firstRequestResolve = resolve })

    requestHandler = (_req, res) => {
      requestCount++
      activeRequests++
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      res.on('close', () => { activeRequests-- })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (requestCount === 1) {
        res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
        firstRelease = () => {
          res.write('data: [DONE]\n\n')
        }
        firstRequestResolve()
        return
      }

      res.write('data: {"choices":[{"delta":{"content":"second"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const consume = (signal?: AbortSignal) => (async () => {
      let text = ''
      for await (const chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'queue test' }],
        signal
      })) {
        text += chunk.text
      }
      return text
    })()

    const first = consume()
    await firstRequest
    const second = consume()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(requestCount).toBe(1)

    firstRelease()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(requestCount).toBe(2)
    expect(maxActiveRequests).toBe(1)

    requestCount = 0
    let cancelledRequestResolve!: () => void
    const cancelledRequest = new Promise<void>((resolve) => { cancelledRequestResolve = resolve })
    requestHandler = (_req, res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (requestCount === 1) {
        res.write('data: {"choices":[{"delta":{"content":"cancelled"}}]}\n\n')
        cancelledRequestResolve()
        return
      }

      res.write('data: {"choices":[{"delta":{"content":"after-cancel"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const controller = new AbortController()
    const cancelled = consume(controller.signal)
    await cancelledRequest
    const afterCancel = consume()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(requestCount).toBe(1)

    controller.abort()
    await expect(cancelled).rejects.toBeDefined()
    await expect(afterCancel).resolves.toBe('after-cancel')
    expect(requestCount).toBe(2)
  })

  it('rejects content redirects without forwarding the request', async () => {
    const conn = store.create({
      name: 'Redirect Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-redirect-model',
      isLocalService: true
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let redirectTargetHits = 0
    requestHandler = (req, res) => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(307, { Location: '/redirect-target' })
        res.end()
        return
      }
      if (req.url === '/redirect-target') {
        redirectTargetHits++
      }
      res.writeHead(500)
      res.end()
    }

    await expect((async () => {
      for await (const _chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Do not forward this' }]
      })) {
        // iterate
      }
    })()).rejects.toMatchObject({ code: 'CONNECTION_FAILED' })

    expect(redirectTargetHits).toBe(0)
  })

  it('rejects a partial stream that reaches EOF without a completion signal', async () => {
    const conn = store.create({
      name: 'Truncated Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-truncated-model',
      isLocalService: true
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"content":"Partial"}}]}')
    }

    let received = ''
    await expect((async () => {
      for await (const chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Truncate this' }]
      })) {
        received += chunk.text
      }
    })()).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })

    expect(received).toBe('Partial')
  })

  it('detects empty model output and throws MODEL_OUTPUT_INVALID', async () => {
    const conn = store.create({
      name: 'Empty Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-empty-model',
      isLocalService: true
    })

    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: [DONE]\n\n')
      res.end()
    }

    await expect(async () => {
      for await (const _chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Empty test' }]
      })) {
        // iterate
      }
    }).rejects.toThrowError(/模型返回空输出/)
  })

  it('cancels in-flight streaming request on AbortSignal', async () => {
    const conn = store.create({
      name: 'Slow Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-slow-model',
      isLocalService: true
    })

    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"Part 1"}}]}\n\n')
      // Hang without ending
    }

    const controller = new AbortController()

    const streamPromise = (async () => {
      const chunks: string[] = []
      for await (const chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Slow test' }],
        signal: controller.signal
      })) {
        chunks.push(chunk.text)
        if (chunks.length === 1) {
          controller.abort()
        }
      }
    })()

    await expect(streamPromise).rejects.toThrowError(ProjectError)
  })

  it('retries on 429 rate limits and succeeds on retry', async () => {
    const conn = store.create({
      name: 'Rate Limit Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-429-model',
      isLocalService: true
    })

    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    let callCount = 0
    requestHandler = (_req, res) => {
      callCount++
      if (callCount === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"Success after 429"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }

    const chunks: string[] = []
    for await (const chunk of gateway.chatCompletionStream({
      connectionId: conn.id,
      messages: [{ role: 'user', content: 'Test retry' }]
    })) {
      if (chunk.text) chunks.push(chunk.text)
    }

    expect(chunks.join('')).toBe('Success after 429')
    expect(callCount).toBe(2)
  })

  it('immediately throws AUTH_FAILED on 401 without retrying', async () => {
    const conn = store.create({
      name: 'Auth Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-401-model',
      isLocalService: true
    })

    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    let callCount = 0
    requestHandler = (_req, res) => {
      callCount++
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid API Key' }))
    }

    await expect(async () => {
      for await (const _chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Test auth' }]
      })) {
        // iterate
      }
    }).rejects.toThrowError(/认证失败/)

    expect(callCount).toBe(1)
  })

  it('keeps provider error bodies out of the general task log', async () => {
    const conn = store.create({
      name: 'Error Logging Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-error-logging-model',
      isLocalService: true
    })

    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' })
      res.end(JSON.stringify({ error: 'AUDIT_SECRET_MARKER' }))
    }

    await expect((async () => {
      for await (const _chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Trigger a provider error' }]
      })) {
        // iterate
      }
    })()).rejects.toThrowError(/服务限流/)

    const log = readFileSync(join(tempDir, 'logs', 'events.log'), 'utf8')
    expect(log).not.toContain('AUDIT_SECRET_MARKER')
    expect(log).toContain('"error":"RATE_LIMITED"')
  })

  it('handles structured JSON with one-time minimal repair fallback', async () => {
    const conn = store.create({
      name: 'JSON Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-json-model',
      isLocalService: true,
      capabilities: {
        streaming: false,
        jsonSchema: true,
        temperature: true,
        usage: true
      }
    })

    const fingerprint = calculateContentTargetFingerprint(conn.baseUrl, conn.model)
    store.confirmContentTarget(conn.id, fingerprint)

    const schema = z.object({
      name: z.string(),
      age: z.number().int()
    })

    let callCount = 0
    requestHandler = (_req, res) => {
      callCount++
      if (callCount === 1) {
        // Invalid response missing age
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: '{"name": "John"}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
        }))
      } else {
        // Repaired response
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: '{"name": "John", "age": 30}' } }],
          usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
        }))
      }
    }

    const result = await gateway.generateStructuredJson({
      connectionId: conn.id,
      messages: [{ role: 'user', content: 'Generate person' }],
      jsonSchema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name', 'age'] },
      zodSchema: schema
    })

    expect(result.data).toEqual({ name: 'John', age: 30 })
    expect(callCount).toBe(2)
    expect(result.usage?.totalTokens).toBe(75)
  })

  it('aborts an idle structured response before retrying the same connection', async () => {
    const conn = store.create({
      name: 'Idle JSON Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-idle-json-model',
      isLocalService: true,
      capabilities: {
        streaming: false,
        jsonSchema: true,
        temperature: true,
        usage: true
      }
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const schema = z.object({ ok: z.boolean() })
    let requestCount = 0
    let firstRequestStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => { firstRequestStarted = resolve })
    requestHandler = (_req, res) => {
      requestCount++
      if (requestCount === 1) {
        firstRequestStarted()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))
    }

    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const pending = gateway.generateStructuredJson({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Wait for a response' }],
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        zodSchema: schema
      })

      await firstStarted
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(1_100)

      await expect(pending).resolves.toMatchObject({ data: { ok: true } })
      expect(requestCount).toBe(2)
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('fetches remote models with standard OpenAI list format', async () => {
    requestHandler = (req, res) => {
      expect(req.method).toBe('GET')
      expect(req.url).toBe('/v1/models')
      expect(req.headers['authorization']).toBe('Bearer test-key')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'qwen-2.5-72b', owned_by: 'siliconflow' },
          { id: 'deepseek-chat', owned_by: 'deepseek' }
        ]
      }))
    }

    const result = await gateway.listModels({
      draft: {
        baseUrl: serverUrl,
        apiKey: 'test-key',
        isLocalService: true
      }
    })

    expect(result.models).toEqual([
      { id: 'deepseek-chat', ownedBy: 'deepseek' },
      { id: 'qwen-2.5-72b', ownedBy: 'siliconflow' }
    ])
  })

  it('fetches remote models using saved connectionId and decrypts apiKey', async () => {
    const conn = store.create({
      name: 'Saved Conn',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'test-model',
      apiKey: 'saved-secret-key',
      isLocalService: true
    })

    let authHeader = ''
    requestHandler = (req, res) => {
      authHeader = req.headers['authorization'] || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [{ id: 'model-a' }, { id: 'model-b' }]
      }))
    }

    const result = await gateway.listModels({
      connectionId: conn.id
    })

    expect(authHeader).toBe('Bearer saved-secret-key')
    expect(result.models.map((m) => m.id)).toEqual(['model-a', 'model-b'])
  })

  it('handles Ollama format models response', async () => {
    requestHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        models: [
          { name: 'llama3:latest', model: 'llama3:latest' },
          { name: 'qwen2.5:7b', model: 'qwen2.5:7b' }
        ]
      }))
    }

    const result = await gateway.listModels({
      draft: {
        baseUrl: serverUrl,
        isLocalService: true
      }
    })

    expect(result.models.map((m) => m.id)).toEqual(['llama3:latest', 'qwen2.5:7b'])
  })

  it('throws AUTH_FAILED on 401 unauthorized status', async () => {
    requestHandler = (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }))
    }

    await expect(gateway.listModels({
      draft: {
        baseUrl: serverUrl,
        apiKey: 'wrong-key',
        isLocalService: true
      }
    })).rejects.toThrowError(/认证失败/)
  })
  it.each([
    ['stream', undefined], ['stream', 731], ['json', undefined], ['json', 731]
  ] as const)('sends explicit max_tokens and provider temperature defaults for %s with limit %s', async (kind, maxTokens) => {
    const conn = store.create({ name: 'Compatible Gemini', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', maxOutputTokens: 2400, isLocalService: true })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    const payloads: Record<string, any>[] = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        payloads.push(JSON.parse(body))
        if (kind === 'stream') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.end('data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n')
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))
        }
      })
    }
    const messages = [{ role: 'user' as const, content: '小说任务' }]
    if (kind === 'stream') {
      for await (const _chunk of gateway.chatCompletionStream({ connectionId: conn.id, messages, maxTokens })) { /* consume */ }
    } else {
      const schema = z.object({ ok: z.boolean() })
      await gateway.generateStructuredJson({ connectionId: conn.id, messages, maxTokens, jsonSchema: z.toJSONSchema(schema), zodSchema: schema })
    }
    expect(payloads).toHaveLength(1)
    expect(payloads[0].max_tokens).toBe(maxTokens ?? 2400)
    expect(payloads[0]).not.toHaveProperty('temperature')
    expect(payloads[0]).not.toHaveProperty('thinking_config')
    expect(payloads[0]).not.toHaveProperty('reasoning_effort')
  })

  it('provides the actual schema in the first fallback request when JSON-schema capability is disabled', async () => {
    const conn = store.create({ name: 'Fallback Gemini', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', isLocalService: true, capabilities: { streaming: true, jsonSchema: false, temperature: true, usage: true } })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    const schema = z.object({ summary: z.string(), state: z.object({ mainline: z.string(), unresolved: z.string() }) })
    const payloads: Record<string, any>[] = []
    requestHandler = (req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        payloads.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"无新增","state":{"mainline":"原主线","unresolved":"旧疑点"}}' } }] }))
      })
    }
    const result = await gateway.generateStructuredJson({ connectionId: conn.id, messages: [{ role: 'user', content: '维持原状态' }], maxTokens: 500, jsonSchema: z.toJSONSchema(schema), zodSchema: schema })
    expect(result.data.state.unresolved).toBe('旧疑点')
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).not.toHaveProperty('response_format')
    const instruction = payloads[0].messages.at(-1)
    expect(instruction.role).toBe('system')
    expect(JSON.parse(instruction.content.slice(instruction.content.indexOf('\n') + 1))).toEqual(z.toJSONSchema(schema))
    expect(payloads[0].max_tokens).toBe(500)
    expect(payloads[0]).not.toHaveProperty('temperature')
  })

  it.each([true, false])('rejects an oversized actual schema before HTTP with JSON schema capability %s', async (jsonSchema) => {
    const conn = store.create({ name: 'Budget Gemini', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', isLocalService: true, capabilities: { streaming: true, jsonSchema, temperature: true, usage: true } })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    const schema = z.object({ ok: z.boolean().describe('字段描述'.repeat(500)) })
    let calls = 0
    requestHandler = (_req, res) => { calls++; res.end() }
    const requestBudget = { connectionId: conn.id, connectionVersion: store.get(conn.id).version, contextWindow: 1000, maxOutputTokens: 100, safetyMarginRatio: 0.1, tokenEstimationRatio: 1 }
    await expect(gateway.generateStructuredJson({ connectionId: conn.id, messages: [{ role: 'user', content: '短输入' }], maxTokens: 100, requestBudget, jsonSchema: z.toJSONSchema(schema), zodSchema: schema })).rejects.toMatchObject({ code: 'MODEL_CONTEXT_EXCEEDED' })
    expect(calls).toBe(0)
  })

  it('applies the same frozen budget to the repair request including the invalid response', async () => {
    const conn = store.create({ name: 'Repair Budget Gemini', kind: 'generation', baseUrl: serverUrl, model: 'gemini-compatible', isLocalService: true })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))
    const schema = z.object({ ok: z.boolean() })
    let calls = 0
    requestHandler = (_req, res) => {
      calls++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '无效响应'.repeat(400) } }] }))
    }
    const requestBudget = { connectionId: conn.id, connectionVersion: store.get(conn.id).version, contextWindow: 1000, maxOutputTokens: 100, safetyMarginRatio: 0.1, tokenEstimationRatio: 1 }
    await expect(gateway.generateStructuredJson({ connectionId: conn.id, messages: [{ role: 'user', content: '短输入' }], maxTokens: 100, requestBudget, jsonSchema: z.toJSONSchema(schema), zodSchema: schema })).rejects.toMatchObject({ code: 'MODEL_CONTEXT_EXCEEDED' })
    expect(calls).toBe(1)
  })

  describe('reasoningEffort control', () => {
    it('includes reasoning_effort in non-streaming payload when configured on connection', async () => {
      const conn = store.create({
        name: 'Reasoning Model',
        kind: 'generation',
        baseUrl: serverUrl,
        model: 'o3-mini',
        isLocalService: true,
        reasoningEffort: 'medium'
      })
      store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

      let capturedPayload: Record<string, unknown> | null = null
      requestHandler = (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          capturedPayload = JSON.parse(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { content: '{"ok": true}' } }]
          }))
        })
      }

      const schema = z.object({ ok: z.boolean() })
      await gateway.generateStructuredJson({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Hello' }],
        jsonSchema: z.toJSONSchema(schema),
        zodSchema: schema
      })

      expect(capturedPayload).not.toBeNull()
      expect((capturedPayload as Record<string, unknown> | null)?.reasoning_effort).toBe('medium')
    })

    it('includes reasoning_effort in streaming payload when configured on connection', async () => {
      const conn = store.create({
        name: 'Streaming Reasoning Model',
        kind: 'generation',
        baseUrl: serverUrl,
        model: 'o1',
        isLocalService: true,
        reasoningEffort: 'high'
      })
      store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

      let capturedPayload: Record<string, unknown> | null = null
      requestHandler = (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          capturedPayload = JSON.parse(body)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
          res.write('data: [DONE]\n\n')
          res.end()
        })
      }

      const stream = gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Hello stream' }]
      })

      let text = ''
      for await (const chunk of stream) {
        text += chunk.text
      }

      expect(text).toBe('Hi')
      expect(capturedPayload).not.toBeNull()
      expect((capturedPayload as Record<string, unknown> | null)?.reasoning_effort).toBe('high')
    })

    it('allows request options to override connection reasoningEffort', async () => {
      const conn = store.create({
        name: 'Override Reasoning Model',
        kind: 'generation',
        baseUrl: serverUrl,
        model: 'o3-mini',
        isLocalService: true,
        reasoningEffort: 'high'
      })
      store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

      let capturedPayload: Record<string, unknown> | null = null
      requestHandler = (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          capturedPayload = JSON.parse(body)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          res.write('data: {"choices":[{"delta":{"content":"Overridden"}}]}\n\n')
          res.write('data: [DONE]\n\n')
          res.end()
        })
      }

      const stream = gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Hello' }],
        reasoningEffort: 'low'
      })

      for await (const _ of stream) {}

      expect(capturedPayload).not.toBeNull()
      expect((capturedPayload as Record<string, unknown> | null)?.reasoning_effort).toBe('low')
    })

    it('omits reasoning_effort when not specified on connection or options', async () => {
      const conn = store.create({
        name: 'Standard Model',
        kind: 'generation',
        baseUrl: serverUrl,
        model: 'gpt-4o',
        isLocalService: true
      })
      store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

      let capturedPayload: Record<string, unknown> | null = null
      requestHandler = (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          capturedPayload = JSON.parse(body)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          res.write('data: {"choices":[{"delta":{"content":"Normal"}}]}\n\n')
          res.write('data: [DONE]\n\n')
          res.end()
        })
      }

      const stream = gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: 'Hello standard' }]
      })

      for await (const _ of stream) {}

      expect(capturedPayload).not.toBeNull()
      expect(capturedPayload).not.toHaveProperty('reasoning_effort')
    })
  })

})
