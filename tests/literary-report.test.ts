import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'
import type { ReportSectionType } from '../src/shared/project'

const stores: ProjectStore[] = []
const folders: string[] = []
function fixture() {
  const folder = join(tmpdir(), `novel-agent-reports-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  stores.push(store)
  store.create({ destination: project, title: '测试作品', description: '测试描述' }, [
    { title: '第一章', content: '月黑风高夜，杀人放火天。' }
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

describe('LiteraryReport Service & Annotations', () => {
  it('creates, retrieves, annotates, and invalidates 6-section literary reports', async () => {
    const { project, store, chapters } = fixture()
    const opened = await store.open(project)
    const chap = chapters.list(opened.sessionId)[0]

    const sectionTypes: ReportSectionType[] = [
      'theme',
      'narrative_perspective',
      'style',
      'pacing_and_structure',
      'character_arc',
      'continuity_issues'
    ]

    const reportId = store.createLiteraryReport(
      opened.sessionId,
      JSON.stringify({ all: true }),
      JSON.stringify({ [chap.id]: chap.version }),
      null,
      null,
      sectionTypes.map((type, i) => ({
        sectionType: type,
        content: `这是【${type}】维度的深入剖析正文。`,
        conclusion: `【${type}】结论摘要。`,
        position: i,
        evidences: [
          {
            chapterId: chap.id,
            chapterVersion: chap.version,
            startOffset: 0,
            endOffset: 5,
            excerpt: '月黑风高夜'
          }
        ]
      }))
    )

    expect(reportId).toBeDefined()

    // List reports
    const list = store.listLiteraryReports(opened.sessionId)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(reportId)
    expect(list[0].state).toBe('current')

    // Get report detail
    const detail = store.getLiteraryReport(opened.sessionId, reportId)
    expect(detail.sections.length).toBe(6)
    const styleSection = detail.sections.find((s) => s.sectionType === 'style')!
    expect(styleSection.content).toContain('style')
    expect(styleSection.evidences.length).toBe(1)

    // Author annotation CRUD
    const note = store.addReportAnnotation(opened.sessionId, styleSection.id, '批注：文风偏冷峻。')
    expect(note.id).toBeDefined()
    expect(note.content).toBe('批注：文风偏冷峻。')

    const updatedNote = store.updateReportAnnotation(opened.sessionId, note.id, '批注：文风偏冷峻，后续章节转为轻快。')
    expect(updatedNote.content).toContain('后续章节转为轻快')

    // Verify detail reflects annotation
    const detailWithNote = store.getLiteraryReport(opened.sessionId, reportId)
    const styleSectionWithNote = detailWithNote.sections.find((s) => s.sectionType === 'style')!
    expect(styleSectionWithNote.annotations.length).toBe(1)

    // Delete annotation
    store.deleteReportAnnotation(opened.sessionId, note.id)
    const detailAfterDel = store.getLiteraryReport(opened.sessionId, reportId)
    const styleSectionAfterDel = detailAfterDel.sections.find((s) => s.sectionType === 'style')!
    expect(styleSectionAfterDel.annotations.length).toBe(0)

    // Chapter edit preserves existing literary reports (ADR 0001)
    chapters.update(opened.sessionId, chap.id, '更新后的第一章内容', chap.version)
    const listAfterEdit = store.listLiteraryReports(opened.sessionId)
    expect(listAfterEdit[0].state).toBe('current')
  })
})
