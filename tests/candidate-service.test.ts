import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { CandidateService } from '../src/main/candidate-service'
import { CandidateApplyResultSchema } from '../src/shared/contracts/ai'

describe('CandidateService (SPEC 8.2, 8.3, 9.1-9.4)', () => {
  let tempDir: string
  let store: ProjectStore
  let searchIndex: SearchIndex
  let chapterRepo: ChapterRepository
  let candidateService: CandidateService
  let sessionId: string
  let chapterId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-candidate-test-'))
    store = new ProjectStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    candidateService = new CandidateService(store, searchIndex)

    const projectPath = join(tempDir, 'test-candidate.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙', description: '候选测试' }, [
      { title: '第一章 拜入宗门', content: '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。' },
      { title: '第二章 神手谷', content: '韩立在神手谷后山采药。' }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId
    const chapters = chapterRepo.list(sessionId)
    chapterId = chapters[0].id
  })

  afterEach(async () => {
    await store.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('retrieves candidate and lists candidates for session', () => {
    const candId = 'cand-test-1'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。',
        '韩立收拾行装离开五里沟，怀揣神秘玉佩前往七玄门。山道崎岖，白云缭绕。',
        null,
        1,
        'ready',
        now,
        now
      )

      // Insert hunk
      db.prepare(`
        INSERT INTO candidate_hunk (
          id, candidate_id, position, hunk_type,
          original_content, candidate_content, selected
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('hunk-1', candId, 0, 'equal', '韩立收拾', '韩立收拾', 1)
    })

    const detail = candidateService.getCandidate(sessionId, candId)
    expect(detail.id).toBe(candId)
    expect(detail.state).toBe('ready')
    expect(detail.hunks).toHaveLength(1)

    const list = candidateService.listCandidates(sessionId)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(candId)
  })

  it('updates text, recomputes diff hunks and bumps version', () => {
    const candId = 'cand-update-1'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。',
        '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。',
        null,
        1,
        'ready',
        now,
        now
      )
    })

    const newText = '韩立背负青竹剑离开五里沟，怀揣神秘玉佩前往七玄门。'
    const updated = candidateService.updateText(sessionId, candId, newText, 1)

    expect(updated.version).toBe(2)
    expect(updated.editedContent).toBe(newText)
    expect(updated.hunks.length).toBeGreaterThan(1)

    // Verify version conflict error
    expect(() =>
      candidateService.updateText(sessionId, candId, 'test', 1) // Outdated version
    ).toThrow('候选已被其他操作修改')
  })

  it('stages hunk and toggles selection', () => {
    const candId = 'cand-stage-1'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立收拾行囊离开五里沟。',
        '韩立离开五里沟。',
        null,
        1,
        'ready',
        now,
        now
      )

      db.prepare(`
        INSERT INTO candidate_hunk (
          id, candidate_id, position, hunk_type,
          original_content, candidate_content, selected
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('hunk-stage-0', candId, 0, 'replace', '韩立收拾', '韩立离开', 1)
    })

    const updated = candidateService.stageHunk(sessionId, candId, 0, false, 1)

    expect(updated.version).toBe(2)
    expect(updated.hunks[0].selected).toBe(false)
  })

  it('retains cancelled candidate if chapter version matches, or marks stale if modified', () => {
    const candId = 'cand-retain-1'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立离开五里沟。',
        '草稿内容...',
        null,
        1,
        'cancelled',
        now,
        now
      )
    })

    const retained = candidateService.retain(sessionId, candId, 1)
    expect(retained.state).toBe('ready')

    // If chapter version changed:
    chapterRepo.update(sessionId, chapterId, '新正文修改', 1)
    const candId2 = 'cand-retain-2'
    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId2,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立离开五里沟。',
        '草稿内容2...',
        null,
        1,
        'cancelled',
        now,
        now
      )
    })

    const retainedStale = candidateService.retain(sessionId, candId2, 1)
    expect(retainedStale.state).toBe('stale')
  })

  it('rejects ready candidate', () => {
    const candId = 'cand-reject-1'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立离开五里沟。',
        '候选内容...',
        null,
        1,
        'ready',
        now,
        now
      )
    })

    const rejected = candidateService.reject(sessionId, candId, 1)
    expect(rejected.state).toBe('rejected')
  })

  it('applies candidate atomically with permanent snapshot and invalidation', () => {
    const candId = randomUUID()
    const otherCandId = randomUUID()
    const taskId = randomUUID()
    const now = Date.now()

    const originalText = '韩立收拾行囊离开五里沟，怀揣神秘玉佩前往七玄门。'
    const candidateOutput = '韩立背负青竹剑离开五里沟，怀揣神秘玉佩前往七玄门。山风凛冽。'

    store.transaction(sessionId, (db) => {
      // Insert a dummy task first to satisfy FK
      db.prepare(`
        INSERT INTO task (id, type, scope_json, state, created_at, updated_at)
        VALUES (?, 'knowledge', '[]', 'completed', ?, ?)
      `).run(taskId, now, now)

      // Insert candidate 1
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        taskId,
        chapterId,
        1,
        null,
        null,
        originalText,
        candidateOutput,
        null,
        1,
        'ready',
        now,
        now
      )

      // Insert another candidate on the same chapter
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        otherCandId,
        null,
        chapterId,
        1,
        null,
        null,
        originalText,
        '另一份候选',
        null,
        1,
        'ready',
        now,
        now
      )

      // Insert a chapter summary and literary report to test invalidation
      db.prepare(`
        INSERT INTO chapter_summary (id, chapter_id, chapter_version, summary, state, analysis_task_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('sum-1', chapterId, 1, '旧摘要', 'current', taskId, now)

      db.prepare(`
        INSERT INTO literary_report (id, scope_json, chapter_versions_json, state, created_at)
        VALUES (?, '[]', '{}', 'current', ?)
      `).run('rep-1', now)
    })

    // Insert hunks for candidate 1
    candidateService.updateText(sessionId, candId, candidateOutput, 1)

    // Execute apply writeback!
    const result = candidateService.apply(sessionId, {
      sessionId,
      candidateId: candId,
      expectedCandidateVersion: 2,
      expectedChapterVersion: 1
    })

    expect(() => CandidateApplyResultSchema.parse(result)).not.toThrow()
    expect(result.candidate.id).toBe(candId)
    expect(result.snapshot.chapterVersion).toBe(1)
    expect(result.chapter.content).toBe(candidateOutput)
    expect(result.chapter.version).toBe(2)
    expect(result.chapter.createdAt).toBe(chapterRepo.get(sessionId, chapterId).createdAt)

    // Verify permanent snapshot was created
    const snapshots = chapterRepo.listSnapshots(sessionId, chapterId)
    expect(snapshots.length).toBeGreaterThan(0)
    const applySnapshot = snapshots.find((s) => s.id === result.snapshot.id)
    expect(applySnapshot).toBeDefined()
    expect(applySnapshot?.snapshotKind).toBe('ai_apply')

    const snapshotDetail = chapterRepo.getSnapshot(sessionId, result.snapshot.id)
    expect(snapshotDetail.content).toBe(originalText) // Stores pre-apply state!
    expect(snapshotDetail.permanent).toBe(true)

    // Verify candidate state updated to applied
    const appliedDetail = candidateService.getCandidate(sessionId, candId)
    expect(appliedDetail.state).toBe('applied')

    // Verify candidate_apply record
    store.read(sessionId, (db) => {
      const applyLog = db.prepare(`SELECT * FROM candidate_apply WHERE candidate_id = ?`).get(candId) as any
      expect(applyLog).toBeDefined()
      expect(applyLog.before_chapter_version).toBe(1)
      expect(applyLog.after_chapter_version).toBe(2)

      const summaryRow = db.prepare(`SELECT state FROM chapter_summary WHERE id = ?`).get('sum-1') as any
      expect(summaryRow.state).toBe('stale')

      const reportRow = db.prepare(`SELECT state FROM literary_report WHERE id = ?`).get('rep-1') as any
      expect(reportRow.state).toBe('current')
    })

    // Verify invalidations
    const otherCand = candidateService.getCandidate(sessionId, otherCandId)
    expect(otherCand.state).toBe('stale') // Other ready candidate became stale!
  })

  it('rejects apply with STALE_CANDIDATE when chapter version has changed', () => {
    const candId = 'cand-stale-test'
    const now = Date.now()

    store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO candidate (
          id, task_id, chapter_id, chapter_version, start_offset, end_offset,
          original_content, raw_output, edited_content, version, state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candId,
        null,
        chapterId,
        1,
        null,
        null,
        '韩立离开五里沟。',
        '候选内容',
        null,
        1,
        'ready',
        now,
        now
      )
    })

    // Modify chapter to bump version
    chapterRepo.update(sessionId, chapterId, '修改后的正文内容', 1)

    // Try to apply with stale version 1
    expect(() =>
      candidateService.apply(sessionId, {
        sessionId,
        candidateId: candId,
        expectedCandidateVersion: 1,
        expectedChapterVersion: 1
      })
    ).toThrow()

    // Verify candidate state is marked stale
    const detail = candidateService.getCandidate(sessionId, candId)
    expect(detail.state).toBe('stale')
  })
})
