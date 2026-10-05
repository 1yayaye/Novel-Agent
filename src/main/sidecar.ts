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
  const store = new ProjectStore(dataPath)
  const connectionStore = new ConnectionStore(dataPath)
  const diagnostics = new DiagnosticsService(dataPath)
  const modelGateway = new ModelGateway(connectionStore, diagnostics)
  const searchIndexInstance = new SearchIndex(store, modelGateway, connectionStore)
  const contextAssembler = new ContextAssembler(store, searchIndexInstance, connectionStore, modelGateway)
  const candidateService = new CandidateService(store, searchIndexInstance)
  const creationRunner = new CreationRunner(store, modelGateway, connectionStore, contextAssembler, candidateService)
  const chatService = new ChatService(store, modelGateway, connectionStore, contextAssembler, searchIndexInstance)
  const analysisRunner = new AnalysisRunner(store, modelGateway, connectionStore, searchIndexInstance)

  return {
    store,
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
      output.write(notification + '\n')
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
      output.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }) + '\n'
      )
      return
    }

    if (req.jsonrpc !== '2.0') {
      output.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: { code: -32600, message: 'Invalid Request: jsonrpc must be 2.0' }
        }) + '\n'
      )
      return
    }

    if (!req.method || !router.has(req.method)) {
      output.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` }
        }) + '\n'
      )
      return
    }

    try {
      const res = await router.handle(req.method, req.params)
      if (res.ok) {
        output.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: res.value
          }) + '\n'
        )
      } else {
        const err = res.error as { code?: string; message?: string }
        output.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32000,
              message: err.message || 'Server error',
              data: { domainCode: err.code }
            }
          }) + '\n'
        )
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      output.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32000,
            message: err.message || 'Server error',
            data: { domainCode: err.code }
          }
        }) + '\n'
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
