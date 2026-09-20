import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ChapterRepository } from '../src/main/chapter-repository'
import { SearchIndex } from '../src/main/search-index'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { ContextAssembler, expandMacros, compileDirectorControls } from '../src/main/context-assembler'
import { parseCreationOutput } from '../src/main/creation-runner'
import { CreativeRepository } from '../src/main/creative-repository'
import { KnowledgeRepository } from '../src/main/knowledge-repository'

describe('PromptSlot, Macros, Lorebook Aliases & Director Controls (SPEC v2.0)', () => {
  let tempDir: string
  let store: ProjectStore
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
    store = new ProjectStore(tempDir)
    connStore = new ConnectionStore(tempDir)
    searchIndex = new SearchIndex(store)
    chapterRepo = new ChapterRepository(store, searchIndex)
    creativeRepo = new CreativeRepository(store, searchIndex)
    knowledgeRepo = new KnowledgeRepository(store, searchIndex)
    assembler = new ContextAssembler(store, searchIndex, connStore)

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

  it('compiles and orders PromptSlots across before_context, after_context and absolute_depth', async () => {
    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '描写韩立通过考核',
      slots: [
        {
          id: 'slot-1',
          name: '前置身份增强',
          enabled: true,
          role: 'system',
          content: '【前置强化】你是金牌网文主编，精通节奏调控。',
          position: 'before_context',
          order: 5,
          trigger: 'always'
        },
        {
          id: 'slot-2',
          name: '禁用Slot',
          enabled: false,
          role: 'system',
          content: '【此条不应出现】',
          position: 'before_context',
          order: 1
        },
        {
          id: 'slot-3',
          name: '深度注入Prompt',
          enabled: true,
          role: 'user',
          content: '【深度提示】此处主角应表现出内敛隐忍的眼神细节。',
          position: 'absolute_depth',
          depth: 2,
          order: 1,
          trigger: 'creation'
        },
        {
          id: 'slot-4',
          name: '临门一脚指令',
          enabled: true,
          role: 'system',
          content: '【即时要求】文末以悬念收尾。',
          position: 'after_context',
          order: 10
        }
      ]
    })

    expect(pkg.systemMessage).toContain('【前置强化】你是金牌网文主编')
    expect(pkg.systemMessage).not.toContain('【此条不应出现】')
    expect(pkg.userMessage).toContain('【深度提示】此处主角应表现出内敛隐忍的眼神细节。')
    expect(pkg.userMessage).toContain('【即时要求】文末以悬念收尾。')

    const slotItems = pkg.items.filter((i) => i.sourceType === 'prompt_slot')
    expect(slotItems.length).toBe(3)
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

  it('correctly expands whitelisted macro variables in instructions and slots', () => {
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

  it('compiles Director Controls into PromptSlots and enforces configuration fingerprint change', async () => {
    const pkg1 = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '写一段试炼'
    })

    const pkg2 = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '写一段试炼',
      directorControls: {
        pov: 'limited_3p',
        sensory: 'strict',
        pacing: 'fast',
        banWords: ['极其', '共犯', '眼神一暗'],
        enableCoT: true
      }
    })

    // Fingerprints must differ when DirectorControls are active
    expect(pkg1.configurationFingerprint).not.toBe(pkg2.configurationFingerprint)

    // Check compiled director controls in message
    expect(pkg2.userMessage).toContain('【叙事视角】第三人称主角限制视角')
    expect(pkg2.userMessage).toContain('【感官边界】严格防全知边界')
    expect(pkg2.userMessage).toContain('【叙事节奏】快节奏推进')
    expect(pkg2.userMessage).toContain('【禁忌词汇】严禁在生成中使用以下词汇或八股句式：极其、共犯、眼神一暗')
    expect(pkg2.userMessage).toContain('【写前推演】')
  })

  it('correctly parses tagged output and cleanly extracts content, thinking, summary, and plot options', () => {
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

    expect(parsed.thinking).toContain('检查人设：韩立坚毅低调')
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
    expect(parsedPlain.thinking).toBeUndefined()
    expect(parsedPlain.summary).toBeUndefined()
  })

  it('triggers fingerprint change when slot order in array changes even if order number is identical', async () => {
    const slotA = {
      id: 'slot-a',
      name: '插槽A',
      enabled: true,
      role: 'system' as const,
      content: '规则A',
      position: 'before_context' as const,
      order: 0
    }
    const slotB = {
      id: 'slot-b',
      name: '插槽B',
      enabled: true,
      role: 'system' as const,
      content: '规则B',
      position: 'before_context' as const,
      order: 0
    }

    const pkg1 = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '测试指纹变动',
      slots: [slotA, slotB]
    })

    const pkg2 = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '测试指纹变动',
      slots: [slotB, slotA]
    })

    expect(pkg1.configurationFingerprint).not.toBe(pkg2.configurationFingerprint)
  })

  it('correctly executes slot roles and in-chat absolute_depth message insertion into messages array', async () => {
    const pkg = await assembler.assembleContext({
      sessionId,
      connectionId: connId,
      taskType: 'continue',
      target: { chapterId: chapter1Id },
      instruction: '描写韩立通过考核',
      slots: [
        {
          id: 'slot-sys-before',
          name: '系统前置增强',
          enabled: true,
          role: 'system',
          content: '【系统前置】你是修仙小说宗师。',
          position: 'before_context',
          order: 1
        },
        {
          id: 'slot-user-before',
          name: '用户前置引子',
          enabled: true,
          role: 'user',
          content: '【背景引子】前情回顾：七玄门招收弟子。',
          position: 'before_context',
          order: 2
        },
        {
          id: 'slot-depth-1',
          name: '深度为1的系统插槽',
          enabled: true,
          role: 'system',
          content: '【深度1约束】严控心理活动描写篇幅。',
          position: 'absolute_depth',
          depth: 1,
          order: 1
        },
        {
          id: 'slot-depth-0',
          name: '深度为0的助手Prefill插槽',
          enabled: true,
          role: 'assistant',
          content: '【开篇接续】狂风呼啸，',
          position: 'absolute_depth',
          depth: 0,
          order: 1
        }
      ]
    })

    expect(pkg.messages.length).toBeGreaterThanOrEqual(4)

    // First message should be system containing '【系统前置】你是修仙小说宗师。'
    expect(pkg.messages[0].role).toBe('system')
    expect(pkg.messages[0].content).toContain('【系统前置】你是修仙小说宗师。')

    // Second message should be user containing '【背景引子】'
    expect(pkg.messages[1].role).toBe('user')
    expect(pkg.messages[1].content).toContain('【背景引子】前情回顾')

    // Depth 0 assistant slot must be at the very end of messages
    const lastMsg = pkg.messages[pkg.messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content).toBe('【开篇接续】狂风呼啸，')

    // Main user context message is before the depth 0 assistant slot
    const secondToLastMsg = pkg.messages[pkg.messages.length - 2]
    expect(secondToLastMsg.role).toBe('user')
    expect(secondToLastMsg.content).toContain('描写韩立通过考核')

    // Depth 1 system slot is placed before the main user context message
    const thirdToLastMsg = pkg.messages[pkg.messages.length - 3]
    expect(thirdToLastMsg.role).toBe('system')
    expect(thirdToLastMsg.content).toBe('【深度1约束】严控心理活动描写篇幅。')
  })
})
