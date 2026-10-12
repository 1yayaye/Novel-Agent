import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const screenshots = resolve('docs/gemini-novel-prompt-system/screenshots')
mkdirSync(screenshots, { recursive: true })
function folder() {
  const path = join(tmpdir(), `novel-agent-global-prompts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(path, { recursive: true })
  return path
}
function launch(dataPath: string) {
  return electron.launch({ args: ['.'], env: { ...process.env, NOVEL_AGENT_DATA_PATH: dataPath } })
}
function errors(page: Page) {
  const found: string[] = []
  page.on('pageerror', (error) => found.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Content Security Policy')) return
    found.push(text)
  })
  return found
}
async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function identity(page: Page) {
  await expect(page).toHaveTitle('Novel Agent by matsuri')
  expect(page.url()).toBe('app://novel-agent/index.html')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '提示词设置', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('global preset settings save from the shelf and survive an Electron restart', async () => {
  const dataPath = folder()
  let app = await launch(dataPath)
  try {
    let page = await app.firstWindow()
    let found = errors(page)
    await identity(page)
    await page.getByRole('button', { name: '提示词设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '提示词与创作设置' })).toBeVisible()
    const initial = await page.evaluate(() => window.novelAgent.prompt.getPresetStore())
    expect(initial.store.presets).toHaveLength(0)
    await page.getByRole('button', { name: '新建空白预设', exact: true }).first().click()
    await page.getByRole('switch', { name: '系统创作设定', exact: true }).click()
    await expect(page.getByText('待保存', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '保存全局设置', exact: true }).click()
    await expect(page.getByText('待保存', { exact: true })).toHaveCount(0)
    const saved = await page.evaluate(() => window.novelAgent.prompt.getPresetStore())
    expect(saved.store.presets).toHaveLength(1)
    expect(saved.store.presets[0].blocks.find((b) => b.name === '系统创作设定')?.enabled).toBe(false)
    expect(JSON.parse(readFileSync(join(dataPath, 'prompt-presets.json'), 'utf8'))).toEqual(saved.store)
    await page.screenshot({ path: join(screenshots, 'global-settings-saved.png') })
    const initialErrors = [...found]
    await app.close()
    app = await launch(dataPath)
    page = await app.firstWindow()
    found = errors(page)
    await identity(page)
    await page.getByRole('button', { name: '提示词设置', exact: true }).click()
    await expect(page.getByRole('switch', { name: '系统创作设定', exact: true })).not.toBeChecked()
    expect(await page.evaluate(() => window.novelAgent.prompt.getPresetStore())).toEqual(saved)
    expect([...initialErrors, ...found]).toEqual([])
  } finally { await app.close() }
})

test('the real UI warns about a damaged global file and allows an explicit repair save', async () => {
  const dataPath = folder()
  const config = join(dataPath, 'prompt-presets.json')
  writeFileSync(config, '{broken', 'utf8')
  const app = await launch(dataPath)
  try {
    const page = await app.firstWindow()
    const found = errors(page)
    await identity(page)
    await page.getByRole('button', { name: '提示词设置', exact: true }).click()
    await expect(page.getByText(/预设库配置文件无法读取/).first()).toBeVisible()
    expect(readFileSync(config, 'utf8')).toBe('{broken')
    await page.screenshot({ path: join(screenshots, 'global-settings-warning.png') })
    await expect(page.getByRole('button', { name: '保存全局设置', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '保存全局设置', exact: true }).click()
    await expect(page.getByText(/预设库配置文件无法读取/)).toHaveCount(0)
    expect((await page.evaluate(() => window.novelAgent.prompt.getPresetStore())).warnings).toEqual([])
    expect(found).toEqual([])
  } finally { await app.close() }
})

test('global changes preserve author rules; changed preview inputs cannot send an old package', async () => {
  test.setTimeout(60_000)
  const dataPath = folder()
  const source = join(dataPath, '作者原文.txt')
  const destination = join(dataPath, '独立作品.novelproj')
  const requests: any[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '<thinking>内部推理不应写回</thinking><content>新的候选正文。</content>' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  writeFileSync(source, '第一章 开始\n作者原文。', 'utf8')
  const app = await launch(dataPath)
  try {
    const page = await app.firstWindow()
    const found = errors(page)
    await identity(page)
    const setup = await page.evaluate(async ({ source, destination, baseUrl, fingerprint }) => {
      const preview = await window.novelAgent.project.previewImport({ source })
      if (!preview) throw new Error('Missing import preview')
      const imported = await window.novelAgent.project.import({ ...preview, destination, title: '独立作品' })
      if (!imported) throw new Error('Missing imported project')
      const project = await window.novelAgent.project.open({ path: imported.path })
      const rules = (await window.novelAgent.prompt.getBundle({ sessionId: project.sessionId })).rules
      await window.novelAgent.creativeRule.update({ sessionId: project.sessionId, content: '作者规则：保留山村人物语气。', expectedVersion: rules.version })
      const connection = await window.novelAgent.connection.create({ name: '本地 Gemini 3.8 Flash 协议烟测', kind: 'generation', baseUrl, model: 'gemini-3.8-flash', isLocalService: true, contextWindow: 32000, maxOutputTokens: 2048, tokenEstimationRatio: 1.3 })
      await window.novelAgent.connection.confirmContentTarget({ connectionId: connection.id, displayedFingerprint: fingerprint })
      await window.novelAgent.project.close({ sessionId: project.sessionId })
      return { path: imported.path }
    }, { source, destination, baseUrl, fingerprint: createHash('sha256').update(`${baseUrl}:gemini-3.8-flash`).digest('hex').slice(0, 24) })
    await page.reload()
    await page.getByText('独立作品', { exact: true }).click()
    await expect(page.locator('.workbench')).toBeVisible()
    await page.screenshot({ path: join(screenshots, 'workbench-actiondock.png') })
    await page.getByRole('button', { name: '提示词与文风', exact: true }).click()
    await page.getByRole('button', { name: '新建空白预设', exact: true }).first().click()
    await page.getByRole('button', { name: '保存全局设置', exact: true }).click()
    await expect(page.getByText('全局提示词设置已保存，下次请求生效')).toBeVisible()
    await page.getByRole('tab', { name: '全书创作规则' }).click()
    await expect(page.locator('[role="dialog"] .cm-content')).toContainText('作者规则：保留山村人物语气。')
    await page.getByRole('button', { name: '查看上下文', exact: true }).click()
    await expect(page.getByRole('heading', { name: '上下文装配预览与 Token 预算' })).toBeVisible()
    await page.getByPlaceholder('输入对 AI 的具体写作要求...').fill('旧要求：红色的门。')
    await page.getByRole('button', { name: '生成装配预览', exact: true }).click()
    await expect(page.getByText(/冻结预算：上下文窗口/)).toBeVisible()
    await page.getByPlaceholder('输入对 AI 的具体写作要求...').fill('新要求：蓝色的窗。')
    await expect(page.getByRole('button', { name: '开始生成候选', exact: true })).toBeDisabled()
    await expect(page.getByText(/冻结预算：上下文窗口/)).toHaveCount(0)
    expect(requests).toHaveLength(0)
    await page.getByRole('button', { name: '生成装配预览', exact: true }).click()
    await expect(page.getByText(/冻结预算：上下文窗口/)).toBeVisible()
    await page.getByRole('tab', { name: /上下文条目清单/ }).click()
    await page.getByRole('tab', { name: /实际请求消息/ }).click()
    await expect(page.locator('pre').filter({ hasText: '新要求：蓝色的窗。' })).toBeVisible()
    await page.screenshot({ path: join(screenshots, 'context-frozen-messages.png') })
    await page.getByRole('button', { name: '开始生成候选', exact: true }).click()
    await expect(page.getByRole('button', { name: '编辑草稿', exact: true })).toBeEnabled({ timeout: 20_000 })
    expect(requests).toHaveLength(1)
    const sent = JSON.stringify(requests[0].messages)
    expect(sent).toContain('新要求：蓝色的窗。')
    expect(sent).not.toContain('旧要求：红色的门。')
    await page.getByRole('button', { name: '编辑草稿', exact: true }).click()
    await expect(page.getByRole('textbox')).toHaveValue('新的候选正文。')
    await page.getByRole('dialog').getByLabel('关闭', { exact: true }).click()
    await page.getByRole('button', { name: '返回书架', exact: true }).click()
    await expect(page.getByRole('button', { name: '提示词设置', exact: true })).toBeVisible()
    const retained = await page.evaluate(async ({ path }) => {
      const project = await window.novelAgent.project.open({ path })
      try {
        const chapters = await window.novelAgent.chapter.list({ sessionId: project.sessionId })
        return { rules: (await window.novelAgent.prompt.getBundle({ sessionId: project.sessionId })).rules.content, chapter: await window.novelAgent.chapter.get({ sessionId: project.sessionId, chapterId: chapters[0].id }) }
      }
      finally { await window.novelAgent.project.close({ sessionId: project.sessionId }) }
    }, setup)
    expect(retained.rules).toBe('作者规则：保留山村人物语气。')
    expect(retained.chapter.content).toBe('作者原文。')
    expect(found).toEqual([])
  } finally { await app.close(); await new Promise<void>((done) => server.close(() => done())) }
})

test('the chat evidence button inspects the original frozen package without reassembly or generation', async () => {
  test.setTimeout(60_000)
  const dataPath = folder()
  const source = join(dataPath, '历史原文.txt')
  const destination = join(dataPath, '历史作品.novelproj')
  const requests: any[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '可追溯的历史回复。' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  writeFileSync(source, '第一章 起点\n已有事实。', 'utf8')
  const app = await launch(dataPath)
  try {
    const page = await app.firstWindow()
    const found = errors(page)
    await identity(page)
    const setup = await page.evaluate(async ({ source, destination, baseUrl, fingerprint }) => {
      const preview = await window.novelAgent.project.previewImport({ source })
      if (!preview) throw new Error('Missing import preview')
      const imported = await window.novelAgent.project.import({ ...preview, destination, title: '历史作品' })
      if (!imported) throw new Error('Missing imported project')
      const project = await window.novelAgent.project.open({ path: imported.path })
      const connection = await window.novelAgent.connection.create({ name: '本地 Gemini 3.8 Flash 历史会话', kind: 'generation', baseUrl, model: 'gemini-3.8-flash', isLocalService: true, contextWindow: 32000, maxOutputTokens: 2048 })
      await window.novelAgent.connection.confirmContentTarget({ connectionId: connection.id, displayedFingerprint: fingerprint })
      const chat = await window.novelAgent.chat.create({ sessionId: project.sessionId, title: '可追溯会话', connectionId: connection.id, workflowType: 'free_chat' })
      const sent = await window.novelAgent.chat.send({ sessionId: project.sessionId, chatSessionId: chat.id, content: '请核对已知事实。', connectionId: connection.id })
      return { sessionId: project.sessionId, chatSessionId: chat.id, contextPackageId: sent.contextPackageId }
    }, { source, destination, baseUrl, fingerprint: createHash('sha256').update(`${baseUrl}:gemini-3.8-flash`).digest('hex').slice(0, 24) })
    await expect.poll(() => page.evaluate(async ({ sessionId, chatSessionId }) => (await window.novelAgent.chat.listMessages({ sessionId, chatSessionId })).some((message) => message.role === 'assistant' && message.state === 'completed'), setup)).toBe(true)
    const frozen = await page.evaluate(async ({ sessionId, contextPackageId }) => {
      const frozen = await window.novelAgent.context.get({ sessionId, contextPackageId })
      const current = await window.novelAgent.prompt.getPresetStore()
      await window.novelAgent.prompt.savePresetStore({
        ...current.store,
        presets: [
          ...current.store.presets,
          {
            id: 'preset-afterwards',
            name: '修改后的预设',
            description: '测试历史冻结快照',
            blocks: [
              { id: 'b1', name: '系统创作设定', role: 'system', content: '测试内容', position: 'relative', depth: 0, order: 0, enabled: true }
            ],
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activePresetId: 'preset-afterwards'
      })
      await window.novelAgent.project.close({ sessionId })
      return frozen
    }, setup)
    await page.reload()
    await page.getByText('历史作品', { exact: true }).click()
    await expect(page.locator('.workbench')).toBeVisible()
    await page.locator('button[title="项目问答与多轮创作研讨"]').click()
    await expect(page.getByText('可追溯的历史回复。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '装配证据', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: '历史上下文消息与冻结预算' })).toBeVisible()
    await expect(page.getByText('当前活跃预设：无活跃预设（默认回退）。后台分析任务按严格 JSON 协议执行，创作类任务由预设接管。')).toBeVisible()
    await expect(page.getByRole('button', { name: '开始生成候选', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '生成装配预览', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: /上下文条目清单/ }).click()
    await page.getByRole('tab', { name: /实际请求消息/ }).click()
    await expect(page.getByText(/请核对已知事实。/)).toBeVisible()
    await page.screenshot({ path: join(screenshots, 'historical-context-frozen.png') })
    expect(requests).toHaveLength(1)
    expect(frozen.messages).toEqual(requests[0].messages)
    expect(found).toEqual([])
  } finally { await app.close(); await new Promise<void>((done) => server.close(() => done())) }
})
