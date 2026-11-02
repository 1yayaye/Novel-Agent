import { createInterface } from 'node:readline'
import { dataDirectory, ensureWritableDirectory } from './paths.js'
import { ProjectStore } from './project-store.js'
import { ConnectionStore } from './connection-store.js'
import { ModelGateway } from './model-gateway.js'
import { DiagnosticsService } from './diagnostics.js'
import { SearchIndex } from './search-index.js'
import { ContextAssembler } from './context-assembler.js'
import { CandidateService } from './candidate-service.js'
import { CreationRunner } from './creation-runner.js'
import { ChatService } from './chat-service.js'
import { AnalysisRunner } from './analysis-runner.js'
import { PromptSettingsStore } from './prompt-store.js'
import {
  createServiceRouter,
  type ServiceRouter,
  type ServiceRouterDependencies
} from './service-router.js'

export interface SidecarOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  router?: ServiceRouter
  deps?: ServiceRouterDependencies
  dataPath?: string
  redirectConsole?: boolean
  exitOnClose?: boolean
}

export function createDefaultSidecarDeps(customDataPath?: string): ServiceRouterDependencies {
  const dataPath = customDataPath || process.env.NOVEL_AGENT_DATA_PATH || dataDirectory(process.execPath, false)
  ensureWritableDirectory(dataPath)
  // 数据目录走 stderr（stdout 是 NDJSON 协议通道），便于排查双端数据目录分叉。
  process.stderr.write(`[sidecar] data directory: ${dataPath}\n`)
  const promptStore = new PromptSettingsStore(dataPath)
  const store = new ProjectStore(dataPath)
  const connectionStore = new ConnectionStore(dataPath)
  const diagnostics = new DiagnosticsService(dataPath)
  const modelGateway = new ModelGateway(connectionStore, diagnostics)
  const searchIndexInstance = new SearchIndex(store, modelGateway, connectionStore)
  const contextAssembler = new ContextAssembler(store, promptStore, searchIndexInstance, connectionStore, modelGateway)
  const candidateService = new CandidateService(store, searchIndexInstance)
  const creationRunner = new CreationRunner(store, modelGateway, connectionStore, contextAssembler, candidateService)
  const chatService = new ChatService(store, promptStore, modelGateway, connectionStore, contextAssembler, searchIndexInstance)
  const analysisRunner = new AnalysisRunner(store, promptStore, modelGateway, connectionStore, searchIndexInstance)

  return {
    store,
    promptStore,
    connectionStore,
    modelGateway,
    diagnostics,
    analysisRunner,
    creationRunner,
    candidateService,
    chatService,
    searchIndexInstance
  }
}

export function startSidecar(options: SidecarOptions = {}): {
  router: ServiceRouter
  close: () => Promise<void>
} {
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  const exitOnClose = options.exitOnClose ?? false

  let originalLog: typeof console.log | undefined
  let originalInfo: typeof console.info | undefined

  if (options.redirectConsole) {
    originalLog = console.log
    originalInfo = console.info
    console.log = (...args: unknown[]) => {
      process.stderr.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n')
    }
    console.info = (...args: unknown[]) => {
      process.stderr.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n')
    }
  }

  const router = options.router || createServiceRouter(options.deps || createDefaultSidecarDeps(options.dataPath))

  const rl = createInterface({
    input,
    crlfDelay: Infinity,
    terminal: false
  })

  // 未落地的写入计数：Windows 管道写是异步的，进程退出过早会把缓冲中的
  // 最后一条响应截断（宿主会误判"最后一条命令失败"）。
  let pendingWrites = 0
  const writeOut = (payload: string): void => {
    pendingWrites += 1
    output.write(payload + '\n', () => {
      pendingWrites -= 1
    })
  }

  const waitForOutputDrain = async (): Promise<void> => {
    const deadline = Date.now() + 1000
    while (pendingWrites > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
  }

  const unsubscribeEvents = router.onEvent((event) => {
    try {
      const notification = JSON.stringify({
        jsonrpc: '2.0',
        method: 'event',
        params: {
          channel: event.channel,
          payload: event.payload
        }
      })
      writeOut(notification)
    } catch (err) {
      process.stderr.write(`[Sidecar] Failed to write event notification: ${String(err)}\n`)
    }
  })

  let isClosing = false
  const close = async () => {
    if (isClosing) return
    isClosing = true
    unsubscribeEvents()
    rl.close()
    if (options.redirectConsole && originalLog && originalInfo) {
      console.log = originalLog
      console.info = originalInfo
    }
    try {
      await router.dispose()
    } finally {
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
    }
    await waitForOutputDrain()
    if (exitOnClose) {
      process.exit(0)
    }
  }

  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let req: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
    try {
      req = JSON.parse(trimmed)
    } catch {
      writeOut(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        })
      )
      return
    }

    if (req.jsonrpc !== '2.0') {
      writeOut(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: { code: -32600, message: 'Invalid Request: jsonrpc must be 2.0' }
        })
      )
      return
    }

    if (!req.method || !router.has(req.method)) {
      writeOut(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` }
        })
      )
      return
    }

    try {
      const res = await router.handle(req.method, req.params)
      if (res.ok) {
        writeOut(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: res.value
          })
        )
      } else {
        const err = res.error as { code?: string; message?: string }
        writeOut(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32000,
              message: err.message || 'Server error',
              data: { domainCode: err.code }
            }
          })
        )
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      writeOut(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32000,
            message: err.message || 'Server error',
            data: { domainCode: err.code }
          }
        })
      )
    }
  })

  rl.on('close', () => {
    void close()
  })

  const onSignal = () => {
    void close()
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  return { router, close }
}
