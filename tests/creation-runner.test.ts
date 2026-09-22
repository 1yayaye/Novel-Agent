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

describe('CreationRunner - Streaming Typewriter Pipeline (SPEC 6.9, 6.10, 8.2, 8.3)', () => {
  let server: ReturnType<typeof createServer>
  let serverPort = 0
  let serverUrl = ''
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void
  let tempDir: string
  let connectionStore: ConnectionStore
  let diagnostics: DiagnosticsService
  let gateway: ModelGateway
  let store: ProjectStore
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
    tempDir = join(tmpdir(), `novel-agent-creation-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    connectionStore = new ConnectionStore(dataDir)
    diagnostics = new DiagnosticsService(dataDir)
    gateway = new ModelGateway(connectionStore, diagnostics)
    store = new ProjectStore(dataDir, connectionStore)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connectionStore)
    candidateService = new CandidateService(store, searchIndex)
    runner = new CreationRunner(store, gateway, connectionStore, contextAssembler, candidateService)

    const conn = connectionStore.create({
      name: 'Local LLM',
      kind: 'generation',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'test-model',
      contextWindow: 16000,
      maxOutputTokens: 2000,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connId = conn.id
    connectionStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-creation.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙', description: '创作测试' }, [
      { title: '第一章 拜入宗门', content: '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。' }
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

  it('streams candidate generation and completes to ready state with diff hunks', async () => {
    requestHandler = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      const chunks = [
        '韩立背负青竹剑离开五里沟，',
        '怀揣神秘玉佩前往七玄门。',
        '山风凛冽，白云苍狗。'
      ]
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[0] } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[1] } }] })}\n\n`)
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[2] } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, 140)
    }

    // Generate context package first
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const deltas: Array<{ delta: string; fullText: string }> = []
    let doneCandidate: any = null
    runner.setCallbacks({
      onDelta: (event) => {
        deltas.push({ delta: event.delta, fullText: event.fullText })
      },
      onDone: (event) => {
        doneCandidate = event.candidate
      }
    })

    const started = await runner.startCreation(sessionId, pkg.id)

    expect(started.candidateId).toBeDefined()
    expect(started.taskId).toBeDefined()

    // Wait for streaming completion
    await new Promise((resolve) => setTimeout(resolve, 300))

    const candDetail = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candDetail.state).toBe('ready')
    expect(candDetail.rawOutput).toBe('韩立背负青竹剑离开五里沟，怀揣神秘玉佩前往七玄门。山风凛冽，白云苍狗。')
    expect(candDetail.hunks.length).toBeGreaterThan(0)
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.some((event) => event.fullText === '韩立背负青竹剑离开五里沟，怀揣神秘玉佩前往七玄门。')).toBe(true)
    expect(deltas[deltas.length - 1].fullText).toBe(candDetail.rawOutput)
  })

  it('cancels ongoing streaming and marks candidate cancelled while preserving output', async () => {
    requestHandler = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // Send one chunk immediately
      const payload = { choices: [{ delta: { content: '部分生成的内容...' } }] }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      // Never send [DONE] to keep stream open
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
        onDone: () => resolve()
      })
    })

    const started = await runner.startCreation(sessionId, pkg.id)

    // Wait for initial delta
    await new Promise((resolve) => setTimeout(resolve, 80))

    // Verify the latest partial output survives the checkpoint interval.
    await new Promise((resolve) => setTimeout(resolve, 1050))
    expect(candidateService.getCandidate(sessionId, started.candidateId).rawOutput).toContain('部分生成的内容')

    // Cancel creation!
    await runner.cancelCreation(sessionId, started.taskId)
    await donePromise

    const candDetail = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candDetail.state).toBe('cancelled')
    expect(candDetail.rawOutput).toContain('部分生成的内容')

    // Adversarial Check: Closing project during active streaming generation terminates cleanly with 0 unhandled promise rejections
    const unhandledRejections: unknown[] = []
    const rejectionHandler = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', rejectionHandler)

    try {
      const pkg2 = await contextAssembler.assembleContext({
        sessionId,
        connectionId: connId,
        taskType: 'continue',
        instruction: '',
        target: { chapterId }
      })
      await runner.startCreation(sessionId, pkg2.id)
      await new Promise((resolve) => setTimeout(resolve, 30))
      // Close project midway through streaming
      store.close(sessionId)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(unhandledRejections).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', rejectionHandler)
    }
  })

  it('marks candidate stale if chapter version was modified during streaming', async () => {
    requestHandler = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      setTimeout(() => {
        const payload = { choices: [{ delta: { content: '生成的正文' } }] }
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, 100)
    }

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const started = await runner.startCreation(sessionId, pkg.id)

    // Concurrently edit the chapter in DB!
    chapters.update(sessionId, chapterId, '作者修改了正文', 1)

    // Wait for streaming completion
    await new Promise((resolve) => setTimeout(resolve, 300))

    const candDetail = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candDetail.state).toBe('stale') // Transitioned directly to stale!
  })

  it('handles network error during generation and marks candidate failed with draft preserved', async () => {
    requestHandler = (req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal Model Gateway Error' }))
    }

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const failedPromise = new Promise<void>((resolve) => {
      runner.setCallbacks({
        onDone: () => resolve()
      })
    })

    const started = await runner.startCreation(sessionId, pkg.id)

    // Wait for error handling
    await failedPromise

    const candDetail = candidateService.getCandidate(sessionId, started.candidateId)
    expect(candDetail.state).toBe('failed')
  })

  it('regenerates creation without overwriting previous candidate', async () => {
    requestHandler = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      const payload = { choices: [{ delta: { content: '生成的新版本候选' } }] }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      instruction: '',
      target: { chapterId }
    })

    const first = await runner.startCreation(sessionId, pkg.id)

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Regenerate
    const second = await runner.regenerateCreation(sessionId, first.candidateId, pkg.id)

    expect(second.candidateId).not.toBe(first.candidateId)

    await new Promise((resolve) => setTimeout(resolve, 200))

    const list = candidateService.listCandidates(sessionId)
    expect(list.length).toBe(2)
  })
})
