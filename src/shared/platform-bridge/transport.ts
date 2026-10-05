/**
 * src/shared/platform-bridge/transport.ts
 *
 * Core IPC transport interfaces and platform adapters for Novel Agent.
 * Enables transparent communication across Electron preload and WinUI 3 WebView2.
 */

import type { ProjectErrorCode } from '../contracts/system.js'

// ============================================================================
// 1. Error Representation
// ============================================================================

export interface NovelAgentErrorPayload {
  name: 'NovelAgentError'
  code: ProjectErrorCode | string
  message: string
}

/**
 * Standard error class thrown by all Novel Agent IPC operations.
 * Preserves the exact shape { name: 'NovelAgentError', code, message } expected by React UI.
 */
export class NovelAgentError extends Error implements NovelAgentErrorPayload {
  override readonly name = 'NovelAgentError' as const
  readonly code: ProjectErrorCode | string

  constructor(code: ProjectErrorCode | string, message: string) {
    super(message)
    this.name = 'NovelAgentError'
    this.code = code
    Object.setPrototypeOf(this, NovelAgentError.prototype)
  }

  toJSON(): NovelAgentErrorPayload {
    return {
      name: this.name,
      code: this.code,
      message: this.message
    }
  }
}

/**
 * Duck-typing guard to identify NovelAgentError across execution boundaries.
 */
export function isNovelAgentError(error: unknown): error is NovelAgentErrorPayload {
  return (
    error instanceof NovelAgentError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'NovelAgentError' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string')
  )
}

// ============================================================================
// 2. Core Transport Interface
// ============================================================================

/**
 * Generic IPC transport contract implemented by platform adapters.
 */
export interface IpcTransport {
  /**
   * Send a bidirectional RPC request to the host environment.
   * Resolves to the unwrapped value on success.
   * Rejects with NovelAgentError on failure or timeout.
   */
  invoke(channel: string, payload?: unknown): Promise<unknown>

  /**
   * Subscribe to server-initiated push events.
   * Returns a synchronous unsubscription callback.
   */
  on(channel: string, listener: (payload: unknown) => void): () => void
}

// ============================================================================
// 3. Electron Preload Adapter
// ============================================================================

export interface ElectronIpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

/**
 * Transport adapter wrapping Electron's ipcRenderer.
 */
export class ElectronPreloadTransport implements IpcTransport {
  private readonly ipc: ElectronIpcRendererLike

  constructor(ipcRenderer?: ElectronIpcRendererLike) {
    if (ipcRenderer) {
      this.ipc = ipcRenderer
    } else if (
      typeof window !== 'undefined' &&
      (window as unknown as { electron?: { ipcRenderer?: ElectronIpcRendererLike } }).electron?.ipcRenderer
    ) {
      this.ipc = (window as unknown as { electron: { ipcRenderer: ElectronIpcRendererLike } }).electron.ipcRenderer
    } else if (
      typeof window !== 'undefined' &&
      (window as unknown as { ipcRenderer?: ElectronIpcRendererLike }).ipcRenderer
    ) {
      this.ipc = (window as unknown as { ipcRenderer: ElectronIpcRendererLike }).ipcRenderer
    } else if (typeof require !== 'undefined') {
      try {
        // Fallback for direct node/electron preload environment where electron module is available
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electronModule = require('electron') as { ipcRenderer?: ElectronIpcRendererLike }
        if (!electronModule?.ipcRenderer) {
          throw new Error('electron.ipcRenderer is undefined')
        }
        this.ipc = electronModule.ipcRenderer
      } catch (err) {
        throw new Error(`ElectronPreloadTransport: ipcRenderer unavailable (${(err as Error).message})`)
      }
    } else {
      throw new Error('ElectronPreloadTransport: ipcRenderer unavailable in current environment')
    }
  }

  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    try {
      const result = await this.ipc.invoke(channel, payload)
      // Check for wrapped IpcResult { ok: true, value } | { ok: false, error }
      if (result && typeof result === 'object' && 'ok' in result) {
        const res = result as { ok: boolean; value?: unknown; error?: { code?: string; message?: string } }
        if (res.ok) {
          return res.value
        }
        const code = res.error?.code ?? 'DATABASE_ERROR'
        const message = res.error?.message ?? 'IPC invocation failed'
        throw new NovelAgentError(code, message)
      }
      return result
    } catch (error) {
      if (isNovelAgentError(error)) {
        throw error
      }
      throw new NovelAgentError(
        'DATABASE_ERROR',
        (error as Error)?.message ?? 'IPC invocation failed'
      )
    }
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    const ipcListener = (_event: unknown, data: unknown) => {
      try {
        listener(data)
      } catch (err) {
        console.error(`[ElectronPreloadTransport] Uncaught error in listener for "${channel}":`, err)
      }
    }

    this.ipc.on(channel, ipcListener)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.ipc.removeListener(channel, ipcListener)
    }
  }
}

// ============================================================================
// 4. WebView2 Wire Protocol & Types
// ============================================================================

export interface WebView2RpcRequest {
  type: 'rpc_request'
  id: string
  channel: string
  payload?: unknown
}

export interface WebView2RpcSuccessResponse {
  type: 'rpc_response'
  id: string
  ok: true
  value: unknown
}

export interface WebView2RpcErrorResponse {
  type: 'rpc_response'
  id: string
  ok: false
  error: {
    code: string
    message: string
  }
}

export type WebView2RpcResponse = WebView2RpcSuccessResponse | WebView2RpcErrorResponse

export interface WebView2PushEvent {
  type: 'event'
  channel: string
  payload: unknown
}

export type WebView2WireMessage =
  | WebView2RpcRequest
  | WebView2RpcResponse
  | WebView2PushEvent

export interface ChromeWebViewLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export interface WebView2TransportOptions {
  /**
   * Request timeout in milliseconds. Default: 60,000ms (60s).
   */
  defaultTimeoutMs?: number
}

interface PendingRpcRequest {
  channel: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

// ============================================================================
// 5. WebView2 Transport Adapter
// ============================================================================

/**
 * Generates an RFC4122 v4 UUID for message correlation.
 * Uses crypto.randomUUID when available with an idempotent math fallback.
 */
export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Transport adapter connecting React frontend to WinUI 3 via WebView2 postMessage / onmessage.
 */
export class WebView2Transport implements IpcTransport {
  private readonly webview: ChromeWebViewLike
  private readonly defaultTimeoutMs: number
  private readonly pendingRequests = new Map<string, PendingRpcRequest>()
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly messageHandler: (event: { data: unknown }) => void
  private isDisposed = false

  constructor(webview?: ChromeWebViewLike, options?: WebView2TransportOptions) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 60_000

    if (webview) {
      this.webview = webview
    } else if (
      typeof window !== 'undefined' &&
      (window as unknown as { chrome?: { webview?: ChromeWebViewLike } }).chrome?.webview
    ) {
      this.webview = (window as unknown as { chrome: { webview: ChromeWebViewLike } }).chrome.webview
    } else {
      throw new Error('WebView2Transport: window.chrome.webview is not available in the current environment')
    }

    this.messageHandler = (event) => {
      const data = event && typeof event === 'object' && 'data' in event ? event.data : event
      this.handleIncomingMessage(data)
    }
    this.webview.addEventListener('message', this.messageHandler)
  }

  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (this.isDisposed) {
      throw new NovelAgentError('TASK_CANCELLED', 'Transport has been disposed')
    }

    const id = generateCorrelationId()
    const request: WebView2RpcRequest = {
      type: 'rpc_request',
      id,
      channel,
      payload
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(
            new NovelAgentError(
              'DATABASE_ERROR',
              `IPC call timeout after ${this.defaultTimeoutMs}ms: ${channel}`
            )
          )
        }
      }, this.defaultTimeoutMs)

      this.pendingRequests.set(id, {
        channel,
        resolve,
        reject,
        timeoutId
      })

      try {
        this.webview.postMessage(request)
      } catch (err) {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(id)
        reject(
          new NovelAgentError(
            'DATABASE_ERROR',
            `Failed to postMessage for channel "${channel}": ${(err as Error)?.message ?? String(err)}`
          )
        )
      }
    })
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    let listeners = this.eventListeners.get(channel)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(channel, listeners)
    }
    listeners.add(listener)

    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      const current = this.eventListeners.get(channel)
      if (current) {
        current.delete(listener)
        if (current.size === 0) {
          this.eventListeners.delete(channel)
        }
      }
    }
  }

  /**
   * Internal message dispatcher handling both RPC responses and Push events.
   */
  private handleIncomingMessage(rawData: unknown): void {
    let data = rawData

    // Defensive parsing in case host sent a JSON string
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return // Not a valid JSON payload, safely ignore
      }
    }

    if (!data || typeof data !== 'object') {
      return
    }

    const msg = data as Partial<WebView2WireMessage>

    // Branch 1: RPC Response
    if (msg.type === 'rpc_response' && typeof msg.id === 'string') {
      const pending = this.pendingRequests.get(msg.id)
      if (!pending) {
        // Unknown or already timed-out request, safely ignore
        return
      }

      this.pendingRequests.delete(msg.id)
      clearTimeout(pending.timeoutId)

      const response = msg as WebView2RpcResponse
      if (response.ok) {
        pending.resolve(response.value)
      } else {
        const errCode = response.error?.code ?? 'DATABASE_ERROR'
        const errMsg = response.error?.message ?? 'RPC execution failed'
        pending.reject(new NovelAgentError(errCode, errMsg))
      }
      return
    }

    // Branch 2: Push Event
    if (msg.type === 'event' && typeof msg.channel === 'string') {
      const listeners = this.eventListeners.get(msg.channel)
      if (listeners && listeners.size > 0) {
        // Snapshot to array to permit listener unsubscription during iteration
        for (const listener of Array.from(listeners)) {
          try {
            listener(msg.payload)
          } catch (err) {
            console.error(`[WebView2Transport] Uncaught error in event listener for "${msg.channel}":`, err)
          }
        }
      }
      return
    }
  }

  /**
   * Cleans up all pending requests, timers, and event listeners.
   */
  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true

    this.webview.removeEventListener('message', this.messageHandler)

    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId)
      pending.reject(new NovelAgentError('TASK_CANCELLED', `Transport disposed for ${pending.channel}`))
      this.pendingRequests.delete(id)
    }

    this.eventListeners.clear()
  }
}
