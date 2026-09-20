import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ContextAssembler, expandMacros } from '../src/main/context-assembler'

describe('T06: Outline & Stage Context Assembly', () => {
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
    tempDir = mkdtempSync(join(tmpdir(), 'novel-outline-ctx-test-'))
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

    const projectPath = join(tempDir, 'test-outline-ctx.novelproj')
    store.create({ destination: projectPath, title: '大纲测试作品', description: '测试' }, [
      {
        title: '第一章 破晓之战',
        content: '第一段：夜幕低垂，寒风呼啸。\n\n第二段：城墙上火把猎猎作响。'
      }
    ])
    const session = await store.open(projectPath)
    sessionId = session.sessionId
    const chaps = chapterRepo.list(sessionId)
    chapterId = chaps[0].id

    // Seed 3-layer outlines in database
    store.transaction(sessionId, (db) => {
      const now = Date.now()
      // 1. Book Outline
      db.prepare(`
        INSERT INTO book_outline(id, content, version, state, created_at, updated_at)
        VALUES ('book-outline-1', '全书分为三大篇章，讲述少年成长的传奇历程。', 1, 'confirmed', ?, ?)
      `).run(now, now)

      // 2. Volume Outline
      db.prepare(`
        INSERT INTO volume_outline(id, title, position, content, version, state, created_at, updated_at)
        VALUES ('volume-outline-1', '第一卷：边陲风云', 1, '第一卷聚焦边陲要塞的防守与暗流涌动。', 1, 'confirmed', ?, ?)
      `).run(now, now)

      // 3. Chapter Outline
      db.prepare(`
        INSERT INTO chapter_outline(id, chapter_id, volume_id, chapter_version, content, version, state, created_at, updated_at)
        VALUES ('chapter-outline-1', ?, 'volume-outline-1', 1, '【本章目标】：确立冲突与危机\n【场景节拍】：1. 哨塔预警；2. 敌军突袭', 1, 'confirmed', ?, ?)
      `).run(chapterId, now, now)
    })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('expands outline macros in expandMacros', () => {
    const warnings: string[] = []
    const template = '全书：{{book_outline}}\n分卷：{{volume_outline}}\n本章：{{chapter_outline}}'
    const result = expandMacros(
      template,
      {
        bookOutline: '全书宏伟主线',
        volumeOutline: '第一卷崛起',
        chapterOutline: '第一章破晓',
        store,
        sessionId
      },
      warnings
    )

    expect(result).toBe('全书：全书宏伟主线\n分卷：第一卷崛起\n本章：第一章破晓')
  })

  it('assembles 3-layer outlines into Priority Tier 9 ContextItems', async () => {
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'content',
      instruction: '请基于大纲创作',
      target: { chapterId }
    })

    const outlineItems = pkg.items.filter(
      (i) =>
        i.sourceType === 'book_outline' ||
        i.sourceType === 'volume_outline' ||
        i.sourceType === 'chapter_outline'
    )

    expect(outlineItems.length).toBe(3)
    const bookItem = outlineItems.find((i) => i.sourceType === 'book_outline')
    const volItem = outlineItems.find((i) => i.sourceType === 'volume_outline')
    const chapItem = outlineItems.find((i) => i.sourceType === 'chapter_outline')

    expect(bookItem?.content).toContain('全书分为三大篇章')
    expect(volItem?.content).toContain('第一卷聚焦边陲要塞')
    expect(chapItem?.content).toContain('【本章目标】：确立冲突与危机')

    expect(pkg.userMessage).toContain('【项目大纲规划】')
    expect(pkg.userMessage).toContain('全书大纲')
    expect(pkg.userMessage).toContain('分卷大纲（第一卷：边陲风云）')
    expect(pkg.userMessage).toContain('章大纲（第一章 破晓之战）')
  })

  it('verifies context package freshness and detects stale outline version or state', async () => {
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'content',
      instruction: '请基于大纲创作',
      target: { chapterId }
    })

    // Fresh verification should pass
    const verified = contextAssembler.verifyContextPackage(sessionId, pkg.id)
    expect(verified.id).toBe(pkg.id)

    // Modify chapter outline version in DB -> marks it stale
    store.transaction(sessionId, (db) => {
      db.prepare("UPDATE chapter_outline SET version = 2, content = '修改后的大纲' WHERE id = 'chapter-outline-1'").run()
    })

    expect(() => {
      contextAssembler.verifyContextPackage(sessionId, pkg.id)
    }).toThrow('关联章大纲已发生更新或已过时')
  })

  it('detects stale context package when outline state is marked stale', async () => {
    const pkg = await contextAssembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'chat',
      stage: 'direction',
      instruction: '方向确认',
      target: { chapterId }
    })

    // Fresh verification
    expect(contextAssembler.verifyContextPackage(sessionId, pkg.id)).toBeDefined()

    // Mark book outline state as stale
    store.transaction(sessionId, (db) => {
      db.prepare("UPDATE book_outline SET state = 'stale' WHERE id = 'book-outline-1'").run()
    })

    expect(() => {
      contextAssembler.verifyContextPackage(sessionId, pkg.id)
    }).toThrow('全书大纲已发生更新或已过时')
  })
})
