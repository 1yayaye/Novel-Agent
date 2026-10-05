import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceRouter, type ServiceRouterDependencies, type WindowDelegate } from '../src/main/service-router.js'
import { startSidecar } from '../src/main/sidecar.js'
import { ProjectStore } from '../src/main/project-store.js'

describe('ServiceRouter & Sidecar Implementation', () => {
  let tempDir: string
  let store: ProjectStore
  let deps: ServiceRouterDependencies

  beforeEach(() => {
    tempDir = join(tmpdir(), `sidecar-spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(tempDir, { recursive: true })
    mkdirSync(join(tempDir, 'projects'), { recursive: true })
    mkdirSync(join(tempDir, 'novels'), { recursive: true })
    store = new ProjectStore(tempDir)
    deps = { store }
  })

  afterEach(async () => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Windows handle release delay
    }
  })

  describe('ServiceRouter', () => {
    it('closes project store sessions when the router is disposed', async () => {
      const closeAll = vi.spyOn(store, 'closeAll').mockResolvedValue()
      const router = createServiceRouter(deps)

      await router.dispose()

      expect(closeAll).toHaveBeenCalledOnce()
      closeAll.mockRestore()
    })

    it('handles system.ping healthcheck', async () => {
      const router = createServiceRouter(deps)
      const res = await router.handle('system.ping', {})
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.value).toMatchObject({
          status: 'healthy',
          version: '0.1.0'
        })
      }
      expect(router.has('system.ping')).toBe(true)
    })

    it('returns METHOD_NOT_FOUND error on unknown channels', async () => {
      const router = createServiceRouter(deps)
      expect(router.has('nonexistent.action')).toBe(false)
      const res = await router.handle('nonexistent.action', {})
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect((res.error as { code: string }).code).toBe('METHOD_NOT_FOUND')
        expect((res.error as { message: string }).message).toContain('Method not found')
      }
    })

    it('creates project, opens it, and executes chapter operations', async () => {
      const router = createServiceRouter(deps)
      const projectPath = join(tempDir, 'projects', 'test-novel.novelproj')

      // project.create
      const createRes = await router.handle('project.create', {
        destination: projectPath,
        title: '测试修仙传',
        description: '一本测试小说'
      })
      expect(createRes.ok).toBe(true)
      if (createRes.ok) {
        expect((createRes.value as { title: string }).title).toBe('测试修仙传')
      }

      // project.open
      const openRes = await router.handle('project.open', { path: projectPath })
      expect(openRes.ok).toBe(true)
      let sessionId = ''
      if (openRes.ok) {
        const val = openRes.value as { sessionId: string; mode: string }
        expect(val.mode).toBe('read_write')
        sessionId = val.sessionId
      }

      // chapter.list (initially empty)
      const listRes1 = await router.handle('chapter.list', { sessionId })
      expect(listRes1.ok).toBe(true)
      if (listRes1.ok) {
        expect(listRes1.value).toEqual([])
      }

      // chapter.create
      const createChapRes = await router.handle('chapter.create', {
        sessionId,
        title: '第一章 宗门风云',
        content: '群峰叠翠，云雾缭绕。'
      })
      expect(createChapRes.ok).toBe(true)
      let chapterId = ''
      if (createChapRes.ok) {
        const chap = createChapRes.value as { id: string; title: string; content: string }
        expect(chap.title).toBe('第一章 宗门风云')
        chapterId = chap.id
      }

      // chapter.get
      const getChapRes = await router.handle('chapter.get', { sessionId, chapterId })
      expect(getChapRes.ok).toBe(true)
      if (getChapRes.ok) {
        const chap = getChapRes.value as { id: string; title: string; content: string }
        expect(chap.content).toBe('群峰叠翠，云雾缭绕。')
      }

      // chapter.list (now contains 1 chapter)
      const listRes2 = await router.handle('chapter.list', { sessionId })
      expect(listRes2.ok).toBe(true)
      if (listRes2.ok) {
        expect((listRes2.value as unknown[]).length).toBe(1)
      }

      // project.close
      const closeRes = await router.handle('project.close', { sessionId })
      expect(closeRes.ok).toBe(true)
    })

    it('rejects invalid input schema with VALIDATION_ERROR', async () => {
      const router = createServiceRouter(deps)
      // project.create requires destination, title, description
      const res = await router.handle('project.create', { invalid: 123 })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect((res.error as { code: string }).code).toBe('VALIDATION_ERROR')
      }
    })

    it('handles event emission and unsubscription', () => {
      const router = createServiceRouter(deps)
      const received: Array<{ channel: string; payload: unknown }> = []

      const unsubscribe = router.onEvent((event) => {
        received.push(event)
      })

      router.emitEvent('task:progress', { progress: 50, message: 'Processing' })
      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({
        channel: 'task:progress',
        payload: { progress: 50, message: 'Processing' }
      })

      unsubscribe()
      router.emitEvent('task:progress', { progress: 100, message: 'Done' })
      expect(received).toHaveLength(1)
    })

    it('delegates window operations to windowDelegate', async () => {
      const delegate: WindowDelegate = {
        minimize: vi.fn(),
        toggleMaximize: vi.fn().mockReturnValue(true),
        close: vi.fn(),
        isMaximized: vi.fn().mockReturnValue(false)
      }

      const router = createServiceRouter({ ...deps, windowDelegate: delegate })

      const minRes = await router.handle('window.minimize', undefined)
      expect(minRes.ok).toBe(true)
      expect(delegate.minimize).toHaveBeenCalled()

      const maxRes = await router.handle('window.toggleMaximize', undefined)
      expect(maxRes.ok).toBe(true)
      expect(delegate.toggleMaximize).toHaveBeenCalled()

      const isMaxRes = await router.handle('window.isMaximized', undefined)
      expect(isMaxRes.ok).toBe(true)
      if (isMaxRes.ok) expect(isMaxRes.value).toBe(false)

      const closeRes = await router.handle('window.close', undefined)
      expect(closeRes.ok).toBe(true)
      expect(delegate.close).toHaveBeenCalled()
    })
  })

  describe('Sidecar Stdio NDJSON JSON-RPC Protocol', () => {
    it('processes system.ping over NDJSON stream with matching id', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responsePromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.once('line', (line) => resolve(line))
      })

      const req = {
        jsonrpc: '2.0',
        id: 'req-001',
        method: 'system.ping',
        params: {}
      }
      input.write(JSON.stringify(req) + '\n')

      const raw = await responsePromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBe('req-001')
      expect(parsed.result).toMatchObject({
        status: 'healthy',
        version: '0.1.0'
      })

      await close()
    })

    it('returns JSON-RPC -32601 on unknown method', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responsePromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.once('line', (line) => resolve(line))
      })

      const req = {
        jsonrpc: '2.0',
        id: 'req-err-404',
        method: 'unknown.nonexistent',
        params: {}
      }
      input.write(JSON.stringify(req) + '\n')

      const raw = await responsePromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBe('req-err-404')
      expect(parsed.error.code).toBe(-32601)
      expect(parsed.error.message).toContain('Method not found')

      await close()
    })

    it('returns JSON-RPC -32700 on malformed NDJSON input', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responsePromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.once('line', (line) => resolve(line))
      })

      input.write('{ invalid json line without quotes\n')

      const raw = await responsePromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBeNull()
      expect(parsed.error.code).toBe(-32700)
      expect(parsed.error.message).toContain('Parse error')

      await close()
    })

    it('returns JSON-RPC -32600 when jsonrpc version is not 2.0', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responsePromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.once('line', (line) => resolve(line))
      })

      input.write(JSON.stringify({ jsonrpc: '1.0', id: 'old-1', method: 'system.ping' }) + '\n')

      const raw = await responsePromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBe('old-1')
      expect(parsed.error.code).toBe(-32600)
      expect(parsed.error.message).toContain('jsonrpc must be 2.0')

      await close()
    })

    it('forwards domain errors with code -32000 and domainCode in data', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responsePromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.once('line', (line) => resolve(line))
      })

      // Attempt to close non-existent project session
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'domain-err-1',
          method: 'project.close',
          params: { sessionId: '00000000-0000-0000-0000-000000000000' }
        }) + '\n'
      )

      const raw = await responsePromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.id).toBe('domain-err-1')
      expect(parsed.error.code).toBe(-32000)
      expect(parsed.error.data).toBeDefined()
      expect(parsed.error.data.domainCode).toBe('PROJECT_NOT_OPEN')

      await close()
    })

    it('forwards push event notifications to stdout', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { router, close } = startSidecar({ input, output, deps })

      const eventPromise = new Promise<string>((resolve) => {
        const rl = createInterface({ input: output, crlfDelay: Infinity })
        rl.on('line', (line) => resolve(line))
      })

      router.emitEvent('chat:delta', { chunk: '你好，世界', done: false })

      const raw = await eventPromise
      const parsed = JSON.parse(raw)

      expect(parsed.jsonrpc).toBe('2.0')
      expect(parsed.method).toBe('event')
      expect(parsed.params).toEqual({
        channel: 'chat:delta',
        payload: { chunk: '你好，世界', done: false }
      })

      await close()
    })

    it('executes end-to-end interleaved requests with deterministic correlation', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const { close } = startSidecar({ input, output, deps })

      const responses = new Map<string, any>()
      let resolveAll: () => void
      const allDone = new Promise<void>((resolve) => {
        resolveAll = resolve
      })

      const rl = createInterface({ input: output, crlfDelay: Infinity })
      rl.on('line', (line) => {
        const parsed = JSON.parse(line)
        if (parsed.id) {
          responses.set(parsed.id, parsed)
          if (responses.size === 3) resolveAll()
        }
      })

      // Send 3 requests in burst
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 'burst-1', method: 'system.ping', params: {} }) + '\n')
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 'burst-2', method: 'unknown.cmd', params: {} }) + '\n')
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 'burst-3', method: 'system.ping', params: {} }) + '\n')

      await allDone

      expect(responses.get('burst-1')?.result?.status).toBe('healthy')
      expect(responses.get('burst-2')?.error?.code).toBe(-32601)
      expect(responses.get('burst-3')?.result?.status).toBe('healthy')

      await close()
    })
  })
})
