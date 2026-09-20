import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ContextAssembler } from '../src/main/context-assembler'
import { DEFAULT_STAGE_PROMPT_SLOTS, getDefaultStagePromptSlots } from '../src/main/default-presets'

describe('T05: Stage Prompt Slots & Built-in Presets', () => {
  let tempDir: string
  let store: ProjectStore
  let connStore: ConnectionStore
  let searchIndex: SearchIndex
  let chapterRepo: ChapterRepository
  let contextAssembler: ContextAssembler
  let sessionId: string
  let connId: string
  let chapterId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-stage-slots-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    contextAssembler = new ContextAssembler(store, searchIndex, connStore)

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

    const projectPath = join(tempDir, 'test-stage-slots.novelproj')
    store.create({ destination: projectPath, title: '测试作品', description: '测试' }, [
      {
        title: '第一章 序幕',
        content: '黑夜降临在寂静的城池之上。'
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

  it('has built-in DEFAULT_STAGE_PROMPT_SLOTS and helper filters by stage correctly', () => {
    expect(DEFAULT_STAGE_PROMPT_SLOTS.length).toBeGreaterThanOrEqual(6)

    const directionSlots = getDefaultStagePromptSlots('direction')
    expect(directionSlots.some((s) => s.id === 'slot-stage-direction')).toBe(true)
    expect(directionSlots.some((s) => s.id === 'slot-stage-chapter-outline')).toBe(false)
    expect(directionSlots.some((s) => s.id === 'slot-stage-content')).toBe(false)

    const outlineSlots = getDefaultStagePromptSlots('chapter_outline')
    expect(outlineSlots.some((s) => s.id === 'slot-stage-chapter-outline')).toBe(true)
    expect(outlineSlots.some((s) => s.id === 'slot-stage-direction')).toBe(false)

    const contentSlots = getDefaultStagePromptSlots('content')
    expect(contentSlots.some((s) => s.id === 'slot-stage-content')).toBe(true)
    expect(contentSlots.some((s) => s.id === 'slot-limited-pov')).toBe(true)
  })

  it('assembles context honoring stage trigger slots in chat task', async () => {
    // 1. direction stage
    const pkgDirection = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'direction',
      instruction: '请梳理本章方向',
      target: { chapterId }
    })

    const dirUserMsg = pkgDirection.userMessage
    expect(dirUserMsg).toContain('【阶段任务：方向确认】')
    expect(dirUserMsg).toContain('阶段输出协议：方向确认')
    expect(dirUserMsg).not.toContain('阶段输出协议：章大纲规划')
    expect(dirUserMsg).not.toContain('阶段输出协议：正文候选')

    // 2. chapter_outline stage
    const pkgOutline = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'chapter_outline',
      instruction: '请规划章大纲',
      target: { chapterId }
    })
    expect(pkgOutline.userMessage).toContain('【阶段任务：章大纲规划】')
    expect(pkgOutline.userMessage).toContain('阶段输出协议：章大纲规划')
    expect(pkgOutline.userMessage).not.toContain('阶段输出协议：方向确认')

    // 3. content stage
    const pkgContent = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'content',
      instruction: '请生成正文',
      target: { chapterId }
    })
    expect(pkgContent.userMessage).toContain('【阶段任务：正文生成】')
    expect(pkgContent.userMessage).toContain('阶段输出协议：正文生成')
  })

  it('produces different configuration fingerprints across different stages', async () => {
    const pkg1 = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'direction',
      instruction: '规划',
      target: { chapterId }
    })

    const pkg2 = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'chapter_outline',
      instruction: '规划',
      target: { chapterId }
    })

    expect(pkg1.configurationFingerprint).not.toBe(pkg2.configurationFingerprint)
  })
})
