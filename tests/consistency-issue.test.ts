import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'

const stores: ProjectStore[] = []
const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-issues-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  stores.push(store)
  store.create({ destination: project, title: '测试作品', description: '测试描述' }, [
    { title: '第一章', content: '林萧在青云宗练剑。' }
  ])
  const searchIndex = new SearchIndex(store)
  const chapters = new ChapterRepository(store, searchIndex)
  return { folder, project, store, searchIndex, chapters }
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    await store.closeAll()
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('ConsistencyIssue Service & Lifecycle States', () => {
  it('creates, lists, and reviews consistency issues with optimistic concurrency control', async () => {
    const { project, store, chapters } = fixture()
    const opened = await store.open(project)
    const chap = chapters.list(opened.sessionId)[0]
    const hash = createHash('sha256').update(chapters.get(opened.sessionId, chap.id).content).digest('hex')

    // Create a task first
    const task = store.createTask(opened.sessionId, 'knowledge', '{}', null, [chap.id])

    // Commit a chapter analysis containing consistency issues
    store.commitChapterAnalysis(opened.sessionId, {
      taskId: task.id,
      stepId: task.steps[0].id,
      chapterId: chap.id,
      capturedChapterVersion: chap.version,
      capturedSourceHash: hash,
      summary: '章节摘要',
      consistencyIssues: [
        {
          issueType: 'plot_hole',
          severity: 'high',
          description: '主角在没有内力的情况下突然施展高阶剑法',
          evidence: { startOffset: 0, endOffset: 5, excerpt: '林萧在青云' }
        }
      ]
    })

    // List issues
    const issues = store.listConsistencyIssues(opened.sessionId)
    expect(issues.length).toBe(1)
    const issue = issues[0]
    expect(issue.issueType).toBe('plot_hole')
    expect(issue.severity).toBe('high')
    expect(issue.state).toBe('open')
    expect(issue.evidences.length).toBe(1)
    expect(issue.version).toBe(1)

    // Review issue: acknowledge
    const acked = store.reviewConsistencyIssue(opened.sessionId, issue.id, 'acknowledged', issue.version)
    expect(acked.state).toBe('acknowledged')
    expect(acked.version).toBe(2)
    expect(acked.reviewedAt).toBeDefined()

    // Concurrency conflict check
    expect(() => {
      store.reviewConsistencyIssue(opened.sessionId, issue.id, 'dismissed', 1)
    }).toThrow()

    // Review issue: dismiss with new version
    const dismissed = store.reviewConsistencyIssue(opened.sessionId, issue.id, 'dismissed', acked.version)
    expect(dismissed.state).toBe('dismissed')
    expect(dismissed.version).toBe(3)

    // Editing chapter marks non-dismissed issues as stale
    // Create another open issue
    const task2 = store.createTask(opened.sessionId, 'knowledge', '{}', null, [chap.id])
    store.commitChapterAnalysis(opened.sessionId, {
      taskId: task2.id,
      stepId: task2.steps[0].id,
      chapterId: chap.id,
      capturedChapterVersion: chap.version,
      capturedSourceHash: hash,
      summary: '章节摘要2',
      consistencyIssues: [
        {
          issueType: 'timeline_contradiction',
          severity: 'medium',
          description: '时间线前后矛盾'
        }
      ]
    })

    const openIssues = store.listConsistencyIssues(opened.sessionId, { state: 'open' })
    expect(openIssues.length).toBe(1)

    // Update chapter
    chapters.update(opened.sessionId, chap.id, '修改后的第一章正文', chap.version)

    // Open issue should now be stale, but dismissed issue remains dismissed
    const allIssues = store.listConsistencyIssues(opened.sessionId)
    const timeIssue = allIssues.find((i) => i.issueType === 'timeline_contradiction')!
    expect(timeIssue.state).toBe('stale')

    const dismissedIssue = allIssues.find((i) => i.id === issue.id)!
    expect(dismissedIssue.state).toBe('dismissed')
  })
})
