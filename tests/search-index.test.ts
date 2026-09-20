import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'

describe('SearchIndex & Lifecycle', () => {
  let tempDir: string
  let store: ProjectStore
  let searchIndex: SearchIndex
  let chapters: ChapterRepository
  let sessionId: string
  let projectPath: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-search-test-'))
    store = new ProjectStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)

    projectPath = join(tempDir, 'test-book.novelproj')
    store.create({ destination: projectPath, title: '诛仙测试录', description: '测试项目' }, [
      { title: '第一章 草庙村变故', content: '草庙村依山而建，村民向来淳朴。一日夜里，风雨大作，普智大师与黑衣人在村头激战。普智传授张小凡大梵般若。' },
      { title: '第二章 青云门入门', content: '青云门屹立于神州浩土，通天峰大殿之上，道玄真人仙风道骨。田不易将张小凡领回大竹峰。' },
      { title: '第三章 大竹峰砍竹', content: '张小凡每日在后山砍伐黑节竹。田灵儿师姐常带他御剑飞行。张小凡在幽谷中偶遇噬魂棒与嗜血珠。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId
    await searchIndex.sync(sessionId)
  })

  afterEach(async () => {
    try {
      await store.closeAll()
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('initializes index in current state on project creation', () => {
    const status = searchIndex.getStatus(sessionId)
    expect(status.state).toBe('current')
    expect(status.searchRevision).toBeGreaterThanOrEqual(1)
    expect(status.indexedRevision).toBe(status.searchRevision)
    expect(status.lastError).toBeNull()
  })

  it('performs FTS5 trigram search for queries with 3 or more Chinese characters', () => {
    const results = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '通天峰'
    })

    expect(results.length).toBe(1)
    expect(results[0].sourceType).toBe('chapter_chunk')
    expect(results[0].title).toBe('第二章 青云门入门')
    expect(results[0].excerpt).toContain('通天峰')
    expect(results[0].highlightOffsets.length).toBeGreaterThan(0)
    expect(results[0].target.chapterId).toBeDefined()
    expect(results[0].target.offset).toBeGreaterThan(0)
  })

  it('performs parameterized LIKE search for short queries (< 3 chars)', () => {
    // 1-character query
    const singleChar = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '竹'
    })
    expect(singleChar.length).toBeGreaterThanOrEqual(1)
    expect(singleChar.some((r) => r.title.includes('大竹峰'))).toBe(true)

    // 2-character query
    const twoChars = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '张小'
    })
    expect(twoChars.length).toBeGreaterThanOrEqual(1)
    for (const res of twoChars) {
      expect(res.excerpt).toContain('张小')
      expect(res.highlightOffsets.length).toBeGreaterThan(0)
    }
  })

  it('searches across multiple sources: chapter_chunk, creative_rules, style_sample, knowledge_entry', async () => {
    // 1. Add creative rules
    store.transaction(sessionId, (db) => {
      db.prepare("UPDATE project_meta SET creative_rules = '世界观设定：仙道门派以太极玄清道为正统，魔门修罗之道。', search_revision = search_revision + 1").run()
    })

    // 2. Add style sample
    store.transaction(sessionId, (db) => {
      db.prepare("INSERT INTO style_sample(id, name, content, tags_json, version, created_at, updated_at) VALUES ('sample-1', '斗法描写', '剑光如霜雪倒悬，九天玄刹化为神雷。', '[]', 1, 1000, 1000)").run()
      db.prepare("UPDATE project_meta SET search_revision = search_revision + 1").run()
    })

    // 3. Add knowledge entry
    store.transaction(sessionId, (db) => {
      db.prepare("INSERT INTO knowledge_entry(id, knowledge_kind, title, author_content, version, state, created_at, updated_at) VALUES ('entry-1', 'character', '碧瑶', '鬼王宗宗主之女，身着水绿衣衫，性情孤傲。', 1, 'active', 1000, 1000)").run()
      db.prepare("UPDATE project_meta SET search_revision = search_revision + 1").run()
    })

    // Sync index
    await searchIndex.sync(sessionId)

    // Query creative rules
    const ruleResults = searchIndex.searchKeyword(sessionId, { sessionId, query: '太极玄清道' })
    expect(ruleResults.some((r) => r.sourceType === 'creative_rules')).toBe(true)

    // Query style sample
    const sampleResults = searchIndex.searchKeyword(sessionId, { sessionId, query: '九天玄刹' })
    expect(sampleResults.some((r) => r.sourceType === 'style_sample' && r.title === '斗法描写')).toBe(true)

    // Query knowledge entry
    const knowledgeResults = searchIndex.searchKeyword(sessionId, { sessionId, query: '鬼王宗' })
    expect(knowledgeResults.some((r) => r.sourceType === 'knowledge_entry' && r.title === '碧瑶')).toBe(true)
  })

  it('deduplicates multiple chunk matches in the same chapter to the highest scoring result', async () => {
    const list = chapters.list(sessionId)
    const chap = list[0]
    // Update chapter with repetitive keywords spanning multiple chunks
    const longContent = '张小凡手持烧火棍，凝神戒备。\n\n'.repeat(60) // ~1000+ chars
    chapters.update(sessionId, chap.id, longContent, chap.version)

    await searchIndex.sync(sessionId)

    const results = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '烧火棍'
    })

    // Must deduplicate by chapter: only 1 entry for this chapter
    const matchingChapResults = results.filter((r) => r.sourceId === chap.id)
    expect(matchingChapResults).toHaveLength(1)
  })

  it('filters search results by sourceTypes and chapterIds', async () => {
    const list = chapters.list(sessionId)
    const chap1 = list[0]
    const chap2 = list[1]

    // Search with chapterIds filter
    const filteredByChap = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '张小凡',
      filters: {
        chapterIds: [chap1.id]
      }
    })
    for (const item of filteredByChap) {
      if (item.sourceType === 'chapter_chunk') {
        expect(item.target.chapterId).toBe(chap1.id)
      }
    }

    // Search with sourceTypes filter
    const filteredByType = searchIndex.searchKeyword(sessionId, {
      sessionId,
      query: '张小凡',
      filters: {
        sourceTypes: ['creative_rules']
      }
    })
    expect(filteredByType.every((r) => r.sourceType === 'creative_rules')).toBe(true)
  })

  it('tracks search_revision and advances indexed_revision automatically after chapter mutations', async () => {
    const initialStatus = searchIndex.getStatus(sessionId)
    const list = chapters.list(sessionId)
    const chap = list[0]

    chapters.update(sessionId, chap.id, '全新修改的草庙村正文内容，普智大师留下三日之约。', chap.version)

    // Wait for background sync
    await searchIndex.sync(sessionId)

    const updatedStatus = searchIndex.getStatus(sessionId)
    expect(updatedStatus.searchRevision).toBeGreaterThan(initialStatus.searchRevision)
    expect(updatedStatus.indexedRevision).toBe(updatedStatus.searchRevision)
    expect(updatedStatus.state).toBe('current')

    // Search matches new content immediately
    const res = searchIndex.searchKeyword(sessionId, { sessionId, query: '三日之约' })
    expect(res.length).toBe(1)
  })

  it('detects revision gap as needs_rebuild after simulated crash between author write and index update', async () => {
    // Simulate crash: author transaction commits and bumps search_revision, but index is not synced
    store.transaction(sessionId, (db) => {
      db.prepare('UPDATE chapter SET content = ? WHERE position = 0').run('模拟崩溃断电时写入的正文：七脉会武在即。')
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1').run()
    })

    const statusBefore = searchIndex.getStatus(sessionId)
    expect(statusBefore.state).toBe('needs_rebuild')
    expect(statusBefore.searchRevision).toBeGreaterThan(statusBefore.indexedRevision)

    // Execute rebuild
    const rebuildResult = await searchIndex.rebuild(sessionId)
    expect(rebuildResult.success).toBe(true)
    expect(rebuildResult.indexedRevision).toBe(rebuildResult.searchRevision)

    const statusAfter = searchIndex.getStatus(sessionId)
    expect(statusAfter.state).toBe('current')
    expect(statusAfter.searchRevision).toBe(statusAfter.indexedRevision)

    // Search matches the rebuilt content
    const res = searchIndex.searchKeyword(sessionId, { sessionId, query: '七脉会武' })
    expect(res.length).toBe(1)
  })

  it('meets < 300ms performance baseline for 100k+ Chinese characters corpus', async () => {
    const longChapters = []
    const baseText = '神州浩土，广瀚无边。唯有中原大地，最是丰美肥沃，天下十人居其八九。中原之外，蛮荒险恶，多有猛兽毒虫，恶水穷山。'
    for (let i = 0; i < 50; i++) {
      longChapters.push({
        title: `第 ${i + 1} 卷 修行纪事`,
        content: baseText.repeat(25) + `【卷末标号：星宿海奇谭第${i}篇】` // ~2000 chars per chapter = ~100k chars total
      })
    }

    const largeProjPath = join(tempDir, 'large-book.novelproj')
    store.create({ destination: largeProjPath, title: '百万字大书', description: '性能压测' }, longChapters)

    const largeOpened = await store.open(largeProjPath)
    await searchIndex.sync(largeOpened.sessionId)
    const start = performance.now()
    const searchRes = searchIndex.searchKeyword(largeOpened.sessionId, {
      sessionId: largeOpened.sessionId,
      query: '星宿海奇谭'
    })
    const duration = performance.now() - start

    expect(searchRes.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(300) // Less than 300ms baseline!
  })
})
