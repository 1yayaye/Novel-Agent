import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ProjectStore, ProjectError } from '../../../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../../../src/main/connection-store'
import { ModelGateway } from '../../../src/main/model-gateway'
import { DiagnosticsService } from '../../../src/main/diagnostics'
import { SearchIndex } from '../../../src/main/search-index'
import { ChapterRepository } from '../../../src/main/chapter-repository'
import { KnowledgeRepository } from '../../../src/main/knowledge-repository'
import { CreativeRepository } from '../../../src/main/creative-repository'
import { ContextAssembler } from '../../../src/main/context-assembler'
import { CandidateService } from '../../../src/main/candidate-service'
import { CreationRunner } from '../../../src/main/creation-runner'
import { ChatService } from '../../../src/main/chat-service'
import { AnalysisRunner } from '../../../src/main/analysis-runner'
import { count } from '../../../src/shared/text-counter'

/**
 * Dual-track test environment bundle containing isolated database,
 * repositories, mock LLM server, and simulated bridge transports.
 */
export interface DualTrackTestEnv {
  tempDir: string
  dataDir: string
  novelsDir: string
  connectionStore: ConnectionStore
  diagnostics: DiagnosticsService
  gateway: ModelGateway
  store: ProjectStore
  searchIndex: SearchIndex
  chapters: ChapterRepository
  knowledge: KnowledgeRepository
  creative: CreativeRepository
  contextAssembler: ContextAssembler
  candidateService: CandidateService
  creationRunner: CreationRunner
  chatService: ChatService
  analysisRunner: AnalysisRunner
  llmServer: MockLlmServer
  cleanup: () => Promise<void>
}

/**
 * Mock LLM Server capable of responding with SSE streams, JSON completions,
 * or simulating error states (429, 503, connection drop).
 */
export class MockLlmServer {
  private server: Server | null = null
  public port = 0
  public url = ''
  private customHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        if (this.customHandler && this.customHandler(req, res)) {
          return
        }

        // Default: Mock streaming completion for chat and creation
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            const isStream = body.includes('"stream":true') || body.includes('"stream": true')

            if (isStream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
              })

              const deltas = ['天色渐暗，', '山道崎岖。', '韩立加快了脚步，', '终于看到了七玄门的山门。']
              for (const delta of deltas) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta }, finish_reason: null }] })}\n\n`)
              }
              res.write('data: [DONE]\n\n')
              res.end()
            } else {
              // Standard JSON response (e.g. embeddings or analysis)
              if (req.url?.includes('embeddings')) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  data: [{ embedding: new Array(1536).fill(0.01) }]
                }))
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  choices: [{ message: { content: '生成的分析或大纲内容' }, finish_reason: 'stop' }]
                }))
              }
            }
          })
          return
        }

        res.writeHead(404)
        res.end()
      })

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        this.url = `http://127.0.0.1:${this.port}/v1`
        resolve()
      })
    })
  }

  setHandler(handler: (req: IncomingMessage, res: ServerResponse) => boolean) {
    this.customHandler = handler
  }

  resetHandler() {
    this.customHandler = null
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }
}

/**
 * Creates an isolated dual-track testing environment with all services wired
 */
export async function createDualTrackTestEnv(): Promise<DualTrackTestEnv> {
  const tempDir = join(tmpdir(), `novel-dualtrack-test-${randomUUID()}`)
  mkdirSync(tempDir, { recursive: true })
  const dataDir = join(tempDir, 'data')
  mkdirSync(dataDir, { recursive: true })
  const novelsDir = join(tempDir, 'novels')
  mkdirSync(novelsDir, { recursive: true })

  const llmServer = new MockLlmServer()
  await llmServer.start()

  const connectionStore = new ConnectionStore(dataDir)
  const diagnostics = new DiagnosticsService(dataDir)
  const gateway = new ModelGateway(connectionStore, diagnostics)
  const store = new ProjectStore(dataDir, connectionStore)
  const searchIndex = new SearchIndex(store, gateway, connectionStore)
  const chapters = new ChapterRepository(store, searchIndex)
  const knowledge = new KnowledgeRepository(store, searchIndex)
  const creative = new CreativeRepository(store, searchIndex)
  const contextAssembler = new ContextAssembler(store, searchIndex, connectionStore, gateway)
  const candidateService = new CandidateService(store, searchIndex)
  const creationRunner = new CreationRunner(store, gateway, connectionStore, contextAssembler, candidateService)
  const chatService = new ChatService(store, gateway, connectionStore, contextAssembler, searchIndex)
  const analysisRunner = new AnalysisRunner(store, gateway, connectionStore, searchIndex)

  // Configure connection store to point to mock LLM server
  connectionStore.create({
    name: 'Mock DualTrack LLM',
    kind: 'generation',
    baseUrl: llmServer.url,
    apiKey: 'mock-key-dualtrack',
    model: 'gpt-4o',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    isLocalService: true
  })

  const cleanup = async () => {
    try {
      await llmServer.stop()
      // Give SQLite handles a short moment to release
      await new Promise((r) => setTimeout(r, 50))
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore Windows temp cleanup delays
    }
  }

  return {
    tempDir,
    dataDir,
    novelsDir,
    connectionStore,
    diagnostics,
    gateway,
    store,
    searchIndex,
    chapters,
    knowledge,
    creative,
    contextAssembler,
    candidateService,
    creationRunner,
    chatService,
    analysisRunner,
    llmServer,
    cleanup
  }
}

/**
 * Creates a valid test project in the test environment with properly structured destination
 */
export function createTestProject(env: DualTrackTestEnv, title = '测试作品') {
  const destination = join(env.novelsDir, `${randomUUID()}.novelproj`)
  return env.store.create({ title, description: '测试项目简介', destination })
}

/**
 * Simulated WebView2 Wire Protocol Bridge (Host <-> WebView2 Frontend)
 * Implements wire format from PROJECT.md:
 * - rpc_request: { type: 'rpc_request', id: string, channel: string, payload?: unknown }
 * - rpc_response: { type: 'rpc_response', id: string, ok: true, value: unknown } | { type: 'rpc_response', id: string, ok: false, error: { code: string, message: string } }
 * - event: { type: 'event', channel: string, payload: unknown }
 */
export class WebView2BridgeSimulator extends EventEmitter {
  private handlers = new Map<string, (payload: unknown) => Promise<unknown>>()

  registerHandler(channel: string, handler: (payload: unknown) => Promise<unknown>) {
    this.handlers.set(channel, handler)
  }

  async handleClientMessage(rawMessage: string | object): Promise<string> {
    const msg = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage
    if (msg.type !== 'rpc_request') {
      throw new Error(`Invalid message type: ${msg.type}`)
    }

    const { id, channel, payload } = msg
    const handler = this.handlers.get(channel)
    if (!handler) {
      return JSON.stringify({
        type: 'rpc_response',
        id,
        ok: false,
        error: { code: 'METHOD_NOT_FOUND', message: `Channel ${channel} not found` }
      })
    }

    try {
      const result = await handler(payload)
      return JSON.stringify({
        type: 'rpc_response',
        id,
        ok: true,
        value: result
      })
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string }
      return JSON.stringify({
        type: 'rpc_response',
        id,
        ok: false,
        error: {
          code: errorObj.code || 'UNKNOWN_ERROR',
          message: errorObj.message || 'Operation failed'
        }
      })
    }
  }

  sendPushEvent(channel: string, payload: unknown): string {
    const eventMsg = {
      type: 'event',
      channel,
      payload
    }
    const serialized = JSON.stringify(eventMsg)
    this.emit('message', serialized)
    return serialized
  }
}

/**
 * Simulated Node.js Sidecar JSON-RPC 2.0 NDJSON Protocol Runner
 * Implements wire format from PROJECT.md:
 * - Request: {"jsonrpc":"2.0","id":"...","method":"...","params":{...}}
 * - Response: {"jsonrpc":"2.0","id":"...","result":{...}} or {"jsonrpc":"2.0","id":"...","error":{"code":...,"message":"..."}}
 * - Event: {"jsonrpc":"2.0","method":"event","params":{"channel":"...","payload":{...}}}
 */
export class SidecarJsonRpcSimulator {
  private methods = new Map<string, (params: unknown) => Promise<unknown>>()
  public stdoutLines: string[] = []
  public stderrLines: string[] = []

  registerMethod(name: string, handler: (params: unknown) => Promise<unknown>) {
    this.methods.set(name, handler)
  }

  async processIncomingNdjson(chunk: string): Promise<string[]> {
    const lines = chunk.split('\n').filter((l) => l.trim().length > 0)
    const responses: string[] = []

    for (const line of lines) {
      try {
        const req = JSON.parse(line)
        if (req.jsonrpc !== '2.0') {
          responses.push(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id ?? null,
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be 2.0' }
          }))
          continue
        }

        const handler = this.methods.get(req.method)
        if (!handler) {
          responses.push(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` }
          }))
          continue
        }

        try {
          const result = await handler(req.params)
          responses.push(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result
          }))
        } catch (e: unknown) {
          const err = e as { code?: string; message?: string }
          responses.push(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32000, message: err.message || 'Server error', data: { domainCode: err.code } }
          }))
        }
      } catch {
        responses.push(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }))
      }
    }

    this.stdoutLines.push(...responses)
    return responses
  }

  emitEvent(channel: string, payload: unknown): string {
    const notification = JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: { channel, payload }
    })
    this.stdoutLines.push(notification)
    return notification
  }
}

/**
 * Text counter assertion helper using allocation-free counter from shared
 */
export function getAccurateCharacterCount(text: string): number {
  return count(text)
}
