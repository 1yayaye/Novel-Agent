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
import { KnowledgeRepository } from '../src/main/knowledge-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { ChatService } from '../src/main/chat-service'
import type { ChatDeltaEvent, ChatDoneEvent } from '../src/shared/project'

describe('ChatService - Q&A, Multi-turn History, Citations & Rolling Summary (SPEC 6.8, 7.2, 8.2)', () => {
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
  let knowledges: KnowledgeRepository
  let contextAssembler: ContextAssembler
  let chatService: ChatService
  let sessionId: string
  let connId: string

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
    tempDir = join(tmpdir(), `novel-agent-chat-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    connectionStore = new ConnectionStore(dataDir)
    diagnostics = new DiagnosticsService(dataDir)
    gateway = new ModelGateway(connectionStore, diagnostics)
    store = new ProjectStore(dataDir, connectionStore)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    knowledges = new KnowledgeRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connectionStore, gateway)
    chatService = new ChatService(store, gateway, connectionStore, contextAssembler, searchIndex)

    const conn = connectionStore.create({
      name: 'Local Q&A Model',
      kind: 'generation',
      isLocalService: true,
      baseUrl: serverUrl,
      model: 'chat-model',
      contextWindow: 16000,
      maxOutputTokens: 2000,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connId = conn.id
    connectionStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-chat.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙记', description: '问答测试' }, [
      { title: '第一章 拜入宗门', content: '韩立收拾行囊离开五里沟，怀揣神秘绿色小瓶前往七玄门拜师求道。' },
      { title: '第二章 墨大夫', content: '墨大夫传授长春功口诀，韩立发现绿色小瓶能够在月光下凝聚绿液催熟草药。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId

    // Add character and item knowledge
    knowledges.createEntry(sessionId, {
      kind: 'character',
      title: '韩立',
      authorContent: '主角，心思缜密，行事谨慎，出身五里沟，持有神秘掌天瓶。'
    })
    knowledges.createEntry(sessionId, {
      kind: 'world',
      title: '掌天瓶',
      authorContent: '神秘仙家法宝，可吸纳月光凝聚催熟灵草的绿液。'
    })

    await searchIndex.sync(sessionId)
  })

  afterEach(async () => {
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('1. should create, list and delete chat sessions with optimistic version check', () => {
    const session1 = chatService.createSession({ sessionId, title: '剧情设定梳理', connectionId: connId })
    expect(session1.id).toBeDefined()
    expect(session1.title).toBe('剧情设定梳理')
    expect(session1.version).toBe(1)

    const session2 = chatService.createSession({ sessionId, title: '时间线推演' })
    expect(session2.title).toBe('时间线推演')

    const list = chatService.listSessions({ sessionId })
    expect(list.length).toBe(2)

    // Delete session2 with wrong expected version -> throws VERSION_CONFLICT
    expect(() => {
      chatService.deleteSession({ sessionId, chatSessionId: session2.id, expectedVersion: 99 })
    }).toThrowError('会话已被修改')

    // Delete session2 with correct version -> success
    const result = chatService.deleteSession({ sessionId, chatSessionId: session2.id, expectedVersion: session2.version })
    expect(result.success).toBe(true)

    const listAfter = chatService.listSessions({ sessionId })
    expect(listAfter.length).toBe(1)
    expect(listAfter[0].id).toBe(session1.id)
  })

  it('2. should send message, stream response, auto-assemble context package and record citations', async () => {
    const session = chatService.createSession({ sessionId, title: '问答测试', connectionId: connId })

    // Mock HTTP SSE Stream
    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"根据[来源1]所述，韩立离开五里沟拜入七玄门。"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"同时[设定:掌天瓶]是仙家法宝，可催熟草药。"}}]}\n\n')
      res.write('data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45,"total_tokens":165}}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    const deltas: string[] = []
    let doneEvent: ChatDoneEvent | undefined

    chatService.setCallbacks({
      onDelta: (ev) => {
        deltas.push(ev.delta)
      },
      onDone: (ev) => {
        doneEvent = ev
      }
    })

    const sendRes = await chatService.sendMessage({
      sessionId,
      chatSessionId: session.id,
      content: '韩立来自哪里？他的掌天瓶有什么用？'
    })

    expect(sendRes.messageId).toBeDefined()
    expect(sendRes.userMessageId).toBeDefined()
    expect(sendRes.contextPackageId).toBeDefined()

    // Wait for stream to finish
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (doneEvent) {
          clearInterval(interval)
          resolve()
        }
      }, 50)
    })

    expect(deltas.length).toBeGreaterThan(0)
    expect(doneEvent?.state).toBe('completed')
    expect(doneEvent?.message?.content).toBe('根据[来源1]所述，韩立离开五里沟拜入七玄门。同时[设定:掌天瓶]是仙家法宝，可催熟草药。')
    expect(doneEvent?.message?.tokenCount).toBe(165)

    // Check citations
    expect(doneEvent?.message?.citations).toBeDefined()
    expect(doneEvent?.message?.citations?.length).toBeGreaterThan(0)
    const chapCitation = doneEvent?.message?.citations?.find((c) => c.title.includes('第一章') || c.sourceType === 'retrieved_chunk')
    expect(chapCitation).toBeDefined()

    // Check message list in store
    const messages = chatService.listMessages({ sessionId, chatSessionId: session.id })
    expect(messages.length).toBe(2) // 1 user + 1 assistant
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('韩立来自哪里？他的掌天瓶有什么用？')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe(doneEvent?.message?.content)
    expect(messages[1].state).toBe('completed')
  })

  it('3. should support rolling summary compaction and preserve author edits', async () => {
    const session = chatService.createSession({ sessionId, title: '长会话测试', connectionId: connId })

    // Mock summary completion response
    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"- 韩立离开五里沟拜入七玄门\\\\n- 获得了神秘绿色小瓶掌天瓶"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    // Insert 14 messages (7 rounds)
    store.transaction(sessionId, (db) => {
      for (let i = 1; i <= 14; i++) {
        const role = i % 2 === 1 ? 'user' : 'assistant'
        db.prepare(`
          INSERT INTO chat_message(id, chat_session_id, role, content, state, created_at)
          VALUES (?, ?, ?, ?, 'completed', ?)
        `).run(randomUUID(), session.id, role, `对话消息 ${i}`, Date.now() + i * 100)
      }
    })

    // 1. Trigger rolling compaction
    const summary = await chatService.compactSession(sessionId, session.id, connId)
    expect(summary.id).toBeDefined()
    expect(summary.content).toContain('韩立离开五里沟')
    expect(summary.authorEdited).toBe(false)
    expect(summary.version).toBe(1)

    // 2. Author manually edits the summary (SPEC 6.8)
    const updatedSummary = chatService.updateSummary({
      sessionId,
      summaryId: summary.id,
      content: '【作者重要设定修订】韩立出生于五里沟贫寒农家，小瓶命名为掌天瓶。',
      expectedVersion: 1
    })
    expect(updatedSummary.authorEdited).toBe(true)
    expect(updatedSummary.version).toBe(2)
    expect(updatedSummary.content).toContain('【作者重要设定修订】')

    // 3. Trigger compaction again and verify author edits are PRESERVED and not overwritten
    const secondSummary = await chatService.compactSession(sessionId, session.id, connId)
    expect(secondSummary.version).toBe(3)
    expect(secondSummary.authorEdited).toBe(true)
    expect(secondSummary.content).toContain('【作者重要设定修订】')
    expect(secondSummary.content).toContain('【最新滚动摘要】')
  })

  it('4. should cancel streaming chat and update state to cancelled', async () => {
    const session = chatService.createSession({ sessionId, title: '取消测试', connectionId: connId })

    // Long streaming mock
    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"正在推导极长"}}]}\n\n')
      // Hang without finishing until aborted
    }

    let doneEvent: ChatDoneEvent | undefined
    chatService.setCallbacks({
      onDone: (ev) => {
        doneEvent = ev
      }
    })

    await chatService.sendMessage({
      sessionId,
      chatSessionId: session.id,
      content: '请详细推导所有修仙境界'
    })

    // Verify the latest partial output survives the checkpoint interval.
    await new Promise((r) => setTimeout(r, 1050))
    expect(chatService.listMessages({ sessionId, chatSessionId: session.id })[1].content).toContain('正在推导极长')

    // Cancel after the checkpoint
    chatService.cancelChat(sessionId, session.id)

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (doneEvent) {
          clearInterval(interval)
          resolve()
        }
      }, 50)
    })

    expect(doneEvent?.state).toBe('cancelled')
    const messages = chatService.listMessages({ sessionId, chatSessionId: session.id })
    expect(messages[1].state).toBe('cancelled')
  })

  it('5. should guarantee strict data isolation: chat NEVER modifies chapters or knowledge author content', async () => {
    const session = chatService.createSession({ sessionId, title: '隔离测试', connectionId: connId })

    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"我已经帮你修改了第一章正文并将韩立改名为厉飞雨。"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }

    let doneEvent: ChatDoneEvent | undefined
    chatService.setCallbacks({
      onDone: (ev) => {
        doneEvent = ev
      }
    })

    // Record chapter and knowledge states before chat
    const chapListBefore = chapters.list(sessionId)
    const chapBefore = chapters.get(sessionId, chapListBefore[0].id)
    const knowListBefore = knowledges.listEntries(sessionId)
    const knowBefore = knowledges.getEntry(sessionId, knowListBefore[0].id)

    await chatService.sendMessage({
      sessionId,
      chatSessionId: session.id,
      content: '请修改正文内容'
    })

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (doneEvent) {
          clearInterval(interval)
          resolve()
        }
      }, 50)
    })

    // Verify chapter content and version are 100% UNCHANGED
    const chapAfter = chapters.get(sessionId, chapListBefore[0].id)
    expect(chapAfter.version).toBe(chapBefore.version)
    expect(chapAfter.content).toBe(chapBefore.content)

    // Verify knowledge entry content and version are 100% UNCHANGED
    const knowAfter = knowledges.getEntry(sessionId, knowListBefore[0].id)
    expect(knowAfter.version).toBe(knowBefore.version)
    expect(knowAfter.authorContent).toBe(knowBefore.authorContent)
  })

  it('6. should cleanly handle project closure during active streaming chat with 0 unhandled rejections', async () => {
    const session = chatService.createSession({ sessionId, title: '关闭中断测试', connectionId: connId })

    requestHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: {"choices":[{"delta":{"content":"正在回答第"}}]}\n\n')
      // Stream remains open
    }

    const unhandledRejections: unknown[] = []
    const rejectionHandler = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', rejectionHandler)

    try {
      await chatService.sendMessage({
        sessionId,
        chatSessionId: session.id,
        content: '请问主角是谁？'
      })
      await new Promise((r) => setTimeout(r, 40))
      // Close project midway through streaming
      store.close(sessionId)
      await new Promise((r) => setTimeout(r, 100))
      expect(unhandledRejections).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', rejectionHandler)
    }
  })
})
