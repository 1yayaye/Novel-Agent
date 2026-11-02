import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway, type ToolDefinition } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SOLIUMBRA_REPLY_TOOL } from '../src/main/prompt-preset'
import { SOLIUMBRA_TOOL_NAME } from '../src/shared/prompt-settings'

describe('ModelGateway - Native Tool Calling Support', () => {
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
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-gw-tools-'))
    store = new ConnectionStore(tempDir)
    diagnostics = new DiagnosticsService(tempDir)
    gateway = new ModelGateway(store, diagnostics)
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('passes tools and tool_choice in non-streaming chatCompletion and extracts tool_calls', async () => {
    const conn = store.create({
      name: 'Tool Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let capturedBody: any = null

    requestHandler = async (req, res) => {
      let bodyText = ''
      for await (const chunk of req) {
        bodyText += chunk
      }
      capturedBody = JSON.parse(bodyText)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_soli_123',
                  type: 'function',
                  function: {
                    name: SOLIUMBRA_TOOL_NAME,
                    arguments: JSON.stringify({
                      think_nya: '小猫推演完毕喵',
                      game_content: '雪落无声，万籁俱寂。',
                      options: ['选项A', '选项B'],
                      summary: '初雪之夜。'
                    })
                  }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 }
      }))
    }

    const result = await gateway.chatCompletion({
      connectionId: conn.id,
      messages: [{ role: 'user', content: '写一段雪景' }],
      tools: [SOLIUMBRA_REPLY_TOOL],
      toolChoice: { type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } }
    })

    expect(capturedBody).toBeDefined()
    expect(capturedBody.tools).toHaveLength(1)
    expect(capturedBody.tools[0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(capturedBody.tool_choice).toEqual({ type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } })

    expect(result.text).toBe('')
    expect(result.toolCalls).toBeDefined()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toBe('call_soli_123')
    expect(result.toolCalls![0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(result.toolCalls![0].function.arguments).toContain('雪落无声')
    expect(result.usage?.totalTokens).toBe(230)
  })

  it('streams tool_calls via SSE chunks and does not throw empty output error', async () => {
    const conn = store.create({
      name: 'Stream Tool Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    let capturedBody: any = null

    requestHandler = async (req, res) => {
      let bodyText = ''
      for await (const chunk of req) {
        bodyText += chunk
      }
      capturedBody = JSON.parse(bodyText)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // Chunk 1: Tool call start
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_stream_1',
              type: 'function',
              function: {
                name: SOLIUMBRA_TOOL_NAME,
                arguments: '{"game_content": "'
              }
            }]
          }
        }]
      })}\n\n`)

      // Chunk 2: Tool call arguments continuation
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: '林晨握紧佩剑，快步走出山门。'
              }
            }]
          }
        }]
      })}\n\n`)

      // Chunk 3: Closing arguments
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: '", "summary": "下山历练。"}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })}\n\n`)

      res.write('data: [DONE]\n\n')
      res.end()
    }

    const chunks = []
    for await (const chunk of gateway.chatCompletionStream({
      connectionId: conn.id,
      messages: [{ role: 'user', content: '继续写' }],
      tools: [SOLIUMBRA_REPLY_TOOL],
      toolChoice: 'auto'
    })) {
      chunks.push(chunk)
    }

    expect(capturedBody.tool_choice).toBe('auto')
    expect(chunks.length).toBeGreaterThan(0)
    const toolChunks = chunks.filter((c) => c.toolCalls && c.toolCalls.length > 0)
    expect(toolChunks.length).toBe(3)
    expect(toolChunks[0].toolCalls![0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(toolChunks[1].toolCalls![0].function.arguments).toBe('林晨握紧佩剑，快步走出山门。')
  })

  it('assertRequestAllowed accounts for tool definition tokens in budget validation', async () => {
    const conn = store.create({
      name: 'Tight Context Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'tight-model',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    // Tiny context window that cannot fit the tool definition + message
    const tinyBudget = {
      connectionId: conn.id,
      connectionVersion: conn.version,
      contextWindow: 100,
      maxOutputTokens: 20,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 2.0
    }

    await expect(
      gateway.chatCompletion({
        connectionId: conn.id,
        messages: [{ role: 'user', content: '测试超限' }],
        tools: [SOLIUMBRA_REPLY_TOOL],
        requestBudget: tinyBudget
      })
    ).rejects.toMatchObject({ code: 'MODEL_CONTEXT_EXCEEDED' })
  })

  it('preserves tool call index in streaming chunks and supports mixed text and tool_calls', async () => {
    const conn = store.create({
      name: 'Index & Mixed Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // Chunk with index 1 (second tool call) and simultaneous delta content
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            content: '思考前置信息',
            tool_calls: [{
              index: 1,
              id: 'call_idx_1',
              type: 'function',
              function: {
                name: 'novel_reply',
                arguments: '{"content": "正文内容"}'
              }
            }]
          }
        }]
      })}\n\n`)

      res.write('data: [DONE]\n\n')
      res.end()
    }

    const chunks = []
    for await (const chunk of gateway.chatCompletionStream({
      connectionId: conn.id,
      messages: [{ role: 'user', content: '测试' }],
      tools: [SOLIUMBRA_REPLY_TOOL]
    })) {
      chunks.push(chunk)
    }

    const toolChunk = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0)
    expect(toolChunk).toBeDefined()
    expect(toolChunk!.text).toBe('思考前置信息')
    expect(toolChunk!.toolCalls![0].index).toBe(1)
    expect(toolChunk!.toolCalls![0].function.arguments).toBe('{"content": "正文内容"}')
  })

  it('rejects non-streaming truncated tool_calls (finish_reason=length)', async () => {
    const conn = store.create({
      name: 'Truncated Tool Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [
          {
            finish_reason: 'length',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_trunc_1',
                  type: 'function',
                  function: {
                    name: SOLIUMBRA_TOOL_NAME,
                    arguments: '{"game_content": "雪落无声，万籁俱'
                  }
                }
              ]
            }
          }
        ]
      }))
    }

    await expect(
      gateway.chatCompletion({
        connectionId: conn.id,
        messages: [{ role: 'user', content: '写一段雪景' }],
        tools: [SOLIUMBRA_REPLY_TOOL],
        toolChoice: { type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } }
      })
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })
  })

  it('rejects streaming truncated tool_calls (finish_reason=length)', async () => {
    const conn = store.create({
      name: 'Truncated Stream Tool Model',
      kind: 'generation',
      baseUrl: serverUrl,
      model: 'gpt-4o',
      isLocalService: true
    })
    store.confirmContentTarget(conn.id, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    requestHandler = async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // 半截工具参数 + length 截断：网关必须拒绝而不是把半截参数交给下游修复
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_trunc_2',
              type: 'function',
              function: {
                name: SOLIUMBRA_TOOL_NAME,
                arguments: '{"game_content": "雪落无声，'
              }
            }]
          }
        }]
      })}\n\n`)

      res.write(`data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'length' }]
      })}\n\n`)

      res.write('data: [DONE]\n\n')
      res.end()
    }

    await expect(async () => {
      for await (const chunk of gateway.chatCompletionStream({
        connectionId: conn.id,
        messages: [{ role: 'user', content: '继续写' }],
        tools: [SOLIUMBRA_REPLY_TOOL],
        toolChoice: { type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } }
      })) {
        void chunk
      }
    }).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })
  })
})
