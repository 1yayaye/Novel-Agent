import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  NovelAgentError,
  isNovelAgentError,
  ElectronPreloadTransport,
  WebView2Transport,
  generateCorrelationId,
  type ChromeWebViewLike,
  type ElectronIpcRendererLike,
  type IpcTransport
} from '../src/shared/platform-bridge/transport'
import {
  createNovelAgentApi,
  ensurePlatformBridge,
  HeadlessFallbackTransport,
  invokeApi,
  subscribeEvent
} from '../src/shared/platform-bridge/api-factory'

// Mock in-memory transport for API factory testing
class MockTransport implements IpcTransport {
  public invokeFn = vi.fn<(channel: string, payload?: unknown) => Promise<unknown>>()
  public listeners = new Map<string, Set<(payload: unknown) => void>>()

  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    return this.invokeFn(channel, payload)
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set?.size === 0) {
        this.listeners.delete(channel)
      }
    }
  }

  emit(channel: string, payload: unknown): void {
    const set = this.listeners.get(channel)
    if (set) {
      for (const listener of Array.from(set)) {
        listener(payload)
      }
    }
  }
}

describe('PlatformBridge - NovelAgentError & Type Guards', () => {
  it('creates NovelAgentError with correct fields and inherits from Error', () => {
    const error = new NovelAgentError('VALIDATION_ERROR', 'Field title is required')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(NovelAgentError)
    expect(error.name).toBe('NovelAgentError')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('Field title is required')
    expect(error.toJSON()).toEqual({
      name: 'NovelAgentError',
      code: 'VALIDATION_ERROR',
      message: 'Field title is required'
    })
  })

  it('isNovelAgentError correctly identifies NovelAgentError instances and ducks', () => {
    const genuine = new NovelAgentError('DATABASE_ERROR', 'Disk full')
    const duckTyped = { name: 'NovelAgentError', code: 'PROJECT_LOCKED', message: 'Locked' }
    const plainError = new Error('Generic error')
    const badObject = { name: 'OtherError', code: 123 }

    expect(isNovelAgentError(genuine)).toBe(true)
    expect(isNovelAgentError(duckTyped)).toBe(true)
    expect(isNovelAgentError(plainError)).toBe(false)
    expect(isNovelAgentError(badObject)).toBe(false)
    expect(isNovelAgentError(null)).toBe(false)
    expect(isNovelAgentError('error string')).toBe(false)
  })
})

describe('PlatformBridge - ElectronPreloadTransport', () => {
  it('unwraps successful { ok: true, value } responses from ipcRenderer', async () => {
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn().mockResolvedValue({ ok: true, value: { success: true } }),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const transport = new ElectronPreloadTransport(mockIpc)

    const result = await transport.invoke('project.close', { sessionId: '00000000-0000-0000-0000-000000000000' })
    expect(result).toEqual({ success: true })
    expect(mockIpc.invoke).toHaveBeenCalledWith('project.close', {
      sessionId: '00000000-0000-0000-0000-000000000000'
    })
  })

  it('unwraps raw responses when not wrapped in ok object', async () => {
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn().mockResolvedValue('raw-value'),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const transport = new ElectronPreloadTransport(mockIpc)

    const result = await transport.invoke('custom.channel')
    expect(result).toBe('raw-value')
  })

  it('maps { ok: false, error } responses to NovelAgentError', async () => {
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'VERSION_CONFLICT', message: 'Version conflict detected' }
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const transport = new ElectronPreloadTransport(mockIpc)

    await expect(transport.invoke('chapter.update')).rejects.toSatisfy((err: unknown) => {
      return (
        isNovelAgentError(err) &&
        err.code === 'VERSION_CONFLICT' &&
        err.message === 'Version conflict detected'
      )
    })
  })

  it('maps unexpected thrown errors to NovelAgentError with DATABASE_ERROR', async () => {
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn().mockRejectedValue(new Error('IPC bus crash')),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const transport = new ElectronPreloadTransport(mockIpc)

    await expect(transport.invoke('project.open')).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'DATABASE_ERROR' && err.message === 'IPC bus crash'
    })
  })

  it('registers and unregisters push event listeners correctly and idempotently', () => {
    let capturedListener: ((event: unknown, data: unknown) => void) | null = null
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn(),
      on: vi.fn((_channel, listener) => {
        capturedListener = listener
      }),
      removeListener: vi.fn()
    }
    const transport = new ElectronPreloadTransport(mockIpc)

    const callback = vi.fn()
    const unsubscribe = transport.on('candidate:delta', callback)

    expect(mockIpc.on).toHaveBeenCalledWith('candidate:delta', expect.any(Function))
    expect(capturedListener).not.toBeNull()

    // Trigger event
    capturedListener!({}, { text: 'hello' })
    expect(callback).toHaveBeenCalledWith({ text: 'hello' })

    // Unsubscribe
    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledTimes(1)

    // Second unsubscribe call is idempotent
    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledTimes(1)
  })
})

describe('PlatformBridge - WebView2Transport', () => {
  let mockWebview: ChromeWebViewLike
  let listeners: ((event: { data: unknown }) => void)[]

  beforeEach(() => {
    listeners = []
    mockWebview = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((type, listener) => {
        if (type === 'message') listeners.push(listener)
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'message') {
          listeners = listeners.filter((l) => l !== listener)
        }
      })
    }
  })

  it('generates valid RFC4122 v4 correlation IDs', () => {
    const id = generateCorrelationId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('sends correct rpc_request wire format via postMessage', async () => {
    const transport = new WebView2Transport(mockWebview)

    const invokePromise = transport.invoke('chapter.get', { chapterId: 'c1' })

    expect(mockWebview.postMessage).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(mockWebview.postMessage).mock.calls[0][0] as {
      type: string
      id: string
      channel: string
      payload: unknown
    }

    expect(sent.type).toBe('rpc_request')
    expect(typeof sent.id).toBe('string')
    expect(sent.channel).toBe('chapter.get')
    expect(sent.payload).toEqual({ chapterId: 'c1' })

    // Send success response
    listeners[0]({
      data: {
        type: 'rpc_response',
        id: sent.id,
        ok: true,
        value: { id: 'c1', title: 'Chapter 1' }
      }
    })

    const result = await invokePromise
    expect(result).toEqual({ id: 'c1', title: 'Chapter 1' })
  })

  it('handles JSON string wire format gracefully', async () => {
    const transport = new WebView2Transport(mockWebview)
    const invokePromise = transport.invoke('project.listRecent')

    const sent = vi.mocked(mockWebview.postMessage).mock.calls[0][0] as { id: string }

    // Host sends JSON string instead of object
    listeners[0]({
      data: JSON.stringify({
        type: 'rpc_response',
        id: sent.id,
        ok: true,
        value: []
      })
    })

    const result = await invokePromise
    expect(result).toEqual([])
  })

  it('correlates interleaved requests and handles out-of-order responses', async () => {
    const transport = new WebView2Transport(mockWebview)

    // Initiate 3 concurrent requests
    const p1 = transport.invoke('req.one', { n: 1 })
    const p2 = transport.invoke('req.two', { n: 2 })
    const p3 = transport.invoke('req.three', { n: 3 })

    const req1 = vi.mocked(mockWebview.postMessage).mock.calls[0][0] as { id: string }
    const req2 = vi.mocked(mockWebview.postMessage).mock.calls[1][0] as { id: string }
    const req3 = vi.mocked(mockWebview.postMessage).mock.calls[2][0] as { id: string }

    // Deliver responses out of order: req3 -> req1 -> req2
    listeners[0]({
      data: { type: 'rpc_response', id: req3.id, ok: true, value: 'res-3' }
    })
    listeners[0]({
      data: { type: 'rpc_response', id: req1.id, ok: true, value: 'res-1' }
    })
    listeners[0]({
      data: { type: 'rpc_response', id: req2.id, ok: true, value: 'res-2' }
    })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toBe('res-1')
    expect(r2).toBe('res-2')
    expect(r3).toBe('res-3')
  })

  it('cleans up timeout and rejects with NovelAgentError on timeout', async () => {
    // 50ms short timeout
    const transport = new WebView2Transport(mockWebview, { defaultTimeoutMs: 50 })

    const invokePromise = transport.invoke('slow.operation')
    const sent = vi.mocked(mockWebview.postMessage).mock.calls[0][0] as { id: string }

    await expect(invokePromise).rejects.toSatisfy((err: unknown) => {
      return (
        isNovelAgentError(err) &&
        err.code === 'DATABASE_ERROR' &&
        err.message.includes('IPC call timeout after 50ms')
      )
    })

    // Belated response after timeout does not throw or crash
    expect(() => {
      listeners[0]({
        data: { type: 'rpc_response', id: sent.id, ok: true, value: 'late' }
      })
    }).not.toThrow()
  })

  it('rejects with NovelAgentError when postMessage fails', async () => {
    mockWebview.postMessage = vi.fn().mockImplementation(() => {
      throw new Error('WebView disconnected')
    })
    const transport = new WebView2Transport(mockWebview)

    await expect(transport.invoke('test.fail')).rejects.toSatisfy((err: unknown) => {
      return (
        isNovelAgentError(err) &&
        err.code === 'DATABASE_ERROR' &&
        err.message.includes('WebView disconnected')
      )
    })
  })

  it('dispatches push events to listeners and supports isolated unsubscription (Rule 20 compliant)', async () => {
    const transport = new WebView2Transport(mockWebview)

    const eventsA: unknown[] = []
    const eventsB: unknown[] = []

    let resolveAllA: () => void
    const donePromiseA = new Promise<void>((resolve) => {
      resolveAllA = resolve
    })

    const unsubA = transport.on('candidate:delta', (payload) => {
      eventsA.push(payload)
      if (eventsA.length === 2) {
        resolveAllA()
      }
    })

    const unsubB = transport.on('candidate:delta', (payload) => {
      eventsB.push(payload)
    })

    // Dispatch event 1
    listeners[0]({
      data: { type: 'event', channel: 'candidate:delta', payload: { delta: 'word1' } }
    })

    // Unsubscribe listener B
    unsubB()

    // Dispatch event 2
    listeners[0]({
      data: { type: 'event', channel: 'candidate:delta', payload: { delta: 'word2' } }
    })

    // Wait for listener A to receive 2 events deterministically (no sleep)
    await donePromiseA

    expect(eventsA).toEqual([{ delta: 'word1' }, { delta: 'word2' }])
    expect(eventsB).toEqual([{ delta: 'word1' }])

    // Unsubscribe listener A
    unsubA()

    // Dispatch event 3
    listeners[0]({
      data: { type: 'event', channel: 'candidate:delta', payload: { delta: 'word3' } }
    })

    expect(eventsA).toHaveLength(2)
  })

  it('isolates listener errors so one listener exception does not block other listeners', () => {
    const transport = new WebView2Transport(mockWebview)

    const errorListener = vi.fn().mockImplementation(() => {
      throw new Error('Listener error')
    })
    const goodListener = vi.fn()

    transport.on('task:progress', errorListener)
    transport.on('task:progress', goodListener)

    listeners[0]({
      data: { type: 'event', channel: 'task:progress', payload: { percent: 50 } }
    })

    expect(errorListener).toHaveBeenCalledWith({ percent: 50 })
    expect(goodListener).toHaveBeenCalledWith({ percent: 50 })
  })

  it('dispose() cleans up pending requests, timers, and prevents further calls', async () => {
    const transport = new WebView2Transport(mockWebview)

    const pendingPromise = transport.invoke('pending.request')
    transport.dispose()

    await expect(pendingPromise).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'TASK_CANCELLED'
    })

    // Further invokes immediately reject
    await expect(transport.invoke('after.dispose')).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'TASK_CANCELLED'
    })

    expect(mockWebview.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))
  })
})

describe('PlatformBridge - API Factory & Major Namespaces', () => {
  let mockTransport: MockTransport

  beforeEach(() => {
    mockTransport = new MockTransport()
  })

  it('project namespace: create, open, close, listRecent', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce({
      projectId: '416b2520-2ce3-4f93-8f0a-115f5734df27',
      path: 'E:/novels/test.novelproj',
      title: '测试修真传',
      description: '修真传简介',
      version: 1,
      schemaVersion: 5,
      updatedAt: Date.now(),
      searchIndexState: 'current'
    })

    const project = await api.project.create({
      destination: 'E:/novels/test.novelproj',
      title: '测试修真传',
      description: '修真传简介'
    })

    expect(project.title).toBe('测试修真传')
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('project.create', expect.objectContaining({
      title: '测试修真传'
    }))
  })

  it('chapter namespace: get, update, list', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce({
      id: 'c16b2520-2ce3-4f93-8f0a-115f5734df27',
      title: '第一章 启程',
      position: 0,
      content: '风起云涌，长剑出鞘。',
      version: 1,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    })

    const chapter = await api.chapter.get({
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27',
      chapterId: 'c16b2520-2ce3-4f93-8f0a-115f5734df27'
    })

    expect(chapter.id).toBe('c16b2520-2ce3-4f93-8f0a-115f5734df27')
    expect(chapter.content).toBe('风起云涌，长剑出鞘。')
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('chapter.get', {
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27',
      chapterId: 'c16b2520-2ce3-4f93-8f0a-115f5734df27'
    })
  })

  it('outline namespace: getBookOutline', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce({
      id: 'd16b2520-2ce3-4f93-8f0a-115f5734df27',
      content: '# 全书大纲',
      sourceVersions: {},
      version: 1,
      state: 'confirmed',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    })

    const outline = await api.outline.getBookOutline({
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27'
    })

    expect(outline?.content).toBe('# 全书大纲')
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('outline.getBook', {
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27'
    })
  })

  it('knowledge namespace: list', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce([
      {
        id: 'e16b2520-2ce3-4f93-8f0a-115f5734df27',
        knowledgeKind: 'world',
        title: '青云门',
        aliases: ['青云'],
        authorContent: '名门正派之一',
        tags: ['门派'],
        version: 1,
        state: 'active',
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ])

    const entries = await api.knowledge.list({
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27'
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('青云门')
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('knowledge.list', {
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27'
    })
  })

  it('candidate & ai streaming namespace: list & push event subscription', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce([
      {
        id: 'f16b2520-2ce3-4f93-8f0a-115f5734df27',
        taskId: 'a16b2520-2ce3-4f93-8f0a-115f5734df27',
        chapterId: 'c16b2520-2ce3-4f93-8f0a-115f5734df27',
        chapterVersion: 1,
        version: 1,
        state: 'ready',
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ])

    const candidates = await api.candidate.list({
      sessionId: '416b2520-2ce3-4f93-8f0a-115f5734df27',
      chapterId: 'c16b2520-2ce3-4f93-8f0a-115f5734df27'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe('f16b2520-2ce3-4f93-8f0a-115f5734df27')

    // Test candidate.onDelta push event
    let deltaResolve: () => void
    const deltaDone = new Promise<void>((resolve) => {
      deltaResolve = resolve
    })

    const unsubDelta = api.candidate.onDelta!((event) => {
      expect(event.delta).toBe('长剑出鞘')
      deltaResolve()
    })

    mockTransport.emit('candidate:delta', {
      candidateId: 'f16b2520-2ce3-4f93-8f0a-115f5734df27',
      taskId: 'a16b2520-2ce3-4f93-8f0a-115f5734df27',
      delta: '长剑出鞘',
      fullText: '长剑出鞘',
      state: 'streaming'
    })

    await deltaDone
    unsubDelta()
  })

  it('window namespace: minimize, maximize, close, isMaximized, onMaximizedChange', async () => {
    const api = createNovelAgentApi(mockTransport)

    mockTransport.invokeFn.mockResolvedValueOnce(true)
    const minResult = await api.window.minimize()
    expect(minResult).toBe(true)
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('window.minimize', undefined)

    mockTransport.invokeFn.mockResolvedValueOnce(false)
    const isMax = await api.window.isMaximized()
    expect(isMax).toBe(false)
    expect(mockTransport.invokeFn).toHaveBeenCalledWith('window.isMaximized', undefined)

    // Window maximized change push event
    let maxChangeResolve: () => void
    const maxChangeDone = new Promise<void>((resolve) => {
      maxChangeResolve = resolve
    })

    const unsub = api.window.onMaximizedChange!((isMaximized) => {
      expect(isMaximized).toBe(true)
      maxChangeResolve()
    })

    mockTransport.emit('window:maximized', true)
    await maxChangeDone
    unsub()
  })
})

describe('PlatformBridge - Zod Validation Failures Throwing NovelAgentError', () => {
  let mockTransport: MockTransport

  beforeEach(() => {
    mockTransport = new MockTransport()
  })

  it('throws NovelAgentError with VALIDATION_ERROR when input schema fails', async () => {
    const api = createNovelAgentApi(mockTransport)

    // destination does not end with .novelproj
    await expect(
      api.project.create({
        destination: 'E:/invalid-path.txt',
        title: '测试',
        description: ''
      })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        isNovelAgentError(err) &&
        err.code === 'VALIDATION_ERROR' &&
        err.name === 'NovelAgentError'
      )
    })

    // transport should not have been called due to early client-side validation failure
    expect(mockTransport.invokeFn).not.toHaveBeenCalled()
  })

  it('throws NovelAgentError with VALIDATION_ERROR when input is missing required fields', async () => {
    const api = createNovelAgentApi(mockTransport)

    // @ts-expect-error missing required sessionId
    await expect(api.chapter.get({ chapterId: 'c16b2520-2ce3-4f93-8f0a-115f5734df27' })).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'VALIDATION_ERROR'
    })
  })

  it('throws NovelAgentError with VALIDATION_ERROR when transport returns invalid output', async () => {
    const api = createNovelAgentApi(mockTransport)

    // Return invalid output (missing required fields for ProjectSummary)
    mockTransport.invokeFn.mockResolvedValueOnce({ invalid: 'shape' })

    await expect(
      api.project.create({
        destination: 'E:/valid.novelproj',
        title: '测试',
        description: ''
      })
    ).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'VALIDATION_ERROR'
    })
  })
})

describe('PlatformBridge - ensurePlatformBridge Bootstrap & Autodetection', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow
    } else {
      // @ts-expect-error cleanup window
      delete globalThis.window
    }
  })

  it('returns existing window.novelAgent if already initialized', () => {
    const existingApi = createNovelAgentApi(new MockTransport())
    // @ts-expect-error inject mock window
    globalThis.window = { novelAgent: existingApi }

    const bridge = ensurePlatformBridge()
    expect(bridge).toBe(existingApi)
  })

  it('overrides window.novelAgent if custom transport is explicitly supplied', () => {
    const mockT = new MockTransport()
    // @ts-expect-error inject mock window
    globalThis.window = { novelAgent: {} }

    const bridge = ensurePlatformBridge(mockT)
    expect(bridge).not.toBeUndefined()
    expect((window as unknown as { novelAgent: unknown }).novelAgent).toBe(bridge)
  })

  it('autodetects window.chrome.webview and creates WebView2Transport', () => {
    const mockWebview: ChromeWebViewLike = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    // @ts-expect-error inject chrome.webview
    globalThis.window = { chrome: { webview: mockWebview } }

    const bridge = ensurePlatformBridge()
    expect(bridge).not.toBeUndefined()
    expect((window as unknown as { novelAgent: unknown }).novelAgent).toBe(bridge)
  })

  it('autodetects window.electron.ipcRenderer and creates ElectronPreloadTransport', () => {
    const mockIpc: ElectronIpcRendererLike = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    // @ts-expect-error inject electron.ipcRenderer
    globalThis.window = { electron: { ipcRenderer: mockIpc } }

    const bridge = ensurePlatformBridge()
    expect(bridge).not.toBeUndefined()
    expect((window as unknown as { novelAgent: unknown }).novelAgent).toBe(bridge)
  })

  it('falls back to HeadlessFallbackTransport when no bridge runtime exists', async () => {
    // @ts-expect-error plain empty window
    globalThis.window = {}

    const bridge = ensurePlatformBridge()
    expect(bridge).not.toBeUndefined()

    await expect(bridge.project.listRecent()).rejects.toSatisfy((err: unknown) => {
      return isNovelAgentError(err) && err.code === 'PROJECT_NOT_OPEN'
    })
  })
})
