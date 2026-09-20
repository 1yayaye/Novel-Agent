import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { KnowledgeRepository } from '../src/main/knowledge-repository'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'

const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-knowledge-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  store.create({ destination: project, title: '测试作品', description: '测试描述' }, [
    { title: '第一章', content: '林萧握紧了手中的断云剑，眼神坚定。' }
  ])
  const searchIndex = new SearchIndex(store)
  const chapters = new ChapterRepository(store, searchIndex)
  const repository = new KnowledgeRepository(store, searchIndex)
  return { folder, project, store, searchIndex, chapters, repository }
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('KnowledgeRepository - Knowledge Entries & State Transitions', () => {
  it('creates, edits, archives, restores and searches knowledge entries across 4 kinds', async () => {
    const { project, store, repository, searchIndex } = fixture()
    const opened = await store.open(project)

    // 1. Character entry
    const char = repository.createEntry(opened.sessionId, {
      kind: 'character',
      title: '林萧',
      aliases: ['萧儿', '剑痴'],
      authorContent: '青云门外门弟子，性格坚毅沉稳，手持断云古剑。',
      tags: ['主角', '剑客'],
      identity: '青云门弟子',
      currentState: '练气期九层'
    })
    expect(char.id).toBeDefined()
    expect(char.knowledgeKind).toBe('character')
    expect(char.title).toBe('林萧')
    expect(char.aliases).toEqual(['萧儿', '剑痴'])
    expect(char.identity).toBe('青云门弟子')
    expect(char.state).toBe('active')
    expect(char.version).toBe(1)

    // 2. World entry
    const world = repository.createEntry(opened.sessionId, {
      kind: 'world',
      title: '青云山脉',
      authorContent: '东域第一灵脉所在地，终年云雾缭绕，有七十二座主峰。',
      tags: ['宗门', '地理']
    })
    expect(world.knowledgeKind).toBe('world')

    // 3. Timeline entry
    const timeline = repository.createEntry(opened.sessionId, {
      kind: 'timeline',
      title: '青云大比',
      authorContent: '每三年举办一次的宗门比武大会。',
      narrativeOrder: 1,
      storyTime: '天元历三万年秋',
      timeUncertain: false
    })
    expect(timeline.knowledgeKind).toBe('timeline')
    expect(timeline.narrativeOrder).toBe(1)

    // 4. Foreshadow entry
    const foreshadow = repository.createEntry(opened.sessionId, {
      kind: 'foreshadow',
      title: '断云剑的裂痕',
      authorContent: '古剑深处的封印似乎正在松动。',
      foreshadowState: 'planted'
    })
    expect(foreshadow.knowledgeKind).toBe('foreshadow')
    expect(foreshadow.foreshadowState).toBe('planted')

    // List active entries
    const activeList = repository.listEntries(opened.sessionId, { state: 'active' })
    expect(activeList).toHaveLength(4)

    // Query filter
    const searchMatch = repository.listEntries(opened.sessionId, { query: '断云' })
    expect(searchMatch.length).toBeGreaterThanOrEqual(2)

    // Update with version control
    const updatedChar = repository.updateEntry(
      opened.sessionId,
      char.id,
      {
        currentState: '已突破筑基初期',
        authorContent: '青云门外门弟子，成功筑基，成为内门执事。'
      },
      1
    )
    expect(updatedChar.version).toBe(2)
    expect(updatedChar.currentState).toBe('已突破筑基初期')

    // Concurrency conflict on update
    expect(() => {
      repository.updateEntry(opened.sessionId, char.id, { title: '旧覆盖' }, 1)
    }).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))

    // FTS sync verification
    await searchIndex.sync(opened.sessionId)
    const ftsResults = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '灵脉所在地',
      filters: { sourceTypes: ['knowledge_entry'] }
    })
    expect(ftsResults).toHaveLength(1)
    expect(ftsResults[0].title).toBe('青云山脉')

    // Archive entry and verify FTS removal
    const archivedWorld = repository.archiveEntry(opened.sessionId, world.id, 1)
    expect(archivedWorld.state).toBe('archived')
    expect(archivedWorld.version).toBe(2)

    await searchIndex.sync(opened.sessionId)
    const ftsAfterArchive = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '灵脉所在地',
      filters: { sourceTypes: ['knowledge_entry'] }
    })
    expect(ftsAfterArchive).toHaveLength(0)

    // Restore entry and verify FTS re-indexing
    const restoredWorld = repository.restoreEntry(opened.sessionId, world.id, 2)
    expect(restoredWorld.state).toBe('active')
    expect(restoredWorld.version).toBe(3)

    await searchIndex.sync(opened.sessionId)
    const ftsAfterRestore = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '灵脉所在地',
      filters: { sourceTypes: ['knowledge_entry'] }
    })
    expect(ftsAfterRestore).toHaveLength(1)

    store.close(opened.sessionId)
  })
})

describe('KnowledgeRepository - Character Directed Relationships', () => {
  it('manages directed relationships and hides archived characters from default view', async () => {
    const { project, store, repository } = fixture()
    const opened = await store.open(project)

    const char1 = repository.createEntry(opened.sessionId, { kind: 'character', title: '林萧' })
    const char2 = repository.createEntry(opened.sessionId, { kind: 'character', title: '苏月灵' })
    const worldEntry = repository.createEntry(opened.sessionId, { kind: 'world', title: '绝龙谷' })

    // Self-relation validation
    expect(() => {
      repository.createRelationship(opened.sessionId, char1.id, char1.id, '同门')
    }).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))

    // Non-character target validation
    expect(() => {
      repository.createRelationship(opened.sessionId, char1.id, worldEntry.id, '前往')
    }).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))

    // Create valid directed relation
    const rel = repository.createRelationship(
      opened.sessionId,
      char1.id,
      char2.id,
      '师姐弟',
      '月灵在入门时曾指点林萧剑术。'
    )
    expect(rel.id).toBeDefined()
    expect(rel.fromCharacterId).toBe(char1.id)
    expect(rel.toCharacterId).toBe(char2.id)
    expect(rel.fromCharacterTitle).toBe('林萧')
    expect(rel.toCharacterTitle).toBe('苏月灵')

    // List relations
    const list = repository.listRelationships(opened.sessionId, char1.id)
    expect(list).toHaveLength(1)

    // Archive one character -> relation is hidden from default list but retained in DB
    repository.archiveEntry(opened.sessionId, char2.id, 1)
    const defaultListAfterArchive = repository.listRelationships(opened.sessionId, char1.id)
    expect(defaultListAfterArchive).toHaveLength(0)

    const allListIncludingArchived = repository.listRelationships(opened.sessionId, char1.id, true)
    expect(allListIncludingArchived).toHaveLength(1)

    // Update relationship with version control
    const updatedRel = repository.updateRelationship(
      opened.sessionId,
      rel.id,
      '生死至交',
      '并肩历经多次死战，互相信任。',
      1
    )
    expect(updatedRel.version).toBe(2)
    expect(updatedRel.relationType).toBe('生死至交')

    // Delete relationship
    const delRes = repository.deleteRelationship(opened.sessionId, rel.id, 2)
    expect(delRes.success).toBe(true)

    store.close(opened.sessionId)
  })
})

describe('KnowledgeRepository - AI Fact Suggestions & Atomic Acceptance', () => {
  it('previews and accepts suggestions into a new knowledge entry atomically', async () => {
    const { project, store, chapters, repository, searchIndex } = fixture()
    const opened = await store.open(project)
    const [firstChapter] = chapters.list(opened.sessionId)

    // Seed task and suggestion with evidence
    const taskId = randomUUID()
    store.transaction(opened.sessionId, (db) => {
      db.prepare(`
        INSERT INTO task(id, type, scope_json, state, created_at, updated_at)
        VALUES (?, 'knowledge', '[]', 'completed', ?, ?)
      `).run(taskId, Date.now(), Date.now())
    })

    const suggestion = repository.createSuggestion(opened.sessionId, {
      knowledgeKind: 'character',
      normalizedSubject: '神秘黑衣人',
      predicate: '持有法宝',
      valueJson: JSON.stringify({ item: '嗜血珠' }),
      displayText: '曾在断云峰出现，手持上古魔器嗜血珠。',
      analysisTaskId: taskId,
      confidence: 0.95
    })

    const evidence = repository.addEvidence(opened.sessionId, {
      ownerType: 'ai_fact_suggestion',
      ownerId: suggestion.id,
      chapterId: firstChapter.id,
      chapterVersion: firstChapter.version,
      startOffset: 0,
      endOffset: 10,
      excerpt: '林萧握紧了手中的断云剑'
    })

    // List suggestions
    const suggestions = repository.listSuggestions(opened.sessionId, { state: 'pending' })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].evidences).toHaveLength(1)
    expect(suggestions[0].evidences[0].id).toBe(evidence.id)

    // Preview acceptance for new entity
    const preview = repository.previewSuggestionAcceptance(opened.sessionId, suggestion.id)
    expect(preview.targetEntry).toBeNull()
    expect(preview.draft.title).toBe('神秘黑衣人')
    expect(preview.draft.kind).toBe('character')
    expect(preview.draft.authorContent).toBe(suggestion.displayText)

    // Author text is NOT overwritten before confirmation
    expect(repository.listEntries(opened.sessionId, { query: '神秘黑衣人' })).toHaveLength(0)

    // Accept suggestion into new entry
    const acceptedEntry = repository.acceptSuggestion(opened.sessionId, {
      suggestionId: suggestion.id,
      expectedSuggestionVersion: 1,
      draft: {
        title: '神秘黑袍客',
        kind: 'character',
        authorContent: '曾在断云峰出现，手持上古魔器嗜血珠，身份不明。'
      }
    })

    expect(acceptedEntry.id).toBeDefined()
    expect(acceptedEntry.title).toBe('神秘黑袍客')
    expect(acceptedEntry.authorContent).toContain('上古魔器嗜血珠')

    // Suggestion is now marked accepted
    const reloadedSuggestion = repository.getSuggestion(opened.sessionId, suggestion.id)
    expect(reloadedSuggestion.state).toBe('accepted')
    expect(reloadedSuggestion.knowledgeEntryId).toBe(acceptedEntry.id)
    expect(reloadedSuggestion.version).toBe(2)

    // FTS sync
    await searchIndex.sync(opened.sessionId)
    const ftsResults = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '嗜血珠',
      filters: { sourceTypes: ['knowledge_entry'] }
    })
    expect(ftsResults).toHaveLength(1)
    expect(ftsResults[0].title).toBe('神秘黑袍客')

    store.close(opened.sessionId)
  })

  it('previews and accepts suggestions into existing entries with atomic version checks', async () => {
    const { project, store, repository } = fixture()
    const opened = await store.open(project)

    // Existing character entry
    const existingChar = repository.createEntry(opened.sessionId, {
      kind: 'character',
      title: '林萧',
      authorContent: '青云门弟子，修习正宗道法。'
    })

    const taskId = randomUUID()
    store.transaction(opened.sessionId, (db) => {
      db.prepare(`
        INSERT INTO task(id, type, scope_json, state, created_at, updated_at)
        VALUES (?, 'knowledge', '[]', 'completed', ?, ?)
      `).run(taskId, Date.now(), Date.now())
    })

    const suggestion = repository.createSuggestion(opened.sessionId, {
      knowledgeKind: 'character',
      normalizedSubject: '林萧',
      predicate: '获得奇遇',
      valueJson: JSON.stringify({ event: '获得剑魄' }),
      displayText: '在试炼古洞中融合了上古剑魄。',
      analysisTaskId: taskId
    })

    // Preview for existing entry merges text
    const preview = repository.previewSuggestionAcceptance(opened.sessionId, suggestion.id, existingChar.id)
    expect(preview.targetEntry).not.toBeNull()
    expect(preview.targetExpectedVersion).toBe(1)
    expect(preview.draft.authorContent).toBe('青云门弟子，修习正宗道法。\n\n在试炼古洞中融合了上古剑魄。')

    // Concurrency conflict on target entry version
    expect(() => {
      repository.acceptSuggestion(opened.sessionId, {
        suggestionId: suggestion.id,
        expectedSuggestionVersion: 1,
        targetEntryId: existingChar.id,
        targetExpectedVersion: 999, // Wrong version
        draft: preview.draft
      })
    }).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))

    // Concurrency conflict on suggestion version
    expect(() => {
      repository.acceptSuggestion(opened.sessionId, {
        suggestionId: suggestion.id,
        expectedSuggestionVersion: 999, // Wrong version
        targetEntryId: existingChar.id,
        targetExpectedVersion: 1,
        draft: preview.draft
      })
    }).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))

    // Valid atomic acceptance
    const updatedEntry = repository.acceptSuggestion(opened.sessionId, {
      suggestionId: suggestion.id,
      expectedSuggestionVersion: 1,
      targetEntryId: existingChar.id,
      targetExpectedVersion: 1,
      draft: preview.draft
    })

    expect(updatedEntry.version).toBe(2)
    expect(updatedEntry.authorContent).toContain('上古剑魄')

    // Status transition to ignored or conflict
    const suggestion2 = repository.createSuggestion(opened.sessionId, {
      knowledgeKind: 'character',
      normalizedSubject: '未知人物',
      predicate: '推测',
      valueJson: '{}',
      displayText: '可能是内鬼',
      analysisTaskId: taskId
    })

    const ignored = repository.reviewSuggestion(opened.sessionId, suggestion2.id, 'ignored', 1)
    expect(ignored.state).toBe('ignored')
    expect(ignored.version).toBe(2)

    store.close(opened.sessionId)
  })
})
