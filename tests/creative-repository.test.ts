import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CreativeRepository } from '../src/main/creative-repository'
import { ProjectStore } from '../src/main/project-store'
import { SearchIndex } from '../src/main/search-index'

const folders: string[] = []
const stores: ProjectStore[] = []

function fixture() {
  const folder = join(tmpdir(), `novel-agent-creative-${randomUUID()}`)
  mkdirSync(folder)
  folders.push(folder)
  const data = join(folder, 'data')
  mkdirSync(data)
  const project = join(folder, 'story.novelproj')
  const store = new ProjectStore(data)
  stores.push(store)
  store.create({ destination: project, title: '测试作品', description: '测试描述' }, [
    { title: '第一章', content: '第一章的正文内容' }
  ])
  const searchIndex = new SearchIndex(store)
  const repository = new CreativeRepository(store, searchIndex)
  return { folder, project, store, searchIndex, repository }
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try { await store.closeAll() } catch {}
  }
  for (const folder of folders.splice(0)) {
    try { rmSync(folder, { recursive: true, force: true }) } catch {}
  }
})

describe('CreativeRepository - Creative Rules', () => {
  it('gets and updates creative rules with optimistic concurrency control', async () => {
    const { project, store, repository } = fixture()
    const opened = await store.open(project)

    // Initial state has default seeded rules
    const initial = repository.getRules(opened.sessionId)
    expect(initial.content).toContain('全书核心创作准则')
    expect(initial.version).toBe(1)

    // Update with correct expectedVersion
    const updated = repository.updateRules(opened.sessionId, '长篇奇幻小说，禁止出现现代网络用语', 1)
    expect(updated.content).toBe('长篇奇幻小说，禁止出现现代网络用语')
    expect(updated.version).toBe(2)

    // Conflict when using old version
    expect(() => {
      repository.updateRules(opened.sessionId, '试图用旧版本覆盖', 1)
    }).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))

    // Update again with next version
    const updated2 = repository.updateRules(opened.sessionId, '长篇奇幻小说，禁止出现现代网络用语，注重心境描写', 2)
    expect(updated2.version).toBe(3)

    store.close(opened.sessionId)
  })

  it('triggers FTS search index sync when creative rules update', async () => {
    const { project, store, repository, searchIndex } = fixture()
    const opened = await store.open(project)

    repository.updateRules(opened.sessionId, '全书必须遵循严谨的修仙境界设定，炼气筑基金丹元婴', 1)
    await searchIndex.sync(opened.sessionId)

    const searchResults = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '修仙境界',
      filters: { sourceTypes: ['creative_rules'] }
    })

    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0].sourceType).toBe('creative_rules')
    expect(searchResults[0].title).toBe('创作规则')
    expect(searchResults[0].excerpt).toContain('修仙境界')

    store.close(opened.sessionId)
  })
})

describe('CreativeRepository - Style Samples', () => {
  it('creates, lists, gets, updates, and deletes style samples with version checks', async () => {
    const { project, store, repository, searchIndex } = fixture()
    const opened = await store.open(project)

    // Create style sample
    const sample = repository.createSample(
      opened.sessionId,
      '激战风格样本',
      '剑气纵横三万里，一剑光寒十九洲。狂风呼啸，沙尘漫天。',
      ['打斗', '豪放']
    )
    expect(sample.id).toBeDefined()
    expect(sample.name).toBe('激战风格样本')
    expect(sample.tags).toEqual(['打斗', '豪放'])
    expect(sample.version).toBe(1)

    // List
    const list = repository.listSamples(opened.sessionId)
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list.some((s) => s.id === sample.id)).toBe(true)

    // Get
    const fetched = repository.getSample(opened.sessionId, sample.id)
    expect(fetched.name).toBe('激战风格样本')

    // Update with correct version
    const updated = repository.updateSample(
      opened.sessionId,
      sample.id,
      '激战与对决风格样本',
      '剑气纵横三万里，一剑光寒十九洲。雷霆交加，苍穹变色。',
      ['打斗', '仙侠'],
      1
    )
    expect(updated.version).toBe(2)
    expect(updated.tags).toEqual(['打斗', '仙侠'])

    // Update with wrong version
    expect(() => {
      repository.updateSample(opened.sessionId, sample.id, '非法覆盖', '内容', [], 1)
    }).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }))

    // FTS verification
    await searchIndex.sync(opened.sessionId)
    const results = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '剑气纵横',
      filters: { sourceTypes: ['style_sample'] }
    })
    expect(results.length).toBe(1)
    expect(results[0].sourceType).toBe('style_sample')
    expect(results[0].title).toBe('激战与对决风格样本')

    // Delete with correct version
    const deleteRes = repository.deleteSample(opened.sessionId, sample.id, 2)
    expect(deleteRes.success).toBe(true)
    expect(repository.listSamples(opened.sessionId).some((s) => s.id === sample.id)).toBe(false)

    // FTS cleaned up after sync
    await searchIndex.sync(opened.sessionId)
    const afterDeleteResults = searchIndex.searchKeyword(opened.sessionId, {
      sessionId: opened.sessionId,
      query: '剑气纵横',
      filters: { sourceTypes: ['style_sample'] }
    })
    expect(afterDeleteResults).toHaveLength(0)

    store.close(opened.sessionId)
  })
})

describe('CreativeRepository - Instruction Presets', () => {
  it('supports full CRUD for instruction presets and filters by task type', async () => {
    const { project, store, repository } = fixture()
    const opened = await store.open(project)

    // Create continue preset
    const preset1 = repository.createPreset(
      opened.sessionId,
      'continue',
      '战斗场景续写',
      '着重描写动作细节与感官刺激，节奏加快，多用短句。'
    )
    expect(preset1.id).toBeDefined()
    expect(preset1.taskType).toBe('continue')
    expect(preset1.version).toBe(1)

    // Create polish preset
    const preset2 = repository.createPreset(
      opened.sessionId,
      'polish',
      '古风修辞润色',
      '增加文言词汇与意境烘托，避免现代口语。'
    )
    expect(preset2.taskType).toBe('polish')

    // Filter list
    const continuePresets = repository.listPresets(opened.sessionId, 'continue')
    expect(continuePresets.some((p) => p.name === '战斗场景续写')).toBe(true)

    const allPresets = repository.listPresets(opened.sessionId)
    expect(allPresets.length).toBeGreaterThanOrEqual(2)

    // Update preset
    const updated = repository.updatePreset(
      opened.sessionId,
      preset1.id,
      '高燃战斗场景续写',
      '着重描写招式碰撞、灵力波动与声光效果。',
      1
    )
    expect(updated.version).toBe(2)
    expect(updated.name).toBe('高燃战斗场景续写')

    // Delete preset
    const delRes = repository.deletePreset(opened.sessionId, preset1.id, 2)
    expect(delRes.success).toBe(true)
    expect(repository.listPresets(opened.sessionId, 'continue').some((p) => p.id === preset1.id)).toBe(false)

    store.close(opened.sessionId)
  })
})
