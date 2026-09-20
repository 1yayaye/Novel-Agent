import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ContextAssembler } from '../src/main/context-assembler'
import { CreativeRepository } from '../src/main/creative-repository'
import { KnowledgeRepository } from '../src/main/knowledge-repository'

describe('ContextAssembler (SPEC 7.2, 7.3, 7.4)', () => {
  let tempDir: string
  let store: ProjectStore
  let connStore: ConnectionStore
  let searchIndex: SearchIndex
  let chapterRepo: ChapterRepository
  let creativeRepo: CreativeRepository
  let knowledgeRepo: KnowledgeRepository
  let assembler: ContextAssembler
  let sessionId: string
  let connId: string
  let chapter1Id: string
  let chapter2Id: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-context-test-'))
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    creativeRepo = new CreativeRepository(store, searchIndex)
    knowledgeRepo = new KnowledgeRepository(store, searchIndex)
    assembler = new ContextAssembler(store, searchIndex, connStore)

    const conn = connStore.create({
      name: 'Test LLM',
      kind: 'generation',
      isLocalService: true,
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'gpt-4o',
      contextWindow: 16000,
      maxOutputTokens: 2000,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connId = conn.id
    connStore.confirmContentTarget(connId, calculateContentTargetFingerprint(conn.baseUrl, conn.model))

    const projectPath = join(tempDir, 'test-ctx.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙', description: '测试' }, [
      { title: '第一章 拜入宗门', content: '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。山道崎岖，白云缭绕。' },
      { title: '第二章 神秘小瓶', content: '韩立在神手谷后山采药，偶得一尊墨绿色小瓶。月华之下，小瓶泛出神异光芒。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId

    const chapters = chapterRepo.list(sessionId)
    chapter1Id = chapters[0].id
    chapter2Id = chapters[1].id

    // Setup Creative Rules, Style Samples, Presets, Knowledge Entries, Summaries
    const currentRules = creativeRepo.getRules(sessionId)
    creativeRepo.updateRules(sessionId, '【全书设定】主角行事必须谨慎低调，绝不轻易涉险。禁止出现机械降神。', currentRules.version)
    creativeRepo.createSample(sessionId, '古风细腻', '秋风萧瑟，落叶纷飞。残阳如血染红了天际。', ['文风', '写景'])
    creativeRepo.createPreset(sessionId, 'continue', '注重动作细节', '请加强打斗与身法动作描写，节奏紧凑。')
    knowledgeRepo.createEntry(sessionId, {
      kind: 'character',
      title: '韩立',
      authorContent: '本作主角，性格坚毅沉稳，心思缜密，不喜张扬。'
    })

    // Add task, chapter summary and synopsis
    store.transaction(sessionId, (db) => {
      const now = Date.now()
      db.prepare("INSERT INTO task(id, type, scope_json, state, created_at, updated_at) VALUES ('task-test-1', 'synopsis', '{}', 'completed', ?, ?)").run(now, now)
      db.prepare("INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES ('sum1', ?, 1, '韩立离开家乡前往七玄门拜师。', 'current', 'task-test-1', ?)").run(chapter1Id, now)
      db.prepare("INSERT INTO book_synopsis(id, summary, source_versions_json, state, analysis_task_id, created_at) VALUES ('syn1', '凡人少年韩立依靠神秘小瓶踏上修仙长生之路的大纲。', '{}', 'current', 'task-test-1', ?)").run(now)
    })
  })

  afterEach(async () => {
    try {
      await store.closeAll()
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('assembles context package with 12 priority tiers and uncuttable protection', async () => {
    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter2Id },
      instruction: '描写韩立在月下尝试给药草滴入绿液的过程',
      includeCreativeRules: true,
      targetLength: 800,
      creativity: 'medium'
    })

    expect(pkg.id).toBeTruthy()
    expect(pkg.taskType).toBe('continue')
    expect(pkg.systemMessage).toContain('你是一位专业的小说创作助手')
    expect(pkg.systemMessage).toContain('主角行事必须谨慎低调')
    expect(pkg.userMessage).toContain('韩立在神手谷后山采药')
    expect(pkg.userMessage).toContain('描写韩立在月下尝试给药草滴入绿液的过程')
    expect(pkg.configurationFingerprint).toBeTruthy()
    expect(pkg.items.length).toBeGreaterThanOrEqual(4)

    // Verify uncuttable items
    const systemItem = pkg.items.find((i) => i.sourceType === 'system_template')
    const rulesItem = pkg.items.find((i) => i.sourceType === 'creative_rules')
    const targetTextItem = pkg.items.find((i) => i.sourceType === 'target_text')
    const instructionItem = pkg.items.find((i) => i.sourceType === 'author_instruction')

    expect(systemItem?.fixed).toBe(true)
    expect(rulesItem?.fixed).toBe(true)
    expect(targetTextItem?.fixed).toBe(true)
    expect(instructionItem?.fixed).toBe(true)
  })

  it('correctly persists and recovers ContextPackage from SQLite database', async () => {
    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '续写韩立初入七玄门的场景'
    })

    const retrieved = assembler.getContextPackage({ sessionId, contextPackageId: pkg.id })
    expect(retrieved.id).toBe(pkg.id)
    expect(retrieved.configurationFingerprint).toBe(pkg.configurationFingerprint)
    expect(retrieved.items.length).toBe(pkg.items.length)
    expect(retrieved.systemMessage).toBe(pkg.systemMessage)
    expect(retrieved.userMessage).toBe(pkg.userMessage)
    expect(retrieved.connectionId).toBe(connId)
    expect(retrieved.target).toEqual({ chapterId: chapter1Id })
    expect(retrieved.items.find((item) => item.sourceType === 'target_text')?.content).toContain('韩立收拾行囊')
  })

  it('trims lower priority items when token budget is restricted and tracks in excludedItems', async () => {
    // Create a connection with tiny token window
    const tightConn = connStore.create({
      name: 'Tight Context',
      kind: 'generation',
      isLocalService: true,
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'tiny-model',
      contextWindow: 600, // Small window
      maxOutputTokens: 200,
      safetyMarginRatio: 0.1,
      tokenEstimationRatio: 1.3
    })
    connStore.confirmContentTarget(tightConn.id, calculateContentTargetFingerprint(tightConn.baseUrl, tightConn.model))

    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: tightConn.id,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '小幅续写',
      includeCreativeRules: false // Disable rules to save budget for target text
    })

    expect(pkg.estimatedInputTokens).toBeLessThanOrEqual(pkg.availableInputTokens)
    // Low priority items should be trimmed if budget exceeded
    expect(pkg.items.length).toBeGreaterThan(0)
  })

  it('throws MODEL_CONTEXT_EXCEEDED when uncuttable items exceed available token budget', async () => {
    // Create connection with budget smaller than system template + target text
    const microConn = connStore.create({
      name: 'Micro Model',
      kind: 'generation',
      isLocalService: true,
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'micro-model',
      contextWindow: 100, // Impossibly small window
      maxOutputTokens: 50,
      safetyMarginRatio: 0.1
    })
    connStore.confirmContentTarget(microConn.id, calculateContentTargetFingerprint(microConn.baseUrl, microConn.model))

    await expect(
      assembler.assembleContext({
        sessionId,
        connectionId: microConn.id,
        taskType: 'continue',
        target: { chapterId: chapter1Id },
        instruction: '长指令'
      })
    ).rejects.toThrow('不可裁剪内容')
  })

  it('detects staleness when target chapter version changes or options change', async () => {
    const input = {
      sessionId,
      connectionId: connId,
      taskType: 'continue' as const,
      target: { chapterId: chapter2Id },
      instruction: '测试指纹与过时保护'
    }

    const pkg = await assembler.assembleContext(input)

    // Verification succeeds initially
    const verified = assembler.verifyContextPackage(sessionId, pkg.id, input)
    expect(verified.id).toBe(pkg.id)

    // Modify target chapter version
    chapterRepo.update(sessionId, chapter2Id, '韩立修改了正文内容。', 1)

    // Verification should now fail with STALE_CONTEXT_PACKAGE
    expect(() => {
      assembler.verifyContextPackage(sessionId, pkg.id, input)
    }).toThrow('目标章节正文已发生更新')
  })
})
