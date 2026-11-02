import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ModelGateway } from '../src/main/model-gateway'
import { DiagnosticsService } from '../src/main/diagnostics'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { CandidateService } from '../src/main/candidate-service'
import { CreationRunner } from '../src/main/creation-runner'
import { PromptSettingsStore } from '../src/main/prompt-store'
import type { NovelPromptPreset } from '../src/shared/prompt-settings'
import { SOLIUMBRA_TOOL_NAME } from '../src/shared/prompt-settings'

describe('CreationRunner - Tool Calling Streaming & Unpacking Pipeline', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  let tempDir: string
  let connectionStore: ConnectionStore
  let diagnostics: DiagnosticsService
  let gateway: ModelGateway
  let store: ProjectStore
  let promptStore: PromptSettingsStore
  let searchIndex: SearchIndex
  let chapters: ChapterRepository
  let contextAssembler: ContextAssembler
  let candidateService: CandidateService
  let runner: CreationRunner
  let sessionId: string
  let connId: string
  let chapterId: string

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
    server.closeAllConnections?.()
    server.close(() => resolve())
  }))

  beforeEach(async () => {
    tempDir = join(tmpdir(), `novel-agent-tools-creation-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    connectionStore = new ConnectionStore(dataDir)
    diagnostics = new DiagnosticsService(dataDir)
    gateway = new ModelGateway(connectionStore, diagnostics)
    store = new ProjectStore(dataDir, connectionStore)
    promptStore = new PromptSettingsStore(store.dataDirectory)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, promptStore, searchIndex, connectionStore)
    candidateService = new CandidateService(store, searchIndex)
    runner = new CreationRunner(store, gateway, connectionStore, contextAssembler, candidateService)

    const conn = connectionStore.create({
      name: 'Local Tool LLM',
      kind: 'generation',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'test-tool-model',
      contextWindow: 16000,
      maxOutputTokens: 2000,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connId = conn.id
    connectionStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-tool-creation.novelproj')
    store.create({ destination: projectPath, title: '仙途逆行', description: '工具调用测试' }, [
      { title: '第一章 破晓之时', content: '青云山上白雾茫茫，晨钟悠扬。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId
    const chapList = chapters.list(sessionId)
    chapterId = chapList[0].id
  })

  afterEach(async () => {
    server.closeAllConnections?.()
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('streams soliumbra_reply tool call and automatically unpacks pure prose and metadata', async () => {
    // 1. Configure active preset with toolCalling enabled for Meowssiah
    const meowPreset: NovelPromptPreset = {
      id: 'meowssiah-v1',
      name: 'Meowssiah 1.9.12',
      blocks: [
        {
          id: 'b1',
          name: '小猫召唤',
          role: 'system',
          content: '小猫之神会使用reply工具回复',
          enabled: true,
          position: 'relative',
          depth: 0,
          order: 0
        }
      ],
      toolCalling: {
        enabled: true,
        name: SOLIUMBRA_TOOL_NAME
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    promptStore.save({
      activePresetId: meowPreset.id,
      presets: [meowPreset]
    })

    let capturedRequestBody: any = null

    requestHandler = async (req, res) => {
      let bodyText = ''
      for await (const chunk of req) {
        bodyText += chunk
      }
      capturedRequestBody = JSON.parse(bodyText)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // Stream tool calls
      const argChunk1 = '{"think_nya": "小猫思考一下怎么写喵~", "game_content": "林晨握紧长剑，'
      const argChunk2 = '一步踏入云海之中。微风拂面，衣袍猎猎作响。"'
      const argChunk3 = ', "options": ["御剑破空", "步步为营"], "summary": "林晨踏入云海历练。", "comment": "主人喵，云海写得很仙吧喵？"}'

      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_cat_stream',
              type: 'function',
              function: {
                name: SOLIUMBRA_TOOL_NAME,
                arguments: argChunk1
              }
            }]
          }
        }]
      })}\n\n`)

      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: argChunk2
              }
            }]
          }
        }]
      })}\n\n`)

      setTimeout(() => {
        res.write(`data: ${JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: {
                  arguments: argChunk3
                }
              }]
            },
            finish_reason: 'tool_calls'
          }],
          usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }
        })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, 50)
    }

    // Assemble context package
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const deltas: string[] = []
    let doneEvent: any = null
    const donePromise = new Promise<void>((resolve) => {
      runner.setCallbacks({
        onDelta: (event) => {
          deltas.push(event.delta)
        },
        onDone: (event) => {
          doneEvent = event
          resolve()
        }
      })
    })

    const started = await runner.startCreation(sessionId, pkg.id)
    await donePromise

    // Verify request payload had tools
    expect(capturedRequestBody.tools).toBeDefined()
    expect(capturedRequestBody.tools[0].function.name).toBe(SOLIUMBRA_TOOL_NAME)
    expect(capturedRequestBody.tool_choice).toEqual({ type: 'function', function: { name: SOLIUMBRA_TOOL_NAME } })

    // Verify typewriter streaming deltas were delivered
    expect(deltas.length).toBeGreaterThanOrEqual(2)

    // Verify candidate was unpacked properly
    const candidate = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candidate.state).toBe('ready')

    // Clean story prose only in hunks / final synthesized text
    expect(candidate.finalSynthesizedText).toContain('林晨握紧长剑，一步踏入云海之中。微风拂面，衣袍猎猎作响。')
    expect(candidate.finalSynthesizedText).not.toContain('小猫思考')
    expect(candidate.finalSynthesizedText).not.toContain('think_nya')
    expect(candidate.finalSynthesizedText).not.toContain('comment')

    // Derived metadata unpacked directly
    expect(candidate.summary).toBe('林晨踏入云海历练。')
    expect(candidate.comment).toBe('主人喵，云海写得很仙吧喵？')
    expect(candidate.plotOptions).toEqual(['御剑破空', '步步为营'])

    // Raw output preserves the arguments JSON payload
    expect(candidate.rawOutput).toContain('game_content')
    expect(candidate.rawOutput).toContain('think_nya')
  })

  it('unpacks clean prose even when generation is cancelled mid-stream with truncated tool arguments', async () => {
    const meowPreset: NovelPromptPreset = {
      id: 'meowssiah-cancel-test',
      name: 'Meowssiah Cancel Test',
      blocks: [],
      toolCalling: { enabled: true, name: SOLIUMBRA_TOOL_NAME },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    promptStore.save({
      activePresetId: meowPreset.id,
      presets: [meowPreset]
    })

    requestHandler = async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // Send incomplete tool call arguments (no closing quote or brace)
      res.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_cancel_01',
              type: 'function',
              function: {
                name: SOLIUMBRA_TOOL_NAME,
                arguments: '{"think_nya": "构思中喵", "game_content": "韩立深吸了一口气，凝视着前方的迷雾。'
              }
            }]
          }
        }]
      })}\n\n`)

      // Keep connection open until client cancels
    }

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const donePromise = new Promise<void>((resolve) => {
      runner.setCallbacks({
        onDelta: (event) => {
          if (event.delta.includes('迷雾')) {
            // Cancel as soon as partial prose arrives
            void runner.cancelCreation(sessionId, event.taskId)
          }
        },
        onDone: () => resolve()
      })
    })

    const started = await runner.startCreation(sessionId, pkg.id)
    await donePromise

    const candidate = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candidate.state).toBe('cancelled')
    // Partial story prose must be extracted, not broken JSON syntax
    expect(candidate.finalSynthesizedText).toContain('韩立深吸了一口气，凝视着前方的迷雾。')
    expect(candidate.finalSynthesizedText).not.toContain('think_nya')
    expect(candidate.finalSynthesizedText).not.toContain('{"')
  })
})
