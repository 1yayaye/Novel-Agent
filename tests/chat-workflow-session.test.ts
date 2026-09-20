import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { ChatService } from '../src/main/chat-service'

describe('T04: Chat Workflow Session Metadata & State Transitions', () => {
  let tempDir: string
  let store: ProjectStore
  let connStore: ConnectionStore
  let searchIndex: SearchIndex
  let chapterRepo: ChapterRepository
  let contextAssembler: ContextAssembler
  let chatService: ChatService
  let sessionId: string
  let connId: string
  let chapterId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-chat-workflow-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connStore)
    // chatService with minimal gateway mock for session management
    chatService = new ChatService(store, {} as any, connStore, contextAssembler, searchIndex)

    const conn = connStore.create({
      name: 'Test LLM',
      kind: 'generation',
      isLocalService: true,
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'gpt-4o',
      contextWindow: 16000,
      maxOutputTokens: 2000
    })
    connId = conn.id
    connStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-chat-wf.novelproj')
    store.create({ destination: projectPath, title: '测试作品', description: '测试' }, [
      {
        title: '第一章 初入江湖',
        content: '少年提剑走入漫天风雪。'
      }
    ])
    const session = await store.open(projectPath)
    sessionId = session.sessionId
    const chaps = chapterRepo.list(sessionId)
    chapterId = chaps[0].id
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('creates free_chat session with default metadata', () => {
    const session = chatService.createSession({
      sessionId,
      title: '自由问答会话',
      connectionId: connId
    })

    expect(session.id).toBeDefined()
    expect(session.title).toBe('自由问答会话')
    expect(session.workflowType).toBe('free_chat')
    expect(session.stage).toBeNull()
    expect(session.targetChapterId).toBeNull()
    expect(session.version).toBe(1)

    const fetched = chatService.getSession({ sessionId, chatSessionId: session.id })
    expect(fetched.workflowType).toBe('free_chat')
    expect(fetched.stage).toBeNull()
  })

  it('creates creation_workflow session defaulting to direction stage', () => {
    const session = chatService.createSession({
      sessionId,
      title: '第一章 创作会话',
      workflowType: 'creation_workflow',
      targetChapterId: chapterId,
      connectionId: connId
    })

    expect(session.workflowType).toBe('creation_workflow')
    expect(session.stage).toBe('direction')
    expect(session.targetChapterId).toBe(chapterId)
    expect(session.version).toBe(1)
  })

  it('rejects creation session with non-existent targetChapterId', () => {
    expect(() => {
      chatService.createSession({
        sessionId,
        workflowType: 'creation_workflow',
        targetChapterId: '11111111-1111-1111-1111-111111111111',
        connectionId: connId
      })
    }).toThrow('目标章节不存在')
  })

  it('handles valid sequential state transitions: direction -> chapter_outline -> content -> reviewed', () => {
    const session = chatService.createSession({
      sessionId,
      workflowType: 'creation_workflow',
      targetChapterId: chapterId
    })
    expect(session.stage).toBe('direction')

    // direction -> chapter_outline
    const stage2 = chatService.updateStage({
      sessionId,
      chatSessionId: session.id,
      stage: 'chapter_outline',
      expectedVersion: 1
    })
    expect(stage2.stage).toBe('chapter_outline')
    expect(stage2.version).toBe(2)

    // chapter_outline -> content
    const stage3 = chatService.updateStage({
      sessionId,
      chatSessionId: session.id,
      stage: 'content',
      expectedVersion: 2
    })
    expect(stage3.stage).toBe('content')
    expect(stage3.version).toBe(3)

    // content -> reviewed
    const stage4 = chatService.updateStage({
      sessionId,
      chatSessionId: session.id,
      stage: 'reviewed',
      expectedVersion: 3
    })
    expect(stage4.stage).toBe('reviewed')
    expect(stage4.version).toBe(4)

    // reviewed -> content (rollback)
    const stage5 = chatService.updateStage({
      sessionId,
      chatSessionId: session.id,
      stage: 'content',
      expectedVersion: 4
    })
    expect(stage5.stage).toBe('content')
    expect(stage5.version).toBe(5)
  })

  it('rejects invalid state skip transitions (e.g. direction -> content, direction -> reviewed)', () => {
    const session = chatService.createSession({
      sessionId,
      workflowType: 'creation_workflow',
      targetChapterId: chapterId
    })

    expect(() => {
      chatService.updateStage({
        sessionId,
        chatSessionId: session.id,
        stage: 'content',
        expectedVersion: 1
      })
    }).toThrow('非法的创作阶段转换')

    expect(() => {
      chatService.updateStage({
        sessionId,
        chatSessionId: session.id,
        stage: 'reviewed',
        expectedVersion: 1
      })
    }).toThrow('非法的创作阶段转换')
  })

  it('rejects stage transition on free_chat session', () => {
    const session = chatService.createSession({
      sessionId,
      workflowType: 'free_chat'
    })

    expect(() => {
      chatService.updateStage({
        sessionId,
        chatSessionId: session.id,
        stage: 'chapter_outline',
        expectedVersion: 1
      })
    }).toThrow('普通问答会话无法转换创作阶段')
  })

  it('enforces optimistic locking version check on updateStage', () => {
    const session = chatService.createSession({
      sessionId,
      workflowType: 'creation_workflow',
      targetChapterId: chapterId
    })

    expect(() => {
      chatService.updateStage({
        sessionId,
        chatSessionId: session.id,
        stage: 'chapter_outline',
        expectedVersion: 99
      })
    }).toThrow('会话已被修改')
  })

  it('lists sessions with complete workflow metadata', () => {
    chatService.createSession({
      sessionId,
      title: '会话1',
      workflowType: 'free_chat'
    })
    chatService.createSession({
      sessionId,
      title: '会话2',
      workflowType: 'creation_workflow',
      targetChapterId: chapterId
    })

    const list = chatService.listSessions({ sessionId })
    expect(list.length).toBe(2)
    const creationSession = list.find((s) => s.workflowType === 'creation_workflow')
    expect(creationSession).toBeDefined()
    expect(creationSession?.stage).toBe('direction')
    expect(creationSession?.targetChapterId).toBe(chapterId)
  })
})
