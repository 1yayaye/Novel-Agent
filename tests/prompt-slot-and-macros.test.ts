import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ContextAssembler, expandMacros } from '../src/main/context-assembler'
import { PromptSettingsStore } from '../src/main/prompt-store'
import { DEFAULT_PRESET_STORE, type NovelPromptPreset } from '../src/shared/prompt-settings'
import { parseCreationOutput } from '../src/main/creation-runner'
import { CreativeRepository } from '../src/main/creative-repository'
import { KnowledgeRepository } from '../src/main/knowledge-repository'

describe('Prompt material boundaries and author macros', () => {
  let tempDir: string
  let store: ProjectStore
  let promptStore: PromptSettingsStore
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
    tempDir = mkdtempSync(join(tmpdir(), 'novel-prompt-slot-test-'))
    promptStore = new PromptSettingsStore(tempDir)
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    creativeRepo = new CreativeRepository(store, searchIndex)
    knowledgeRepo = new KnowledgeRepository(store, searchIndex)
    assembler = new ContextAssembler(store, promptStore, searchIndex, connStore)

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

    const projectPath = join(tempDir, 'test-prompt.novelproj')
    store.create({ destination: projectPath, title: '凡人修仙传', description: '测试项目' }, [
      {
        title: '第一章 拜入宗门',
        content: '第一段：韩立收拾行囊离开五里沟。\n\n第二段：山道崎岖，白云缭绕。\n\n第三段：七玄门山门巍峨耸立。'
      },
      {
        title: '第二章 山谷异事',
        content: '二愣子在神手谷后山采药，偶得一尊神秘小瓶。他端详着瓶身，心中疑惑不解。'
      }
    ])

    const opened = await store.open(projectPath)
    sessionId = opened.sessionId

    const chapters = chapterRepo.list(sessionId)
    chapter1Id = chapters[0].id
    chapter2Id = chapters[1].id

    // Setup knowledge entries with aliases
    knowledgeRepo.createEntry(sessionId, {
      kind: 'character',
      title: '韩立',
      aliases: ['二愣子', '韩跑跑', '韩师弟'],
      authorContent: '本作主角，坚毅低调，杀伐果断，心思缜密。'
    })

    knowledgeRepo.createEntry(sessionId, {
      kind: 'world',
      title: '掌天瓶',
      aliases: ['绿瓶', '神秘小瓶'],
      authorContent: '太古玄天之宝，可吸收月华凝聚参天造化露。'
    })

    // Setup rules & synopsis
    creativeRepo.updateRules(sessionId, '【全书禁忌】主角不得无脑装逼，注重因果。', 1)
  })

  afterEach(async () => {
    try {
      await store.closeAll()
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('dynamically triggers Knowledge Entries via Lorebook Aliases matching', async () => {
    // Chapter 2 text contains "二愣子" (alias for 韩立) and "神秘小瓶" (alias for 掌天瓶)
    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter2Id },
      instruction: '写一段研究小瓶的心理活动'
    })

    const hanLiItem = pkg.items.find((i) => i.title?.includes('韩立'))
    const bottleItem = pkg.items.find((i) => i.title?.includes('掌天瓶'))

    expect(hanLiItem).toBeDefined()
    expect(hanLiItem?.activationKey).toBe('二愣子')
    expect(hanLiItem?.content).toContain('坚毅低调')

    expect(bottleItem).toBeDefined()
    expect(bottleItem?.activationKey).toBe('神秘小瓶')
    expect(bottleItem?.content).toContain('太古玄天之宝')
  })

  it('correctly expands whitelisted macro variables in author instructions', () => {
    const warnings: string[] = []
    const template = '章节: {{chapter_title}}, 规则: {{creative_rules}}, 前文段落: [{{previous_paragraphs count=2}}], 人物: [{{character_card name="韩立"}}], 未知: {{custom_foo}}'

    const expanded = expandMacros(
      template,
      {
        chapterTitle: '第一章 拜入宗门',
        chapterNumber: 1,
        targetLength: 1000,
        targetText: '段落A\n\n段落B\n\n段落C',
        creativeRules: '主角谨慎低调',
        bookSynopsis: '长生大纲',
        authorInstruction: '续写',
        store,
        sessionId
      },
      warnings
    )

    expect(expanded).toContain('章节: 第一章 拜入宗门')
    expect(expanded).toContain('规则: 主角谨慎低调')
    expect(expanded).toContain('前文段落: [段落B\n\n段落C]')
    expect(expanded).toContain('人物: [本作主角，坚毅低调，杀伐果断，心思缜密。]')
    expect(expanded).toContain('未知: {{custom_foo}}')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('未知宏变量: {{custom_foo}}')
  })

  it('correctly parses tagged output and cleanly extracts content separately from reasoning and summary, and plot options', () => {
    const rawTagged = `
<thinking>
1. 检查人设：韩立坚毅低调，不张扬。
2. 视角确认：第三人称限制视角。
3. 伏笔：小瓶开始凝聚绿液。
</thinking>

<content>
月华如水，透过神手谷上方的树梢斑驳洒下。
韩立屏住呼吸，小心翼翼地握住墨绿色小瓶，只见瓶身上那些繁复的符文仿佛活了过来。
</content>

<summary>
【本章摘要】韩立在神手谷月夜下观察神秘小瓶，发现小瓶开始发生异变。
</summary>

<plot_options>
1. 绿液凝聚成水滴，韩立尝试给院中枯萎的药草滴下。
2. 远方神手谷传来墨大夫轻微的咳嗽声，韩立立刻将小瓶藏入怀中。
3. 小瓶散发出微弱灵气波动，引起谷中野兽骚动。
</plot_options>
`
    const parsed = parseCreationOutput(rawTagged)

    expect(parsed).not.toHaveProperty('thinking')
    expect(parsed.content).toContain('月华如水，透过神手谷上方的树梢斑驳洒下。')
    expect(parsed.content).not.toContain('<thinking>')
    expect(parsed.content).not.toContain('<summary>')
    expect(parsed.summary).toContain('【本章摘要】韩立在神手谷月夜下观察神秘小瓶')
    expect(parsed.plotOptions?.length).toBe(3)
    expect(parsed.plotOptions?.[0]).toContain('绿液凝聚成水滴')

    // Test fallback when no tags are provided
    const rawPlain = '秋风萧瑟，残阳如血。韩立一步步走上七玄门的山道。'
    const parsedPlain = parseCreationOutput(rawPlain)
    expect(parsedPlain.content).toBe(rawPlain)
    expect(parsed).not.toHaveProperty('thinking')
    expect(parsedPlain.summary).toBeUndefined()
  })


  it('freezes settings and invalidates unstarted previews without current options', async () => {
    const testPreset: NovelPromptPreset = {
      id: 'test-preset',
      name: '测试预设',
      blocks: [
        { id: 'b1', name: '系统创作设定', role: 'system', content: '测试提示词正文', enabled: true, position: 'relative', depth: 0, order: 0 }
      ],
      createdAt: 1,
      updatedAt: 1
    }
    promptStore.save({ activePresetId: 'test-preset', presets: [testPreset] })
    const input = { sessionId, connectionId: connId, taskType: 'continue' as const,
      target: { chapterId: chapter1Id }, instruction: '承接前文' }
    const pkg = await assembler.assembleContext(input)
    expect(pkg.items.some((item) => item.moduleId === 'b1')).toBe(true)
    promptStore.save({ activePresetId: 'test-preset', presets: [{ ...testPreset, blocks: [{ ...testPreset.blocks[0], enabled: false }] }] })
    expect(() => assembler.verifyContextPackage(sessionId, pkg.id)).toThrow(expect.objectContaining({ code: 'STALE_CONTEXT_PACKAGE' }))
    const frozen = assembler.getContextPackage({ sessionId, contextPackageId: pkg.id })
    expect(frozen.messages).toEqual(pkg.messages)
    const fresh = await assembler.assembleContext(input)
    expect(fresh.items.some((item) => item.moduleId === 'b1')).toBe(false)
    expect(fresh.configurationFingerprint).not.toBe(pkg.configurationFingerprint)
  })

  it('counts real history roles and excludes current author message from history', async () => {
    store.transaction(sessionId, (db) => {
      db.prepare("INSERT INTO chat_session(id,title,version,created_at,updated_at) VALUES ('history','角色历史',1,1,1)").run()
      const insert = db.prepare("INSERT INTO chat_message(id,chat_session_id,role,content,state,created_at) VALUES (?,'history',?,?,'completed',?)")
      insert.run('old-user','user','作者决定保留秘密',1)
      insert.run('old-assistant','assistant','建议通过误会推进',2)
      insert.run('current-user','user','规划本章',3)
      db.prepare("INSERT INTO chat_summary(id,chat_session_id,content,version,created_at,updated_at) VALUES ('summary','history','先前的作者决定',1,0,0)").run()
    })
    const pkg = await assembler.assembleContext({ sessionId, connectionId: connId, taskType: 'chat', stage: 'direction',
      target: { chapterId: chapter1Id, chatId: 'history' }, instruction: '规划本章' }, undefined, 'current-user')
    const messages = pkg.messages
    expect(messages.filter((message) => message.content.includes('规划本章'))).toHaveLength(1)
    const userIndex = messages.findIndex((message) => message.content === '作者决定保留秘密')
    const assistantIndex = messages.findIndex((message) => message.content === '建议通过误会推进')
    expect(messages[userIndex].role).toBe('user')
    expect(messages[assistantIndex].role).toBe('assistant')
    expect(assistantIndex).toBe(userIndex + 1)
    expect(messages[assistantIndex + 1].content).toContain('【本次作者任务】')
    expect(messages.at(-1)?.content).toContain('【本次作者任务】')
  })

  it('trims oldest history first and budgets the complete transmitted messages', async () => {
    const oldest = '较早的讨论。'.repeat(200)
    store.transaction(sessionId, (db) => {
      db.prepare("INSERT INTO chat_session(id,title,version,created_at,updated_at) VALUES ('trim-history','预算历史',1,1,1)").run()
      const insert = db.prepare("INSERT INTO chat_message(id,chat_session_id,role,content,state,created_at) VALUES (?,'trim-history',?,?,'completed',?)")
      insert.run('oldest', 'user', oldest, 1)
      insert.run('recent-assistant', 'assistant', '保留最近的讨论', 2)
      insert.run('recent-user', 'user', '最新作者决定', 3)
    })
    const input = { sessionId, connectionId: connId, taskType: 'chat' as const, stage: 'direction' as const,
      target: { chapterId: chapter1Id, chatId: 'trim-history' }, instruction: '规划本章' }
    const full = await assembler.assembleContext(input)
    const connection = connStore.get(connId)
    connStore.update({ connectionId: connId, expectedVersion: connection.version,
      contextWindow: full.estimatedInputTokens + connection.maxOutputTokens,
      safetyMarginRatio: 0 })
    // A short added author request forces one history message out of the frozen budget.
    const trimmed = await assembler.assembleContext({ ...input, instruction: '规划本章，并明确角色在场景中的行动选择和后果。' })
    expect(trimmed.excludedItems.some((item) => item.sourceId === 'oldest')).toBe(true)
    const history = trimmed.messages.filter((message) => ['保留最近的讨论', '最新作者决定', oldest].includes(message.content))
    expect(history.map((message) => message.content)).toEqual(['保留最近的讨论', '最新作者决定'])
    expect(history.map((message) => message.role)).toEqual(['assistant', 'user'])
    const completeEstimate = trimmed.messages.reduce((total, message) => total + Math.ceil(message.content.length * connection.tokenEstimationRatio) + 4, 2)
    expect(trimmed.estimatedInputTokens).toBe(completeEstimate)
    expect(completeEstimate).toBeLessThanOrEqual(trimmed.availableInputTokens)
  })

  it('rejects a material change and a connection budget change before execution', async () => {
    const sample = creativeRepo.createSample(sessionId, '样本', '只参考表达方式', [])
    const input = { sessionId, connectionId: connId, taskType: 'continue' as const,
      target: { chapterId: chapter1Id }, styleSampleIds: [sample.id], instruction: '续写' }
    const pkg = await assembler.assembleContext(input)
    creativeRepo.updateSample(sessionId, sample.id, sample.name, '已修改表达方式', sample.tags, sample.version)
    expect(() => assembler.verifyContextPackage(sessionId, pkg.id)).toThrow(expect.objectContaining({ code: 'STALE_CONTEXT_PACKAGE' }))
    const fresh = await assembler.assembleContext(input)
    const connection = connStore.get(connId)
    connStore.update({ connectionId: connId, expectedVersion: connection.version, maxOutputTokens: 3000 })
    expect(() => assembler.verifyContextPackage(sessionId, fresh.id)).toThrow(expect.objectContaining({ code: 'STALE_CONTEXT_PACKAGE' }))
  })
})
