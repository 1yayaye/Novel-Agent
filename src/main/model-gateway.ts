import { createHash, randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import {
  type ConnectionTestResult,
  type ListRemoteModelsInput,
  type ListRemoteModelsResult,
  type ModelConnectionSummary,
  type RemoteModelSummary,
  type TaskType
} from '../shared/project'
import { ConnectionStore, getFinalEndpointUrl, getModelsEndpointUrl, validateBaseUrl } from './connection-store'
import type { DiagnosticsService } from './diagnostics'
import { ProjectError } from './project-store'

const CONTENT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const EMBEDDING_REQUEST_TIMEOUT_MS = 60 * 1000
const STREAM_IDLE_TIMEOUT_MS = 60 * 1000

interface RequestBudget {
  signal: AbortSignal
  timedOut(): boolean
  touch(): void
  dispose(): void
  timeoutMessage: string
}

function createRequestBudget(parent: AbortSignal | undefined, timeoutMs: number, timeoutMessage: string): RequestBudget {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    if (controller.signal.aborted) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('request timeout'))
    }, timeoutMs)
  }

  const onParentAbort = () => {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort(parent?.reason)
  }

  if (parent?.aborted) {
    onParentAbort()
  } else {
    parent?.addEventListener('abort', onParentAbort, { once: true })
    arm()
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    touch: arm,
    timeoutMessage,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    }
  }
}

function isTimeoutSignal(signal: AbortSignal | undefined): boolean {
  const reason = signal?.reason as { name?: unknown } | undefined
  return reason?.name === 'TimeoutError'
}

async function readResponseTextWithActivity(response: Response, budget: RequestBudget): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new ProjectError('MODEL_OUTPUT_INVALID', '响应缺少数据流')

  const decoder = new TextDecoder()
  let text = ''
  let bodyComplete = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        bodyComplete = true
        break
      }
      budget.touch()
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    if (!bodyComplete) {
      try { await reader.cancel() } catch {}
    }
    try { reader.releaseLock() } catch {}
  }
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatStreamChunk {
  text: string
  done: boolean
  usage?: TokenUsage
}

export interface ChatCompletionOptions {
  connectionId: string
  taskType?: TaskType
  priority?: 'high' | 'low'
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: {
    type: 'json_schema'
    json_schema: {
      name: string
      strict?: boolean
      schema: Record<string, unknown>
    }
  }
  signal?: AbortSignal
  isContentRequest?: boolean
  taskId?: string
}

export interface StructuredJsonOptions<T> {
  connectionId: string
  taskType?: TaskType
  priority?: 'high' | 'low'
  messages: ChatMessage[]
  jsonSchema: Record<string, unknown>
  zodSchema: ZodType<T>
  schemaName?: string
  temperature?: number
  signal?: AbortSignal
  isContentRequest?: boolean
  taskId?: string
}

export interface EmbeddingOptions {
  connectionId: string
  texts: string[]
  signal?: AbortSignal
  isContentRequest?: boolean
  priority?: 'high' | 'low'
  taskId?: string
}

export interface EmbeddingResult {
  embeddings: number[][]
  dimensions: number
  usage?: TokenUsage
}

interface QueuedTask<T> {
  id: string
  priority: 'high' | 'low'
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  started: boolean
  holdSlot?: boolean
}

class ConnectionQueue {
  private active = false
  private highQueue: Array<QueuedTask<unknown>> = []
  private lowQueue: Array<QueuedTask<unknown>> = []

  enqueue<T>(priority: 'high' | 'low', execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.acquire(priority, signal).then(async (release) => {
      try {
        return await execute()
      } finally {
        release()
      }
    })
  }

  acquire(priority: 'high' | 'low', signal?: AbortSignal): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      let task!: QueuedTask<() => void>
      const queue = priority === 'high' ? this.highQueue : this.lowQueue
      const cleanup = () => signal?.removeEventListener('abort', cancel)
      const cancel = () => {
        if (task.started) return
        const index = queue.indexOf(task as unknown as QueuedTask<unknown>)
        if (index === -1) return
        queue.splice(index, 1)
        cleanup()
        reject(new ProjectError('TASK_CANCELLED', '任务已由作者取消'))
      }

      if (signal?.aborted) {
        reject(new ProjectError('TASK_CANCELLED', '任务已由作者取消'))
        return
      }

      task = {
        id: randomUUID(),
        priority,
        execute: async () => {
          task.started = true
          cleanup()
          let released = false
          return () => {
            if (released) return
            released = true
            this.release()
          }
        },
        resolve: (release) => {
          cleanup()
          resolve(release)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
        started: false,
        holdSlot: true
      }

      signal?.addEventListener('abort', cancel, { once: true })
      queue.push(task as unknown as QueuedTask<unknown>)
      this.processNext()
    })
  }

  private processNext(): void {
    if (this.active) return

    const task = this.highQueue.shift() || this.lowQueue.shift()
    if (!task) return

    this.active = true
    task.execute()
      .then((res) => {
        task.resolve(res)
      })
      .catch((err) => {
        task.reject(err)
      })
      .finally(() => {
        if (!task.holdSlot) this.release()
      })
  }

  private release(): void {
    this.active = false
    this.processNext()
  }
}

export class ModelGateway {
  private readonly queues = new Map<string, ConnectionQueue>()

  constructor(
    private readonly connectionStore: ConnectionStore,
    private readonly diagnostics?: DiagnosticsService
  ) {}

  private getQueue(connectionId: string): ConnectionQueue {
    let queue = this.queues.get(connectionId)
    if (!queue) {
      queue = new ConnectionQueue()
      this.queues.set(connectionId, queue)
    }
    return queue
  }

  async testConnection(input: { connectionId?: string; draft?: { baseUrl: string; model: string; apiKey?: string; customHeaders?: Record<string, string>; isLocalService?: boolean } }): Promise<ConnectionTestResult> {
    let baseUrl: string
    let model: string
    let apiKey: string | undefined
    let customHeaders: Record<string, string> | undefined
    let isLocalService = false

    if (input.connectionId) {
      const { connection, secret } = this.connectionStore.getInternal(input.connectionId)
      baseUrl = connection.baseUrl
      model = connection.model
      apiKey = secret.apiKey
      customHeaders = secret.customHeaders
      isLocalService = connection.isLocalService
    } else if (input.draft) {
      baseUrl = input.draft.baseUrl
      model = input.draft.model
      apiKey = input.draft.apiKey
      customHeaders = input.draft.customHeaders
      isLocalService = input.draft.isLocalService ?? false
    } else {
      throw new ProjectError('VALIDATION_ERROR', '缺少连接信息')
    }

    const startTime = Date.now()
    const { url } = getFinalEndpointUrl(baseUrl, 'chat')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders || {})
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const payload = {
      model,
      messages: [{ role: 'user', content: 'Ping' }],
      max_tokens: 2
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))

      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        let errDetail = ''
        try {
          const errBody = await response.text()
          errDetail = errBody.slice(0, 300)
        } catch {}
        if (response.status === 401 || response.status === 403) {
          throw new ProjectError('AUTH_FAILED', `认证失败 (HTTP ${response.status})：${errDetail || '请检查 API Key'}`)
        }
        throw new ProjectError('CONNECTION_FAILED', `连接测试失败 (HTTP ${response.status})：${errDetail || response.statusText}`)
      }

      return {
        success: true,
        latencyMs,
        message: '连接正常'
      }
    } catch (error) {
      if (error instanceof ProjectError) throw error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      throw new ProjectError('CONNECTION_FAILED', isAbort ? '连接超时（15秒未响应）' : `连接失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async listModels(input: ListRemoteModelsInput): Promise<ListRemoteModelsResult> {
    let baseUrl: string
    let apiKey: string | undefined
    let customHeaders: Record<string, string> | undefined
    let isLocalService = false

    if (input.connectionId) {
      const { connection, secret } = this.connectionStore.getInternal(input.connectionId)
      baseUrl = input.draft?.baseUrl || connection.baseUrl
      apiKey = input.draft?.apiKey || secret.apiKey
      customHeaders = input.draft?.customHeaders || secret.customHeaders
      isLocalService = input.draft?.isLocalService ?? connection.isLocalService
    } else if (input.draft) {
      baseUrl = input.draft.baseUrl
      apiKey = input.draft.apiKey
      customHeaders = input.draft.customHeaders
      isLocalService = input.draft.isLocalService ?? false
    } else {
      throw new ProjectError('VALIDATION_ERROR', '缺少连接信息')
    }

    validateBaseUrl(baseUrl, isLocalService)

    const { url } = getModelsEndpointUrl(baseUrl)

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(customHeaders || {})
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      let response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))

      if (response.status === 404 && !baseUrl.includes('/v1')) {
        const fallbackUrl = baseUrl.replace(/\/+$/, '') + '/v1/models'
        try {
          const fallbackController = new AbortController()
          const fbTimeoutId = setTimeout(() => fallbackController.abort(), 15000)
          const fallbackResponse = await fetch(fallbackUrl, {
            method: 'GET',
            headers,
            signal: fallbackController.signal
          }).finally(() => clearTimeout(fbTimeoutId))
          if (fallbackResponse.ok) {
            response = fallbackResponse
          }
        } catch {
          // ignore fallback failure
        }
      }

      if (!response.ok) {
        let errDetail = ''
        try {
          const errBody = await response.text()
          errDetail = errBody.slice(0, 300)
        } catch {}
        if (response.status === 401 || response.status === 403) {
          throw new ProjectError('AUTH_FAILED', `认证失败 (HTTP ${response.status})：${errDetail || '请检查 API Key'}`)
        }
        if (response.status === 404) {
          throw new ProjectError('CONNECTION_FAILED', `端点未找到 (HTTP 404)：目标服务未提供 /models 列表接口`)
        }
        throw new ProjectError('CONNECTION_FAILED', `获取模型列表失败 (HTTP ${response.status})：${errDetail || response.statusText}`)
      }

      const body = await response.json() as unknown
      const rawList: unknown[] = []

      if (Array.isArray(body)) {
        rawList.push(...body)
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>
        if (Array.isArray(obj.data)) {
          rawList.push(...obj.data)
        } else if (Array.isArray(obj.models)) {
          rawList.push(...obj.models)
        }
      }

      const models: RemoteModelSummary[] = []
      const seenIds = new Set<string>()

      for (const item of rawList) {
        if (typeof item === 'string' && item.trim()) {
          const id = item.trim()
          if (!seenIds.has(id)) {
            seenIds.add(id)
            models.push({ id })
          }
        } else if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const id = typeof record.id === 'string'
            ? record.id.trim()
            : typeof record.name === 'string'
            ? record.name.trim()
            : typeof record.model === 'string'
            ? record.model.trim()
            : ''
          if (id && !seenIds.has(id)) {
            seenIds.add(id)
            models.push({
              id,
              name: typeof record.name === 'string' ? record.name : undefined,
              ownedBy: typeof record.owned_by === 'string' ? record.owned_by : typeof record.ownedBy === 'string' ? record.ownedBy : undefined
            })
          }
        }
      }

      models.sort((a, b) => a.id.localeCompare(b.id))

      return { models }
    } catch (error) {
      if (error instanceof ProjectError) throw error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      throw new ProjectError('CONNECTION_FAILED', isAbort ? '请求超时（15秒未响应）' : `获取模型列表失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }


  async *chatCompletionStream(options: ChatCompletionOptions): AsyncIterable<ChatStreamChunk> {
    const { connectionId, priority = 'high', isContentRequest = true } = options

    if (isContentRequest) {
      this.connectionStore.assertContentTargetConfirmed(connectionId)
    }

    const { connection, secret } = this.connectionStore.getInternal(connectionId)
    const queue = this.getQueue(connectionId)
    const budget = createRequestBudget(options.signal, CONTENT_REQUEST_TIMEOUT_MS, '模型请求超过10分钟截止时间')
    let release: (() => void) | undefined

    try {
      release = await queue.acquire(priority, budget.signal)
      const streamProducer = await this.executeStreamingRequestWithRetry(connection, secret, {
        ...options,
        signal: budget.signal
      })

      let hasYieldedAnyText = false
      let finalUsage: TokenUsage | undefined

      for await (const chunk of streamProducer) {
        if (chunk.text) {
          hasYieldedAnyText = true
        }
        if (chunk.usage) {
          finalUsage = chunk.usage
        }
        yield chunk
      }

      if (!hasYieldedAnyText) {
        throw new ProjectError('MODEL_OUTPUT_INVALID', '模型返回空输出')
      }
    } catch (error) {
      throw this.normalizeRequestError(error, budget, options.signal)
    } finally {
      release?.()
      budget.dispose()
    }
  }

  async generateStructuredJson<T>(options: StructuredJsonOptions<T>): Promise<{ data: T; usage?: TokenUsage; rawOutput: string }> {
    const { connectionId, priority = 'high', isContentRequest = true, zodSchema, jsonSchema } = options

    if (isContentRequest) {
      this.connectionStore.assertContentTargetConfirmed(connectionId)
    }

    const { connection, secret } = this.connectionStore.getInternal(connectionId)
    const queue = this.getQueue(connectionId)
    const budget = createRequestBudget(options.signal, CONTENT_REQUEST_TIMEOUT_MS, '模型请求超过10分钟截止时间')
    const requestOptions = { ...options, signal: budget.signal }

    return queue.enqueue(priority, async () => {
      // 1. Initial Attempt
      let rawOutput = ''
      let usage: TokenUsage | undefined

      try {
        const result = await this.executeNonStreamingRequestWithRetry(connection, secret, {
          ...requestOptions,
          responseFormat: connection.capabilities.jsonSchema
            ? {
                type: 'json_schema',
                json_schema: {
                  name: options.schemaName || 'response_data',
                  strict: true,
                  schema: jsonSchema
                }
              }
            : undefined
        })
        rawOutput = result.text
        usage = result.usage
      } catch (err) {
        if (err instanceof ProjectError) throw err
        throw new ProjectError('CONNECTION_FAILED', `模型调用失败：${err instanceof Error ? err.message : String(err)}`)
      }

      // 2. Parse & Validate
      const firstParseResult = this.parseAndValidate(rawOutput, zodSchema)
      if (firstParseResult.success) {
        return { data: firstParseResult.data, usage, rawOutput }
      }

      // 3. One Minimal Repair Request (SPEC 10.4)
      const repairMessages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are a JSON repair tool. Repair the provided invalid JSON to strictly adhere to the requested schema. Output ONLY valid JSON, with no explanation and no markdown code fences.'
        },
        {
          role: 'user',
          content: `Schema:\n${JSON.stringify(jsonSchema, null, 2)}\n\nValidation Error:\n${firstParseResult.error}\n\nInvalid Output:\n${rawOutput}`
        }
      ]

      let repairedOutput = ''
      try {
        const repairResult = await this.executeNonStreamingRequestWithRetry(connection, secret, {
          ...requestOptions,
          messages: repairMessages,
          responseFormat: connection.capabilities.jsonSchema
            ? {
                type: 'json_schema',
                json_schema: {
                  name: 'repaired_response',
                  strict: true,
                  schema: jsonSchema
                }
              }
            : undefined
        })
        repairedOutput = repairResult.text
        if (repairResult.usage && usage) {
          usage = {
            promptTokens: usage.promptTokens + repairResult.usage.promptTokens,
            completionTokens: usage.completionTokens + repairResult.usage.completionTokens,
            totalTokens: usage.totalTokens + repairResult.usage.totalTokens
          }
        }
      } catch (error) {
        if (error instanceof ProjectError) throw error
        throw new ProjectError('MODEL_OUTPUT_INVALID', `结构化输出解析失败：${firstParseResult.error}`)
      }

      const secondParseResult = this.parseAndValidate(repairedOutput, zodSchema)
      if (secondParseResult.success) {
        return { data: secondParseResult.data, usage, rawOutput: repairedOutput }
      }

      throw new ProjectError('MODEL_OUTPUT_INVALID', `结构化输出修复后仍不符合规范：${secondParseResult.error}`)
    }, budget.signal).catch((error) => {
      throw this.normalizeRequestError(error, budget, options.signal)
    }).finally(() => budget.dispose())
  }

  async createEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult> {
    const { connectionId, priority = 'low', isContentRequest = true, texts } = options
    if (texts.length === 0) {
      return { embeddings: [], dimensions: 0 }
    }

    if (isContentRequest) {
      this.connectionStore.assertContentTargetConfirmed(connectionId)
    }

    const { connection, secret } = this.connectionStore.getInternal(connectionId)
    const queue = this.getQueue(connectionId)
    const budget = createRequestBudget(options.signal, EMBEDDING_REQUEST_TIMEOUT_MS, 'Embedding 请求超过60秒截止时间')
    const requestOptions = { ...options, signal: budget.signal }

    return queue.enqueue(priority, async () => {
      let attempts = 0
      const maxRetries = 2
      const startTime = Date.now()

      while (attempts <= maxRetries) {
        if (requestOptions.signal?.aborted) {
          throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
        }

        try {
          const { url } = getFinalEndpointUrl(connection.baseUrl, 'embeddings')
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(secret.customHeaders || {})
          }
          if (secret.apiKey) {
            headers['Authorization'] = `Bearer ${secret.apiKey}`
          }

          const payload = {
            model: connection.model,
            input: texts
          }

          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: requestOptions.signal,
            redirect: 'error'
          })

          if (!response.ok) {
            const errText = await response.text().catch(() => '')
            if (response.status === 401 || response.status === 403) {
              throw new ProjectError('AUTH_FAILED', `认证失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
            }
            if (response.status === 429) {
              const err = new ProjectError('RATE_LIMITED', `服务限流 (HTTP 429)：${errText.slice(0, 200)}`)
              ;(err as unknown as { response: Response }).response = response
              throw err
            }
            if (response.status >= 500) {
              throw new ProjectError('CONNECTION_FAILED', `服务端错误 (HTTP ${response.status})：${errText.slice(0, 200)}`)
            }
            throw new ProjectError('CONNECTION_FAILED', `请求失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
          }

          const json = await response.json() as {
            data?: Array<{ embedding: number[]; index?: number }>
            usage?: { prompt_tokens?: number; total_tokens?: number }
          }

          if (!json.data || !Array.isArray(json.data) || json.data.length !== texts.length) {
            throw new ProjectError('MODEL_OUTPUT_INVALID', 'Embedding 响应数据缺失或数量与输入不一致')
          }

          const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          const embeddings = sorted.map((d) => d.embedding)

          if (embeddings.length === 0 || !embeddings[0] || embeddings[0].length === 0) {
            throw new ProjectError('MODEL_OUTPUT_INVALID', 'Embedding 向量数据为空')
          }

          const dimensions = embeddings[0].length
          for (let i = 1; i < embeddings.length; i++) {
            if (embeddings[i].length !== dimensions) {
              throw new ProjectError('MODEL_OUTPUT_INVALID', `Embedding 批次维度不一致: index 0 维度为 ${dimensions}，index ${i} 维度为 ${embeddings[i].length}`)
            }
          }

          const usage: TokenUsage | undefined = json.usage
            ? {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: 0,
                totalTokens: json.usage.total_tokens ?? (json.usage.prompt_tokens ?? 0)
              }
            : undefined

          const durationMs = Date.now() - startTime
          this.diagnostics?.logTaskEvent({
            taskId: options.taskId,
            taskType: 'knowledge',
            durationMs,
            statusCode: response.status,
            retryCount: attempts,
            inputTokens: usage?.promptTokens
          })

          const fingerprint = createHash('sha256').update(`${connection.baseUrl}:${connection.model}`).digest('hex').slice(0, 24)
          this.connectionStore.updateEmbeddingMetadata(connectionId, dimensions, fingerprint)

          return { embeddings, dimensions, usage }
        } catch (error) {
          if (requestOptions.signal?.aborted) {
            throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
          }
          if (error instanceof ProjectError) {
            if (error.code === 'AUTH_FAILED' || error.code === 'TASK_CANCELLED' || error.code === 'CONTENT_TARGET_CONFIRMATION_REQUIRED') {
              throw error
            }
          }

          attempts++
          if (attempts > maxRetries) {
            const durationMs = Date.now() - startTime
            this.diagnostics?.logTaskEvent({
              taskId: options.taskId,
              taskType: 'knowledge',
              durationMs,
              retryCount: attempts - 1,
              error: error instanceof ProjectError ? error.code : 'UNKNOWN_ERROR'
            })
            if (error instanceof ProjectError) throw error
            throw new ProjectError('CONNECTION_FAILED', `Embedding 请求重试失败（共 ${attempts} 次）：${error instanceof Error ? error.message : String(error)}`)
          }

          const retryAfterMs = this.calculateRetryDelay(attempts, error)
          await this.sleep(retryAfterMs, requestOptions.signal)
        }
      }

      throw new ProjectError('CONNECTION_FAILED', 'Embedding 请求失败')
    }, budget.signal).catch((error) => {
      throw this.normalizeRequestError(error, budget, options.signal)
    }).finally(() => budget.dispose())
  }

  private normalizeRequestError(error: unknown, budget: RequestBudget, parent?: AbortSignal): unknown {
    if (budget.timedOut() || isTimeoutSignal(parent)) {
      return new ProjectError('CONNECTION_FAILED', budget.timeoutMessage)
    }
    if (parent?.aborted) {
      return new ProjectError('TASK_CANCELLED', '任务已由作者取消')
    }
    return error
  }

  private parseAndValidate<T>(rawText: string, schema: ZodType<T>): { success: true; data: T } | { success: false; error: string } {
    let cleanText = rawText.trim()
    // Strip markdown fences if present
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.slice(7)
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.slice(3)
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3)
    }
    cleanText = cleanText.trim()

    let jsonParsed: unknown
    try {
      jsonParsed = JSON.parse(cleanText)
    } catch (err) {
      return { success: false, error: `JSON 语法错误: ${err instanceof Error ? err.message : String(err)}` }
    }

    const zodResult = schema.safeParse(jsonParsed)
    if (!zodResult.success) {
      return { success: false, error: zodResult.error.message }
    }

    return { success: true, data: zodResult.data }
  }

  private async executeStreamingRequestWithRetry(
    connection: ModelConnectionSummary,
    secret: { apiKey?: string; customHeaders?: Record<string, string> },
    options: ChatCompletionOptions
  ): Promise<AsyncIterable<ChatStreamChunk>> {
    let attempts = 0
    const maxRetries = 2
    const startTime = Date.now()

    while (attempts <= maxRetries) {
      if (options.signal?.aborted) {
        throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
      }

      try {
        return await this.performStreamingFetch(connection, secret, options)
      } catch (error) {
        if (options.signal?.aborted) {
          throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
        }
        if (error instanceof ProjectError) {
          if (error.code === 'AUTH_FAILED' || error.code === 'MODEL_CONTEXT_EXCEEDED' || error.code === 'TASK_CANCELLED' || error.code === 'CONTENT_TARGET_CONFIRMATION_REQUIRED') {
            throw error
          }
        }

        attempts++
        if (attempts > maxRetries) {
          const durationMs = Date.now() - startTime
          this.diagnostics?.logTaskEvent({
            taskId: options.taskId,
            taskType: options.taskType || 'chat',
            durationMs,
            retryCount: attempts - 1,
            error: error instanceof ProjectError ? error.code : 'UNKNOWN_ERROR'
          })
          if (error instanceof ProjectError) throw error
          throw new ProjectError('CONNECTION_FAILED', `模型请求重试失败（共 ${attempts} 次）：${error instanceof Error ? error.message : String(error)}`)
        }

        const retryAfterMs = this.calculateRetryDelay(attempts, error)
        await this.sleep(retryAfterMs, options.signal)
      }
    }

    throw new ProjectError('CONNECTION_FAILED', '模型连接失败')
  }

  private async executeNonStreamingRequestWithRetry(
    connection: ModelConnectionSummary,
    secret: { apiKey?: string; customHeaders?: Record<string, string> },
    options: ChatCompletionOptions
  ): Promise<{ text: string; usage?: TokenUsage }> {
    let attempts = 0
    const maxRetries = 2
    const startTime = Date.now()

    while (attempts <= maxRetries) {
      if (options.signal?.aborted) {
        throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
      }

      try {
        const { url } = getFinalEndpointUrl(connection.baseUrl, 'chat')
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(secret.customHeaders || {})
        }
        if (secret.apiKey) {
          headers['Authorization'] = `Bearer ${secret.apiKey}`
        }

        const payload: Record<string, unknown> = {
          model: connection.model,
          messages: options.messages,
          stream: false
        }
        if (options.temperature !== undefined && connection.capabilities.temperature) {
          payload.temperature = options.temperature
        }
        if (options.maxTokens !== undefined) {
          payload.max_tokens = options.maxTokens
        }
        if (options.responseFormat) {
          payload.response_format = options.responseFormat
        }

        const activityBudget = createRequestBudget(options.signal, STREAM_IDLE_TIMEOUT_MS, '结构化模型请求超过60秒无数据')
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: activityBudget.signal,
            redirect: 'error'
          })

          if (!response.ok) {
            const errText = await readResponseTextWithActivity(response, activityBudget).catch(() => '')
            if (activityBudget.timedOut()) {
              throw new ProjectError('CONNECTION_FAILED', activityBudget.timeoutMessage)
            }
            if (response.status === 401 || response.status === 403) {
              throw new ProjectError('AUTH_FAILED', `认证失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
            }
            if (response.status === 400 && (errText.includes('context_length') || errText.includes('maximum context length') || errText.includes('token count'))) {
              throw new ProjectError('MODEL_CONTEXT_EXCEEDED', `模型上下文超限：${errText.slice(0, 200)}`)
            }
            if (response.status === 429) {
              const err = new ProjectError('RATE_LIMITED', `服务限流 (HTTP 429)：${errText.slice(0, 200)}`)
              ;(err as unknown as { response: Response }).response = response
              throw err
            }
            if (response.status >= 500) {
              throw new ProjectError('CONNECTION_FAILED', `服务端错误 (HTTP ${response.status})：${errText.slice(0, 200)}`)
            }
            throw new ProjectError('CONNECTION_FAILED', `请求失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
          }

          const responseText = await readResponseTextWithActivity(response, activityBudget)
          const json = JSON.parse(responseText) as {
            choices?: Array<{ message?: { content?: string } }>
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
          }

          const text = json.choices?.[0]?.message?.content || ''
          const usage: TokenUsage | undefined = json.usage
            ? {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0
              }
            : undefined

          const durationMs = Date.now() - startTime
          this.diagnostics?.logTaskEvent({
            taskId: options.taskId,
            taskType: options.taskType || 'structured_json',
            durationMs,
            statusCode: response.status,
            retryCount: attempts,
            inputTokens: usage?.promptTokens,
            outputTokens: usage?.completionTokens
          })

          return { text, usage }
        } catch (error) {
          if (activityBudget.timedOut()) {
            throw new ProjectError('CONNECTION_FAILED', activityBudget.timeoutMessage)
          }
          throw error
        } finally {
          activityBudget.dispose()
        }
      } catch (error) {
        if (options.signal?.aborted) {
          throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
        }
        if (error instanceof ProjectError) {
          if (error.code === 'AUTH_FAILED' || error.code === 'MODEL_CONTEXT_EXCEEDED' || error.code === 'TASK_CANCELLED') {
            throw error
          }
        }

        attempts++
        if (attempts > maxRetries) {
          const durationMs = Date.now() - startTime
          this.diagnostics?.logTaskEvent({
            taskId: options.taskId,
            taskType: options.taskType || 'structured_json',
            durationMs,
            retryCount: attempts - 1,
            error: error instanceof ProjectError ? error.code : 'UNKNOWN_ERROR'
          })
          if (error instanceof ProjectError) throw error
          throw new ProjectError('CONNECTION_FAILED', `模型请求重试失败（共 ${attempts} 次）：${error instanceof Error ? error.message : String(error)}`)
        }

        const retryAfterMs = this.calculateRetryDelay(attempts, error)
        await this.sleep(retryAfterMs, options.signal)
      }
    }

    throw new ProjectError('CONNECTION_FAILED', '模型连接失败')
  }

  private async performStreamingFetch(
    connection: ModelConnectionSummary,
    secret: { apiKey?: string; customHeaders?: Record<string, string> },
    options: ChatCompletionOptions
  ): Promise<AsyncIterable<ChatStreamChunk>> {
    const { url } = getFinalEndpointUrl(connection.baseUrl, 'chat')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(secret.customHeaders || {})
    }
    if (secret.apiKey) {
      headers['Authorization'] = `Bearer ${secret.apiKey}`
    }

    const payload: Record<string, unknown> = {
      model: connection.model,
      messages: options.messages,
      stream: true
    }
    if (connection.capabilities.usage) {
      payload.stream_options = { include_usage: true }
    }
    if (options.temperature !== undefined && connection.capabilities.temperature) {
      payload.temperature = options.temperature
    }
    if (options.maxTokens !== undefined) {
      payload.max_tokens = options.maxTokens
    }
    if (options.responseFormat) {
      payload.response_format = options.responseFormat
    }

    const activityBudget = createRequestBudget(options.signal, STREAM_IDLE_TIMEOUT_MS, '模型流式请求超过60秒无数据')
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: activityBudget.signal,
        redirect: 'error'
      })
    } catch (error) {
      const timedOut = activityBudget.timedOut()
      activityBudget.dispose()
      if (timedOut) {
        throw new ProjectError('CONNECTION_FAILED', activityBudget.timeoutMessage)
      }
      throw error
    }

    if (!response.ok) {
      try {
        const errText = await response.text().catch(() => '')
        if (response.status === 401 || response.status === 403) {
          throw new ProjectError('AUTH_FAILED', `认证失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
        }
        if (response.status === 400 && (errText.includes('context_length') || errText.includes('maximum context length') || errText.includes('token count'))) {
          throw new ProjectError('MODEL_CONTEXT_EXCEEDED', `模型上下文超限：${errText.slice(0, 200)}`)
        }
        if (response.status === 429) {
          const err = new ProjectError('RATE_LIMITED', `服务限流 (HTTP 429)：${errText.slice(0, 200)}`)
          ;(err as unknown as { response: Response }).response = response
          throw err
        }
        if (response.status >= 500) {
          throw new ProjectError('CONNECTION_FAILED', `服务端错误 (HTTP ${response.status})：${errText.slice(0, 200)}`)
        }
        throw new ProjectError('CONNECTION_FAILED', `请求失败 (HTTP ${response.status})：${errText.slice(0, 200)}`)
      } finally {
        activityBudget.dispose()
      }
    }

    if (!response.body) {
      activityBudget.dispose()
      throw new ProjectError('MODEL_OUTPUT_INVALID', '响应缺少数据流')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf8')

    async function* sseGenerator(): AsyncIterable<ChatStreamChunk> {
      let buffer = ''
      let normalCompletion = false
      let bodyComplete = false
      let finishReason: string | undefined

      const parseLine = (line: string): ChatStreamChunk | undefined => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return

        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') {
          if (finishReason && finishReason !== 'stop') {
            throw new ProjectError('MODEL_OUTPUT_INVALID', `流式输出未正常结束（finish_reason: ${finishReason}）`)
          }
          normalCompletion = true
          return { text: '', done: true }
        }

        let parsed: {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
          error?: unknown
        }
        try {
          parsed = JSON.parse(dataStr) as typeof parsed
        } catch {
          throw new ProjectError('MODEL_OUTPUT_INVALID', '流式响应包含无效 JSON')
        }

        if (!parsed || typeof parsed !== 'object') {
          throw new ProjectError('MODEL_OUTPUT_INVALID', '流式响应数据格式无效')
        }
        if (parsed.error !== undefined) {
          throw new ProjectError('MODEL_OUTPUT_INVALID', '供应商返回流式错误事件')
        }

        const reason = parsed.choices?.[0]?.finish_reason
        if (reason) {
          if (reason !== 'stop') {
            throw new ProjectError('MODEL_OUTPUT_INVALID', `流式输出未正常结束（finish_reason: ${reason}）`)
          }
          finishReason = reason
        }

        const deltaText = parsed.choices?.[0]?.delta?.content || ''
        const usage: TokenUsage | undefined = parsed.usage
          ? {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0
            }
          : undefined

        if (deltaText || usage) {
          return {
            text: deltaText,
            done: false,
            usage
          }
        }
      }

      try {
        while (true) {
          if (options.signal?.aborted) {
            try {
              await reader.cancel()
            } catch {}
            throw new ProjectError('TASK_CANCELLED', '任务已由作者取消')
          }

          const { done, value } = await reader.read()
          if (done) {
            bodyComplete = true
            break
          }
          activityBudget.touch()

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const chunk = parseLine(line)
            if (chunk) {
              yield chunk
              if (chunk.done) return
            }
          }
        }

        buffer += decoder.decode()
        for (const line of buffer.split(/\r?\n/)) {
          const chunk = parseLine(line)
          if (chunk) {
            yield chunk
            if (chunk.done) return
          }
        }

        if (!normalCompletion && finishReason !== 'stop') {
          throw new ProjectError('MODEL_OUTPUT_INVALID', '流式响应在正常结束信号前中断')
        }

        normalCompletion = true
        yield { text: '', done: true }
      } catch (error) {
        if (activityBudget.timedOut()) {
          throw new ProjectError('CONNECTION_FAILED', activityBudget.timeoutMessage)
        }
        throw error
      } finally {
        if (!bodyComplete) {
          try {
            await reader.cancel()
          } catch {}
          await new Promise<void>((resolve) => setImmediate(resolve))
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        try {
          reader.releaseLock()
        } catch {}
        activityBudget.dispose()
      }
    }

    return sseGenerator()
  }

  private calculateRetryDelay(attempt: number, error: unknown): number {
    if (error && typeof error === 'object' && 'response' in error) {
      const resp = (error as { response: Response }).response
      const retryAfterHeader = resp.headers?.get('retry-after')
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10)
        if (!isNaN(seconds) && seconds > 0) {
          return seconds * 1000
        }
        const dateMs = Date.parse(retryAfterHeader)
        if (!isNaN(dateMs) && dateMs > Date.now()) {
          return dateMs - Date.now()
        }
      }
    }

    // Default backoff: attempt 1 -> 1000ms, attempt 2 -> 3000ms + random jitter 100-400ms
    const base = attempt === 1 ? 1000 : 3000
    const jitter = Math.floor(Math.random() * 300) + 100
    return base + jitter
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve()
      }, ms)

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new ProjectError('TASK_CANCELLED', '任务已由作者取消'))
        }, { once: true })
      }
    })
  }
}
