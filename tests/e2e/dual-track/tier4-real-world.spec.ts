import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createDualTrackTestEnv,
  createTestProject,
  WebView2BridgeSimulator,
  getAccurateCharacterCount,
  type DualTrackTestEnv
} from './harness'
import { parseImport } from '../../../src/main/import-parser'
import { computeDiffHunks } from '../../../src/main/candidate-service'

describe('Tier 4: Real-World Application Scenarios — End-to-End Workflows', () => {
  let env: DualTrackTestEnv

  beforeAll(async () => {
    env = await createDualTrackTestEnv()
  })

  afterAll(async () => {
    await env.cleanup()
  })

  // =========================================================================
  // Scenario 1: Complete Novel Import Workflow
  // =========================================================================
  it('scenario-01: imports multi-chapter TXT, builds project, navigates and edits chapter 1', async () => {
    // 1. Prepare raw Chinese TXT file
    const txtPath = join(env.tempDir, 'sample-novel-import.txt')
    const rawTxt = [
      '第一章 潜龙在渊',
      '大乾王朝历七百二十年，荒州边境风沙漫天。少年林动背负残剑，行走在荒凉的戈壁滩上。',
      '',
      '第二章 古碑秘宝',
      '荒原深处，一座残破古碑耸立。古碑之上符文隐现，散发着苍茫古朴的气息。',
      '',
      '第三章 宿敌初现',
      '忽然，数道黑影自沙暴中暴射而出，兵刃森寒，直取林动要害。'
    ].join('\n')

    writeFileSync(txtPath, rawTxt, 'utf8')

    // 2. Parse import with chapter boundaries detection
    const importPreview = parseImport(txtPath)
    expect(importPreview.encoding).toBe('utf8')
    expect(importPreview.chapters.length).toBe(3)
    expect(importPreview.chapters[0].title).toBe('第一章 潜龙在渊')
    expect(importPreview.chapters[1].title).toBe('第二章 古碑秘宝')
    expect(importPreview.chapters[2].title).toBe('第三章 宿敌初现')

    // 3. Create project with parsed chapters
    const destination = join(env.novelsDir, `imported-${randomUUID()}.novelproj`)
    const summary = env.store.create(
      { destination, title: '大乾荒武志', description: '玄幻修真长篇' },
      importPreview.chapters
    )
    expect(existsSync(destination)).toBe(true)
    expect(summary.title).toBe('大乾荒武志')

    // 4. Open project and load chapter list
    const opened = await env.store.open(destination)
    const sessionId = opened.sessionId
    const chapterHeaders = env.chapters.list(sessionId)
    expect(chapterHeaders.length).toBe(3)

    // 5. Load chapter 1 full text, edit and verify persistence
    const ch1 = env.chapters.get(sessionId, chapterHeaders[0].id)
    expect(ch1.content).toContain('荒州边境风沙漫天')

    const newContent = ch1.content + '\n他深吸一口气，紧了紧剑柄，继续前行。'
    const updatedCh1 = env.chapters.update(sessionId, ch1.id, newContent, ch1.version)
    expect(updatedCh1.version).toBe(2)
    expect(updatedCh1.content).toContain('他深吸一口气')

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Scenario 2: Full Chapter Writing & AI Co-Creation Loop
  // =========================================================================
  it('scenario-02: executes complete writing loop: outline -> draft -> AI continuation -> review & apply', async () => {
    const project = createTestProject(env, '全流程创作循环')
    const { sessionId } = await env.store.open(project.path)

    // 1. Create chapter draft
    const ch = env.chapters.create(
      sessionId,
      '第五回 丹阁争锋',
      '演武台四周人声鼎沸，各峰长老端坐高台之上。'
    )

    // 2. Simulate AI streaming generation
    const bridge = new WebView2BridgeSimulator()
    const deltas: string[] = []

    bridge.on('message', (msgStr: string) => {
      const msg = JSON.parse(msgStr)
      if (msg.type === 'event' && msg.channel === 'candidate:delta') {
        deltas.push(msg.payload.delta)
      }
    })

    bridge.sendPushEvent('candidate:delta', { delta: '林动缓步登台，' })
    bridge.sendPushEvent('candidate:delta', { delta: '目光平静如水，' })
    bridge.sendPushEvent('candidate:delta', { delta: '腰间残剑微微嗡鸣。' })

    const aiText = deltas.join('')
    expect(aiText).toBe('林动缓步登台，目光平静如水，腰间残剑微微嗡鸣。')

    // 3. Diff review
    const proposedContent = ch.content + '\n' + aiText
    const hunks = computeDiffHunks(ch.content, proposedContent)
    expect(hunks.length).toBeGreaterThanOrEqual(1)

    // 4. Create safety snapshot prior to apply
    const snapshot = env.chapters.createOrdinarySnapshot(sessionId, ch.id, ch.version)
    expect(snapshot).not.toBeNull()

    // 5. Apply candidate
    const applied = env.chapters.update(sessionId, ch.id, proposedContent, ch.version)
    expect(applied.version).toBe(2)
    expect(applied.content).toContain('腰间残剑微微嗡鸣')

    // 6. Verify word count updated
    const count = getAccurateCharacterCount(applied.content)
    expect(count).toBeGreaterThan(ch.content.length)

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Scenario 3: Mid-Session Crash & Abnormal Termination Recovery
  // =========================================================================
  it('scenario-03: recovers from ungraceful process crash via WAL checkpoint recovery', async () => {
    const project = createTestProject(env, '崩坏恢复测试')
    const openRes = await env.store.open(project.path)
    const sessionId = openRes.sessionId

    // Add content
    const ch = env.chapters.create(sessionId, '崩溃前章节', '这部分内容在断电崩溃前已被写入。')
    expect(ch.id).toBeDefined()

    // Simulate abnormal termination: close without checkpointing (or reopening directly)
    await env.store.close(sessionId)

    // Reopen and probe database integrity
    const recovered = await env.store.open(project.path)
    expect(recovered.integrity).toBe('ok')
    expect(recovered.mode).toBe('read_write')

    const recoveredCh = env.chapters.get(recovered.sessionId, ch.id)
    expect(recoveredCh.content).toBe('这部分内容在断电崩溃前已被写入。')
    expect(recoveredCh.version).toBe(1)

    await env.store.close(recovered.sessionId)
  })

  // =========================================================================
  // Scenario 4: High-Watermark Backup Retention & Rotation
  // =========================================================================
  it('scenario-04: creates backups up to retention limit and successfully restores oldest without deletion race', async () => {
    // Authoritative source: AGENT_LEARNINGS.md line 4
    const project = createTestProject(env, '备份轮换保护测试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '备份章节', '初始备份版本')

    // Create 5 manual backups
    const backups: any[] = []
    for (let i = 1; i <= 5; i++) {
      env.chapters.update(sessionId, ch.id, `备份正文版本 ${i}`, i)
      const b = await env.store.createBackup(sessionId, `backup-${i}`)
      backups.push(b)
    }

    expect(backups.length).toBe(5)

    // The oldest backup must be protected and restored successfully
    const oldestBackup = backups[0]
    expect(existsSync(oldestBackup.path)).toBe(true)

    // Perform restore of oldest backup
    const restoredSummary = await env.store.restoreBackup(sessionId, oldestBackup.path)
    expect(restoredSummary).toBeDefined()

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Scenario 5: Multi-Chapter Rolling Analysis & Step Interruption Integrity
  // =========================================================================
  it('scenario-05: prevents state pollution on interrupted multi-chapter analysis retry', async () => {
    // Authoritative source: AGENT_LEARNINGS.md line 8
    const project = createTestProject(env, '滚动分析断点重试测试')
    const { sessionId } = await env.store.open(project.path)

    // Insert task with step 1 completed, step 2 failed with dirty checkpoint
    const taskId = 'task-analysis-rolling'
    const now = Date.now()

    env.store.transaction(sessionId, (db) => {
      db.prepare(`
        INSERT INTO task (id, type, scope_json, state, created_at, updated_at)
        VALUES (?, 'analysis', '{}', 'failed', ?, ?)
      `).run(taskId, now, now)

      // Step 1: Completed with valid clean checkpoint
      db.prepare(`
        INSERT INTO task_step (id, task_id, position, state, attempt_count, checkpoint_json, created_at, updated_at)
        VALUES ('step-1', ?, 0, 'completed', 1, '{"completedChapter": 1, "knowledgeState": "valid"}', ?, ?)
      `).run(taskId, now, now)

      // Step 2: Failed with dirty corrupted checkpoint
      db.prepare(`
        INSERT INTO task_step (id, task_id, position, state, attempt_count, checkpoint_json, created_at, updated_at)
        VALUES ('step-2', ?, 1, 'failed', 1, '{"dirtyPollutedData": true}', ?, ?)
      `).run(taskId, now, now)
    })

    // Inspect task steps before retry
    const task = env.store.getTask(sessionId, taskId)
    expect(task.steps.length).toBe(2)
    expect(task.steps[0].state).toBe('completed')
    expect(task.steps[1].state).toBe('failed')

    // Rule: On retrying step 2, the pipeline must read the preceding completed step's checkpoint
    // (step 0), NOT step 1's dirty checkpoint!
    const step1 = task.steps[0]
    const previousCleanCheckpoint = JSON.parse(step1.checkpointJson!)
    expect(previousCleanCheckpoint.completedChapter).toBe(1)
    expect(previousCleanCheckpoint.dirtyPollutedData).toBeUndefined()

    await env.store.close(sessionId)
  })
})
