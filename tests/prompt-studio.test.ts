import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import { SearchIndex } from '../src/main/search-index'
import { ChapterRepository } from '../src/main/chapter-repository'
import { ModelGateway } from '../src/main/model-gateway'
import { PromptSettingsStore } from '../src/main/prompt-store'
import { createServiceRouter, type ServiceRouter } from '../src/main/service-router'
import { createNovelAgentApi } from '../src/shared/platform-bridge/api-factory'
import { DEFAULT_PRESET_STORE, type PresetStoreData, type NovelPromptPreset } from '../src/shared/prompt-settings'
import { NovelAgentError, type IpcTransport } from '../src/shared/platform-bridge/transport'
import { type CandidateDoneEvent, type ContextPackage, type NovelAgentApi } from '../src/shared/project'

function bridge(router: ServiceRouter): NovelAgentApi {
  const transport: IpcTransport = {
    async invoke(channel, payload) {
      const result = await router.handle(channel, payload)
      if (!result.ok) {
        const error = result.error as { code: string; message: string }
        throw new NovelAgentError(error.code, error.message)
      }
      return result.value
    },
    on(channel, callback) {
      return router.onEvent((event) => { if (event.channel === channel) callback(event.payload) })
    }
  }
  return createNovelAgentApi(transport)
}

function samplePreset(): NovelPromptPreset {
  return {
    id: 'preset-1',
    name: '酒馆狐神抚预设',
    description: '用于长篇测试',
    blocks: [
      { id: 'b1', name: '系统设定', role: 'system', content: '酒馆小说创作专用提示词', enabled: true, position: 'relative', depth: 0, order: 0 },
      { id: 'b2', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 1, marker: 'marker.history' },
      { id: 'b3', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.task' }
    ],
    createdAt: 1000,
    updatedAt: 1000
  }
}

function sampleStore(): PresetStoreData {
  return {
    activePresetId: 'preset-1',
    presets: [samplePreset()]
  }
}

let tempDir: string
let promptStore: PromptSettingsStore
beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'novel-global-prompts-')) })
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('全局创作设置公共API与持久化', () => {
  let store: ProjectStore
  let router: ServiceRouter
  let api: NovelAgentApi
  beforeEach(() => {
    promptStore = new PromptSettingsStore(tempDir)
    store = new ProjectStore(tempDir)
    router = createServiceRouter({ store, promptStore })
    api = bridge(router)
  })
  afterEach(async () => { await router.dispose() })

  it('无需项目session读取预设库和保存预设，重启读取，返回值不能改变store', async () => {
    expect((await api.prompt.getPresetStore()).store).toEqual(DEFAULT_PRESET_STORE)
    const saved = await api.prompt.savePresetStore(sampleStore())
    expect(saved.store).toEqual(sampleStore())
    expect(JSON.parse(readFileSync(join(tempDir, 'prompt-presets.json'), 'utf8'))).toEqual(sampleStore())
    saved.store.presets[0].name = '被污染的名称'
    expect(promptStore.get().store.presets[0].name).toBe('酒馆狐神抚预设')
    promptStore = new PromptSettingsStore(tempDir)
    await router.dispose()
    router = createServiceRouter({ store, promptStore })
    api = bridge(router)
    expect((await api.prompt.getPresetStore()).store).toEqual(sampleStore())
    for (const removed of ['prompt.getModules', 'prompt.getSettings', 'prompt.saveSettings', 'prompt.getAssets', 'prompt.saveAsset']) expect(router.has(removed)).toBe(false)
    expect(Object.keys(api.prompt).sort()).toEqual([
      'cancelPresetConversion',
      'getBundle',
      'getPresetConversionResult',
      'getPresetConversionStatus',
      'getPresetStore',
      'inspectPresetConversion',
      'onPresetConversionProgress',
      'parseTavernFile',
      'savePresetStore',
      'startPresetConversion'
    ])
  })

  it.each(['{坏json', JSON.stringify({ activePresetId: 123 }), JSON.stringify({ activePresetId: 'p1', presets: 'not_array' })])('损坏配置保留原文件，公开警告，成功保存后清除警告', async (content) => {
    writeFileSync(join(tempDir, 'prompt-presets.json'), content, 'utf8')
    promptStore = new PromptSettingsStore(tempDir)
    await router.dispose()
    router = createServiceRouter({ store, promptStore })
    api = bridge(router)
    const state = await api.prompt.getPresetStore()
    expect(state.store).toEqual(DEFAULT_PRESET_STORE)
    expect(state.warnings.length).toBeGreaterThan(0)
    expect(readFileSync(join(tempDir, 'prompt-presets.json'), 'utf8')).toBe(content)
    expect((await api.prompt.savePresetStore(sampleStore())).warnings).toEqual([])
  })

  it('写入失败返回明确错误且内存和磁盘设置均保持原值', async () => {
    await api.prompt.savePresetStore(DEFAULT_PRESET_STORE)
    const before = readFileSync(join(tempDir, 'prompt-presets.json'), 'utf8')
    mkdirSync(join(tempDir, 'prompt-presets.json.tmp'))
    await expect(api.prompt.savePresetStore(sampleStore())).rejects.toMatchObject({ code: 'DATABASE_ERROR' })
    expect((await api.prompt.getPresetStore()).store).toEqual(DEFAULT_PRESET_STORE)
    expect(readFileSync(join(tempDir, 'prompt-presets.json'), 'utf8')).toBe(before)
  })

  it('拒绝无效预设库结构，旧覆盖文件不迁移也不读取', async () => {
    const old = '{"overrides":{"base.continue":"旧覆盖内容"}}'
    writeFileSync(join(tempDir, 'prompts.json'), old, 'utf8')
    promptStore = new PromptSettingsStore(tempDir)
    await router.dispose()
    router = createServiceRouter({ store, promptStore })
    api = bridge(router)
    expect((await api.prompt.getPresetStore()).store).toEqual(DEFAULT_PRESET_STORE)
    expect(readFileSync(join(tempDir, 'prompts.json'), 'utf8')).toBe(old)
    const invalid = await router.handle('prompt.savePresetStore', { invalidField: true })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    const invalidType = await router.handle('prompt.savePresetStore', { activePresetId: 123, presets: [] })
    expect(invalidType).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  it('跨项目及只读项目共享全局设置，打开已有项目不会补种作品资料', async () => {
    const firstPath = join(tempDir, 'first.novelproj')
    const secondPath = join(tempDir, 'second.novelproj')
    for (const destination of [firstPath, secondPath]) store.create({ destination, title: '作品', description: '' }, [{ title: '第一章', content: '原文' }])
    const first = await store.open(firstPath)
    store.transaction(first.sessionId, (db) => {
      db.prepare("UPDATE project_meta SET creative_rules = ''").run()
      db.prepare('DELETE FROM instruction_preset').run()
      db.prepare('DELETE FROM style_sample').run()
    })
    store.close(first.sessionId)
    const reopened = await store.open(firstPath)
    const second = await store.open(secondPath)
    expect(reopened.sessionId).not.toBe(second.sessionId)
    await api.prompt.savePresetStore(sampleStore())
    const readOnlyStore = new ProjectStore(join(tempDir, 'readonly-data'))
    const readOnlyRouter = createServiceRouter({ store: readOnlyStore, promptStore })
    try {
      const readOnly = await readOnlyStore.open(firstPath)
      expect(readOnly.mode).toBe('read_only')
      const readOnlyApi = bridge(readOnlyRouter)
      expect((await readOnlyApi.prompt.getPresetStore()).store).toEqual(sampleStore())
      const updatedStore = { ...sampleStore(), activePresetId: null }
      await readOnlyApi.prompt.savePresetStore(updatedStore)
      expect((await api.prompt.getPresetStore()).store.activePresetId).toBeNull()
      const bundle = await api.prompt.getBundle({ sessionId: reopened.sessionId })
      expect(bundle.rules.content).toBe('')
      expect(bundle.presets).toEqual([])
      expect(bundle.styleSamples).toEqual([])
      expect(readOnlyStore.read(readOnly.sessionId, (db) => (db.prepare('SELECT count(*) AS count FROM instruction_preset').get() as { count: number }).count)).toBe(0)
    } finally { await readOnlyRouter.dispose() }
  })
})

describe('公共预览到HTTP/SSE候选与手动采用', () => {
  let server: ReturnType<typeof createServer>
  let store: ProjectStore
  let connectionStore: ConnectionStore
  let chapters: ChapterRepository
  let router: ServiceRouter
  let api: NovelAgentApi
  let sessionId: string
  let chapterId: string
  let connectionId: string
  let requests: Array<Record<string, unknown>>
  let respond: (response: ServerResponse) => void
  let requestReceived: Promise<void>
  let receiveRequest: () => void
  const original = '前缀。目标原文。后缀。'
  const replacement = '目标修改。'

  beforeEach(async () => {
    requests = []
    requestReceived = new Promise((resolve) => { receiveRequest = resolve })
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: replacement } }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    }
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += String(chunk) })
      request.on('end', () => {
        requests.push(JSON.parse(body))
        receiveRequest()
        respond(response)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器无端口')
    promptStore = new PromptSettingsStore(tempDir)
    connectionStore = new ConnectionStore(tempDir)
    const connection = connectionStore.create({ name: 'Gemini compatible test', kind: 'generation', isLocalService: true, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'gemini-test', contextWindow: 16000, maxOutputTokens: 1700, safetyMarginRatio: 0.1, tokenEstimationRatio: 1.3 })
    connectionId = connection.id
    connectionStore.confirmContentTarget(connectionId, calculateContentTargetFingerprint(connection.baseUrl, connection.model))
    store = new ProjectStore(tempDir, connectionStore)
    const searchIndex = new SearchIndex(store)
    chapters = new ChapterRepository(store, searchIndex)
    const projectPath = join(tempDir, 'http.novelproj')
    store.create({ destination: projectPath, title: '请求测试作品', description: '' }, [{ title: '第一章', content: original }])
    sessionId = (await store.open(projectPath)).sessionId
    chapterId = chapters.list(sessionId)[0].id
    router = createServiceRouter({ store, promptStore, connectionStore, modelGateway: new ModelGateway(connectionStore), searchIndexInstance: searchIndex })
    api = bridge(router)
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await router.dispose()
  })
  async function preview(): Promise<ContextPackage> {
    return api.context.preview({ sessionId, connectionId, taskType: 'polish', target: { chapterId, startOffset: 3, endOffset: 8 }, instruction: '润色所选目标，保持剧情事实。', creativity: 'high', targetLength: 350 })
  }
  function doneEvent() {
    return new Promise<CandidateDoneEvent>((resolve) => {
      const unsubscribe = api.candidate.onDone!((event) => { unsubscribe(); resolve(event) })
    })
  }
  async function readyCandidate() {
    const pkg = await preview()
    const done = doneEvent()
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    const event = await done
    expect(event.candidateId).toBe(started.candidateId)
    return { pkg, started, candidate: await api.candidate.get({ sessionId, candidateId: started.candidateId }) }
  }

  it('请求使用预览冻结messages和max_tokens且不传temperature，完成后正文不变，手动采用只替换选区', async () => {
    await api.prompt.savePresetStore(sampleStore())
    const { pkg, candidate } = await readyCandidate()
    expect(requests).toHaveLength(1)
    expect(requests[0].messages).toEqual(pkg.messages)
    expect(requests[0].max_tokens).toBe(1700)
    expect(requests[0]).not.toHaveProperty('temperature')
    expect(pkg.messages.at(-1)?.content).toContain('350')
    expect(pkg.messages.at(-1)?.content).toContain('探索范围')
    const persisted = await api.context.get({ sessionId, contextPackageId: pkg.id })
    expect(persisted.messages).toEqual(pkg.messages)
    expect(persisted.promptSnapshot).toEqual(pkg.promptSnapshot)
    expect(candidate.state).toBe('ready')
    expect(candidate.startOffset).toBe(3)
    expect(candidate.endOffset).toBe(8)
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version + 1, expectedChapterVersion: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 2 })).rejects.toMatchObject({ code: 'STALE_CANDIDATE' })
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    const applied = await api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 1 })
    expect(applied.chapter.content).toBe(original.slice(0, 3) + replacement + original.slice(8))
    expect(applied.chapter.version).toBe(2)
    expect(applied.candidate.state).toBe('applied')
    expect(applied.snapshot.permanent).toBe(true)
    expect(applied.snapshot.snapshotKind).toBe('ai_apply')
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: applied.candidate.version, expectedChapterVersion: 2 })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('全局设置变化使已预览包失效，重预览才能启动且不发送过期请求', async () => {
    const pkg = await preview()
    await api.prompt.savePresetStore(sampleStore())
    await expect(api.creation.start({ sessionId, contextPackageId: pkg.id })).rejects.toMatchObject({ code: 'STALE_CONTEXT_PACKAGE' })
    expect(requests).toEqual([])
    expect((await api.context.get({ sessionId, contextPackageId: pkg.id })).promptSnapshot).toEqual(pkg.promptSnapshot)
    const fresh = await readyCandidate()
    expect(fresh.pkg.promptSnapshot.fingerprint).not.toBe(pkg.promptSnapshot.fingerprint)
    expect(requests).toHaveLength(1)
  })

  it('continue游标0生成插入候选，手动采用保留整个原章内容', async () => {
    const pkg = await api.context.preview({ sessionId, connectionId, taskType: 'continue', target: { chapterId, startOffset: 0 }, instruction: '在当前位置续写。' })
    const done = doneEvent()
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    expect((await done).state).toBe('ready')
    const candidate = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(candidate.startOffset).toBe(0)
    expect(candidate.endOffset).toBe(0)
    expect(candidate.originalContent).toBe('')
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    const applied = await api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 1 })
    expect(applied.chapter.content).toBe(replacement + original)
  })

  it('纯thinking输出保留raw但进入failed，不能成为可采用正文', async () => {
    const raw = '<thinking>仅有推演，无小说正文。</thinking>'
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    }
    const pkg = await preview()
    const done = doneEvent()
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    expect((await done).state).toBe('failed')
    const candidate = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(candidate.rawOutput).toBe(raw)
    expect(candidate.hunks).toEqual([])
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 1 })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('连接maxOutputTokens变化使预览失效，请求必须使用新预算', async () => {
    const pkg = await preview()
    const connection = connectionStore.get(connectionId)
    connectionStore.update({ connectionId, expectedVersion: connection.version, maxOutputTokens: 1200 })
    await expect(api.creation.start({ sessionId, contextPackageId: pkg.id })).rejects.toMatchObject({ code: 'STALE_CONTEXT_PACKAGE' })
    expect(requests).toEqual([])
    await readyCandidate()
    expect(requests[0].max_tokens).toBe(1200)
  })

  it('候选完成后章节变化阻止采用，保留作者正文', async () => {
    const { candidate } = await readyCandidate()
    const edited = chapters.update(sessionId, chapterId, '作者已经改过的正文', 1)
    expect((await api.candidate.get({ sessionId, candidateId: candidate.id })).state).toBe('stale')
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: edited.version })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    expect(chapters.get(sessionId, chapterId).content).toBe('作者已经改过的正文')
  })

  it('请求期间修改全局设置不改变已经冻结的候选请求', async () => {
    let finish: () => void = () => {}
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: replacement } }] })}\n\n`)
      finish = () => response.end('data: [DONE]\n\n')
    }
    const pkg = await preview()
    const done = doneEvent()
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    await requestReceived
    await api.prompt.savePresetStore(sampleStore())
    finish()
    expect((await done).state).toBe('ready')
    const candidate = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(candidate.rawOutput).toBe(replacement)
    expect(requests[0].messages).toEqual(pkg.messages)
    expect((await api.context.get({ sessionId, contextPackageId: pkg.id })).promptSnapshot).toEqual(pkg.promptSnapshot)
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
  })

  it('取消保留已收到的部分输出且不写正文', async () => {
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '部分内容' } }] })}\n\n`)
    }
    const pkg = await preview()
    const done = doneEvent()
    const delta = new Promise<void>((resolve) => {
      const unsubscribe = api.candidate.onDelta!(() => { unsubscribe(); resolve() })
    })
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    await delta
    await api.creation.cancel({ sessionId, taskId: started.taskId })
    expect((await done).state).toBe('cancelled')
    const candidate = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(candidate.rawOutput).toBe('部分内容')
    expect(candidate.state).toBe('cancelled')
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 1 })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('取消后的保留重新解析raw，人工采用仅写入content不写thinking或summary', async () => {
    const raw = '<thinking>内部推演。</thinking><content>保留正文。</content><summary>剧情摘要。</summary>'
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\n`)
    }
    const pkg = await preview()
    const done = doneEvent()
    const delta = new Promise<void>((resolve) => {
      const unsubscribe = api.candidate.onDelta!(() => { unsubscribe(); resolve() })
    })
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    await delta
    await api.creation.cancel({ sessionId, taskId: started.taskId })
    expect((await done).state).toBe('cancelled')
    const cancelled = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(cancelled.rawOutput).toBe(raw)
    const retained = await api.candidate.retain({ sessionId, candidateId: cancelled.id, expectedVersion: cancelled.version })
    expect(retained.state).toBe('ready')
    expect(retained.finalSynthesizedText).toBe('保留正文。')
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    const applied = await api.candidate.apply({ sessionId, candidateId: retained.id, expectedCandidateVersion: retained.version, expectedChapterVersion: 1 })
    expect(applied.chapter.content).toBe(original.slice(0, 3) + '保留正文。' + original.slice(8))
    expect(applied.chapter.content).not.toContain('内部推演')
    expect(applied.chapter.content).not.toContain('剧情摘要')
  })

  it.each(['', '<thinking>只有推演。</thinking>'])('取消后raw=%s无可保留正文，retain拒绝且不改变候选', async (raw) => {
    respond = (response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\n`)
    }
    const pkg = await preview()
    const done = doneEvent()
    const delta = raw ? new Promise<void>((resolve) => {
      const unsubscribe = api.candidate.onDelta!(() => { unsubscribe(); resolve() })
    }) : undefined
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    await (delta ?? requestReceived)
    await api.creation.cancel({ sessionId, taskId: started.taskId })
    expect((await done).state).toBe('cancelled')
    const cancelled = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(cancelled.rawOutput).toBe(raw)
    await expect(api.candidate.retain({ sessionId, candidateId: cancelled.id, expectedVersion: cancelled.version })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })
    expect((await api.candidate.get({ sessionId, candidateId: cancelled.id })).state).toBe('cancelled')
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
  })

  it('HTTP失败进入failed，正文不变且候选不能采用', async () => {
    respond = (response) => { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: '模拟请求失败' } })) }
    const pkg = await preview()
    const done = doneEvent()
    const started = await api.creation.start({ sessionId, contextPackageId: pkg.id })
    expect((await done).state).toBe('failed')
    const candidate = await api.candidate.get({ sessionId, candidateId: started.candidateId })
    expect(candidate.state).toBe('failed')
    expect(chapters.get(sessionId, chapterId).content).toBe(original)
    await expect(api.candidate.apply({ sessionId, candidateId: candidate.id, expectedCandidateVersion: candidate.version, expectedChapterVersion: 1 })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    expect(requests[0]).not.toHaveProperty('temperature')
  })
})
