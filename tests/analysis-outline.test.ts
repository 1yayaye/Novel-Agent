import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { AnalysisRunner } from '../src/main/analysis-runner'

const folders: string[] = []
function fixture(projectName = 'Story.novelproj') {
  const folder = join(tmpdir(), `novel-agent-analysis-outline-test-${randomUUID()}`)
  mkdirSync(folder, { recursive: true })
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data, { recursive: true })
  return { folder, data, project: join(folder, projectName) }
}

let activeStore: ProjectStore | undefined

afterEach(async () => {
  if (activeStore) {
    await activeStore.closeAll()
    activeStore = undefined
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('T03: Analysis Results to Outline Draft & Stale Invalidation', () => {
  it('generates book outline draft from chapter summaries and marks stale on text edit', async () => {
    const { data, project } = fixture()
    const store = new ProjectStore(data)
    activeStore = store

    store.create({ destination: project, title: '大纲草稿分析测试', description: '' }, [
      { title: '第一章 青牛镇', content: '韩立生于贫苦农家，为了贴补家用参加七玄门考核。' },
      { title: '第二章 墨大夫', content: '韩立进入神手谷成为记名弟子，跟随墨大夫学习医术与长春功。' }
    ])

    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)
    const analysisRunner = new AnalysisRunner(store)

    const opened = await store.open(project)
    const { sessionId } = opened

    const [chap1, chap2] = chapters.list(sessionId)

    // Commit chapter summaries
    const taskId = 'task-analysis-1'
    store.transaction(sessionId, (db) => {
      db.prepare("INSERT INTO task(id, type, scope_json, state, cancel_requested, created_at, updated_at) VALUES (?, 'knowledge', '{}', 'completed', 0, ?, ?)").run(taskId, Date.now(), Date.now())
      db.prepare('INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), chap1.id, chap1.version, '韩立离开村庄参加七玄门选拔。', 'current', taskId, Date.now())
      db.prepare('INSERT INTO chapter_summary(id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), chap2.id, chap2.version, '韩立进入神手谷随墨大夫研习长春功。', 'current', taskId, Date.now())
    })

    // Generate book outline draft
    const draft = await analysisRunner.generateBookOutlineDraft(sessionId)
    expect(draft).toBeDefined()
    expect(draft.state).toBe('draft')
    expect(draft.version).toBe(1)
    expect(draft.content).toContain('青牛镇')
    expect(draft.content).toContain('韩立离开村庄参加七玄门选拔')
    expect(draft.content).toContain('墨大夫')

    // Confirm that authoritative knowledge entries are NOT silently created (SPEC / T03 constraint)
    const knowledgeEntries = store.read(sessionId, (db) => {
      return db.prepare('SELECT count(*) as cnt FROM knowledge_entry').get() as { cnt: number }
    })
    expect(knowledgeEntries.cnt).toBe(0)

    // Confirm outline
    const confirmed = store.confirmBookOutline(sessionId, draft.version)
    expect(confirmed.state).toBe('confirmed')
    expect(confirmed.version).toBe(2)

    // Edit chapter 1 text -> preserves book outline without stale (ADR 0001)
    chapters.update(sessionId, chap1.id, '韩立在清晨辞别父母，动身前往七玄门。', chap1.version)

    const preservedOutline = store.getBookOutline(sessionId)
    expect(preservedOutline?.state).toBe('confirmed')

    store.close(sessionId)
    activeStore = undefined
  })
})
