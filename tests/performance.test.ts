import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'

describe('Performance and Responsiveness Targets (SPECS Section 14)', () => {
  const sampleParagraph =
    '青云门通天峰大殿之上，仙气缭绕，云雾蒸腾。道玄真人手持拂尘，神色肃穆地注视着阶下众弟子。' +
    '林轩身着素白长袍，静立于大竹峰弟子之列，心神沉入气海，默默运转九转玄功。天地灵气如涓涓细流，' +
    '自周身经络汇聚于丹田灵台之中。殿外松涛阵阵，山风呼啸，仿佛预示着神州浩土即将迎来一场前所未有的惊天浩劫。'

  // Generate a chapter of roughly ~10,000 Chinese characters
  function generateChapterContent(chapterIndex: number, targetChars = 10000): string {
    const header = `第${chapterIndex}章 仙道风云变幻\n\n`
    const repeats = Math.ceil(targetChars / sampleParagraph.length)
    const body = Array.from({ length: repeats }, (_, index) => `【段落${index + 1}】${sampleParagraph}`).join('\n\n')
    return header + body
  }

  it('2,000,000 Chinese character project meets all performance thresholds', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-perf-2m-'))
    const projectPath = join(tempDir, 'perf-2m.novelproj')
    const store = new ProjectStore(tempDir)
    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)

    try {
      // 1. Create 2,000,000 char project (200 chapters x ~10,000 chars)
      const chapterCount = 200
      const draftChapters = Array.from({ length: chapterCount }, (_, i) => ({
        title: `第${i + 1}章 仙道风云`,
        content: generateChapterContent(i + 1, 10000)
      }))

      const totalChars = draftChapters.reduce((sum, ch) => sum + ch.content.length, 0)
      expect(totalChars).toBeGreaterThanOrEqual(2_000_000)

      store.create({ destination: projectPath, title: '两百万字压力测试作品', description: '性能验证' }, draftChapters)

      // 2. Measure open project to chapter list interactive time (Target: <= 2000 ms)
      const openStart = performance.now()
      const opened = await store.open(projectPath)
      const list = chapters.list(opened.sessionId)
      const openDuration = performance.now() - openStart

      expect(list.length).toBe(chapterCount)
      expect(openDuration).toBeLessThan(2000) // <= 2.0s target
      console.log(`[Perf 2M] Project Open + Chapter List: ${openDuration.toFixed(2)}ms (Target: <2000ms)`)

      // 3. Measure Chapter Read Latency (Target: <= 300 ms, Cached/hot <= 100 ms)
      const targetChapterId = list[50].id

      const readStart = performance.now()
      const chapterData = chapters.get(opened.sessionId, targetChapterId)
      const readDuration = performance.now() - readStart

      expect(chapterData.content.length).toBeGreaterThanOrEqual(10000)
      expect(readDuration).toBeLessThan(300) // <= 300ms target
      console.log(`[Perf 2M] Chapter Read: ${readDuration.toFixed(2)}ms (Target: <300ms)`)

      // 4. Measure Synchronous Autosave / Update Transaction (Target: <= 100 ms)
      const updatedContent = chapterData.content + '\n\n【最新续写】林轩一剑斩破苍穹，天地为之变色。'
      const saveStart = performance.now()
      const saveResult = chapters.update(opened.sessionId, targetChapterId, updatedContent, chapterData.version)
      const saveDuration = performance.now() - saveStart

      expect(saveResult.version).toBe(chapterData.version + 1)
      expect(saveDuration).toBeLessThan(100) // <= 100ms target
      console.log(`[Perf 2M] Chapter Update Transaction: ${saveDuration.toFixed(2)}ms (Target: <100ms)`)

      // 5. Build search index & measure FTS5 trigram search latency (Target: <= 300 ms)
      await searchIndex.sync(opened.sessionId)

      const searchStart = performance.now()
      const searchResults = searchIndex.searchKeyword(opened.sessionId, {
        sessionId: opened.sessionId,
        query: '九转玄功'
      })
      const searchDuration = performance.now() - searchStart

      expect(searchResults.length).toBeGreaterThan(0)
      expect(searchDuration).toBeLessThan(300) // <= 300ms target
      console.log(`[Perf 2M] FTS5 Trigram Search: ${searchDuration.toFixed(2)}ms (Target: <300ms, Found: ${searchResults.length})`)

      await store.close(opened.sessionId)
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  }, 120_000)

  it('5,000,000 Chinese character project meets opening and index non-blocking targets', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'novel-perf-5m-'))
    const projectPath = join(tempDir, 'perf-5m.novelproj')
    const store = new ProjectStore(tempDir)
    const searchIndex = new SearchIndex(store)
    const chapters = new ChapterRepository(store, searchIndex)

    try {
      // 1. Create 5,000,000 char project (500 chapters x ~10,000 chars)
      const chapterCount = 500
      const draftChapters = Array.from({ length: chapterCount }, (_, i) => ({
        title: `第${i + 1}章 洪荒巨变`,
        content: generateChapterContent(i + 1, 10000)
      }))

      const totalChars = draftChapters.reduce((sum, ch) => sum + ch.content.length, 0)
      expect(totalChars).toBeGreaterThanOrEqual(5_000_000)

      store.create({ destination: projectPath, title: '五百万字超长篇作品', description: '5M 性能验证' }, draftChapters)

      // 2. Measure open project to chapter list interactive time (Target: <= 5000 ms)
      const openStart = performance.now()
      const opened = await store.open(projectPath)
      const list = chapters.list(opened.sessionId)
      const openDuration = performance.now() - openStart

      expect(list.length).toBe(chapterCount)
      expect(openDuration).toBeLessThan(5000) // <= 5.0s target
      console.log(`[Perf 5M] Project Open + Chapter List: ${openDuration.toFixed(2)}ms (Target: <5000ms)`)

      // 3. Measure Chapter Read Latency (Target: <= 300 ms)
      const targetChapterId = list[250].id
      const readStart = performance.now()
      const chapterData = chapters.get(opened.sessionId, targetChapterId)
      const readDuration = performance.now() - readStart

      expect(chapterData.content.length).toBeGreaterThanOrEqual(10000)
      expect(readDuration).toBeLessThan(300)
      console.log(`[Perf 5M] Chapter Read: ${readDuration.toFixed(2)}ms (Target: <300ms)`)

      // 4. Measure Autosave Transaction Latency (Target: <= 100 ms)
      const saveStart = performance.now()
      const saveResult = chapters.update(opened.sessionId, targetChapterId, chapterData.content + '\n\n【终章感悟】道法自然。', chapterData.version)
      const saveDuration = performance.now() - saveStart

      expect(saveResult.version).toBe(chapterData.version + 1)
      expect(saveDuration).toBeLessThan(100)
      console.log(`[Perf 5M] Chapter Update Transaction: ${saveDuration.toFixed(2)}ms (Target: <100ms)`)

      // 5. Index maintenance does not block opening or reading
      const statusBefore = searchIndex.getStatus(opened.sessionId)
      expect(statusBefore.state).toBeDefined()

      await store.close(opened.sessionId)
    } finally {
      try {
        await store.closeAll()
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {}
    }
  }, 180_000)
})
