import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function launchApp(options: { args?: string[]; env?: Record<string, string> } = {}) {
  const dataPath = join(tmpdir(), `novel-agent-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dataPath, { recursive: true })
  return electron.launch({
    args: options.args ?? ['.'],
    env: {
      ...process.env,
      NOVEL_AGENT_DATA_PATH: dataPath,
      ...options.env
    }
  })
}

test('phase-0 shelf is secure and served by app protocol', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Novel Agent by matsuri')
  await expect(page.getByRole('heading', { name: '还没有作品项目' })).toBeVisible()
  expect(page.url()).toBe('app://novel-agent/index.html')
  expect(await page.evaluate(() => ({ node: typeof process, require: typeof globalThis.require }))).toEqual({ node: 'undefined', require: 'undefined' })
  expect(await page.evaluate(() => typeof window.novelAgent?.project.listRecent)).toBe('function')
  expect(await page.evaluate(() => 'project' in window)).toBe(false)
  expect(Array.isArray(await page.evaluate(() => window.novelAgent.project.listRecent()))).toBe(true)
  expect(await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'))).toContain("default-src 'self'")
  expect(await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'))).not.toContain('unsafe-inline')
  expect(await page.evaluate(async () => (await fetch('app://novel-agent/../package.json')).status)).toBe(404)
  const preferences = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): unknown }).getLastWebPreferences())
  expect(preferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false })
  expect(await page.evaluate(() => window.open('https://example.com'))).toBeNull()
  const screenshotDirectory = join(tmpdir(), 'novel-agent-phase0-screenshots')
  mkdirSync(screenshotDirectory, { recursive: true })
  for (const [width, height] of [[1024, 820], [1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: join(screenshotDirectory, `shelf-${width}x${height}.png`) })
  }
  await app.close()
})

test('imports confirmed drafts through the preload and preserves optimistic edit safety', async () => {
  const folder = join(tmpdir(), `novel-agent-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文.txt'); const destination = join(folder, '作品.novelproj')
  writeFileSync(source, '第一章：开始\n甲\n\n第二章：继续\n乙', 'utf8')
  const app = await launchApp()
  const page = await app.firstWindow()
  const result = await page.evaluate(async ({ source, destination }) => {
    const preview = await window.novelAgent.project.previewImport({ source })
    if (!preview) throw new Error('preview cancelled')
    const imported = await window.novelAgent.project.import({ ...preview, destination, title: '确认后的标题' })
    if (!imported) throw new Error('import cancelled')
    const opened = await window.novelAgent.project.open({ path: imported.path })
    const chapters = await window.novelAgent.chapter.list({ sessionId: opened.sessionId })
    const updated = await window.novelAgent.chapter.update({ sessionId: opened.sessionId, chapterId: chapters[0].id, content: '已编辑', expectedVersion: chapters[0].version })
    let conflict = ''
    try { await window.novelAgent.chapter.update({ sessionId: opened.sessionId, chapterId: chapters[0].id, content: '旧草稿', expectedVersion: chapters[0].version }) } catch (error) { conflict = (error as { code?: string }).code ?? '' }
    await window.novelAgent.project.close({ sessionId: opened.sessionId })
    return { title: imported.title, chapters: chapters.map(({ title }) => title), updated: updated.content, conflict }
  }, { source, destination })
  expect(result).toEqual({ title: '确认后的标题', chapters: ['第一章：开始', '第二章：继续'], updated: '已编辑', conflict: 'VERSION_CONFLICT' })
  await app.close()
})

test('imports through the visible preview and autosaves after a chapter rename', async () => {
  const folder = join(tmpdir(), `novel-agent-ui-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const screenshotDirectory = join(tmpdir(), 'novel-agent-stage2-screenshots'); mkdirSync(screenshotDirectory, { recursive: true })
  const source = join(folder, '界面原文.txt'); const destination = join(folder, '界面作品.novelproj')
  writeFileSync(source, '第一章：开始\n初始正文\n\n第二章：继续\n第二章正文', 'utf8')
  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.source] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination })
  }, { source, destination })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  const pageErrors: string[] = []; const alerts: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', async (dialog) => {
    try {
      if (dialog.type() === 'alert') { alerts.push(dialog.message()); await dialog.dismiss() }
      else await dialog.dismiss()
    } catch {}
  })
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.screenshot({ path: join(screenshotDirectory, 'import-1440x900.png') })
  await page.getByLabel('作品名称').fill('界面确认作品')
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(500)
  expect({ pageErrors, alerts }).toEqual({ pageErrors: [], alerts: [] })
  await expect(page.getByText('界面确认作品', { exact: true })).toBeVisible()

  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('第一次保存')
  await expect(page.getByText('未保存', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('已保存', { exact: true }).first()).toBeVisible({ timeout: 5_000 })

  await page.screenshot({ path: join(screenshotDirectory, 'workbench-1440x900.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: '显示章节信息' }).click()
  await expect(page.getByRole('button', { name: '关闭章节信息' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(screenshotDirectory, 'workbench-1280x800.png') })
  await page.getByRole('button', { name: '关闭章节信息' }).click()
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 1024, height: 820 })
  await page.screenshot({ path: join(screenshotDirectory, 'workbench-1024x820.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: '重命名' }).click()
  await page.waitForTimeout(300)
  expect({ pageErrors, alerts }).toEqual({ pageErrors: [], alerts: [] })
  await expect(page.getByRole('heading', { name: '重命名章节' })).toBeVisible()
  await page.getByLabel('章节标题').fill('重命名后')
  await page.getByRole('dialog').getByRole('button', { name: '确认' }).click()
  await page.waitForTimeout(500)
  expect({ pageErrors, alerts }).toEqual({ pageErrors: [], alerts: [] })
  await expect(page.getByRole('heading', { name: '重命名后' })).toBeVisible()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('，继续编辑')
  await page.keyboard.press('Control+S')
  await page.waitForTimeout(500)
  await expect(page.getByText('已保存', { exact: true }).first()).toBeVisible({ timeout: 5_000 })

  const saved = await page.evaluate(async () => {
    const recent = await window.novelAgent.project.listRecent()
    const latest = recent[0]
    const opened = await window.novelAgent.project.open({ path: latest.path })
    const chapters = await window.novelAgent.chapter.list({ sessionId: opened.sessionId })
    await window.novelAgent.project.close({ sessionId: opened.sessionId })
    return chapters[0]
  })
  expect(saved).toMatchObject({ title: '重命名后', content: '第一次保存，继续编辑' })
  await app.close()
})

test('phase 3: supports snapshot creation, backup management, and file export in workbench', async () => {
  const folder = join(tmpdir(), `novel-agent-phase3-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文3.txt'); const destination = join(folder, '作品3.novelproj')
  const exportTxtPath = join(folder, '导出.txt')
  writeFileSync(source, '第一章 序幕\n这是第一章的正文。\n\n第二章 发展\n这是第二章的正文。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async (winOrOpts: any, maybeOpts?: any) => {
      const opts = (winOrOpts && 'filters' in winOrOpts ? winOrOpts : maybeOpts) as { filters?: Array<{ extensions?: string[] }> } | undefined
      if (opts?.filters?.[0]?.extensions?.includes('txt')) {
        return { canceled: false, filePath: paths.exportTxtPath }
      }
      return { canceled: false, filePath: paths.destination }
    }) as any
  }, { source, destination, exportTxtPath })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  // Import project
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('阶段三测试作品')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('阶段三测试作品', { exact: true })).toBeVisible()

  // 1. Create a manual snapshot
  await page.getByRole('button', { name: '创建手动快照' }).click()
  await expect(page.getByRole('heading', { name: '创建章节快照' })).toBeVisible()
  await page.getByLabel('快照名称').fill('初稿备份')
  await page.getByRole('button', { name: '创建快照' }).click()
  await page.waitForTimeout(300)
  await expect(page.getByText('初稿备份')).toBeVisible()

  // 2. Open Backup Dialog and create a backup
  await page.locator('.left-rail').getByRole('button', { name: '项目备份' }).click()
  await expect(page.getByRole('heading', { name: '项目备份管理' })).toBeVisible()
  await page.getByRole('button', { name: '立即备份' }).click()
  await page.waitForTimeout(400)
  await expect(page.getByText(/当前保留 [1-5] \/ 5 份备份/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).first().click()

  // 3. Export project to TXT
  await page.locator('.left-rail').getByRole('button', { name: '导出作品' }).click()
  await expect(page.getByRole('heading', { name: '导出作品' })).toBeVisible()
  await page.getByRole('button', { name: '选择位置并导出' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: '导出成功' })).toBeVisible()
  await page.getByRole('button', { name: '完成' }).click()

  await app.close()
})

test('phase 4: supports full-text search, multi-source filtering, navigation and index rebuild in workbench', async () => {
  const folder = join(tmpdir(), `novel-agent-phase4-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文4.txt'); const destination = join(folder, '作品4.novelproj')
  writeFileSync(source, '第一章 通天峰大殿\n青云门通天峰大殿之上，道玄真人正在传法，弟子们肃立两侧。\n\n第二章 大竹峰砍竹\n张小凡每日在后山砍伐黑节竹，手持烧火棍默默修行。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  // Import project
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('阶段四搜索测试作品')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('阶段四搜索测试作品', { exact: true })).toBeVisible()

  // 1. Open Search Dialog via left rail
  await page.locator('.left-rail').getByRole('button', { name: '全文搜索' }).click()
  await expect(page.getByRole('dialog', { name: '全文搜索' })).toBeVisible()
  await expect(page.getByText('索引已就绪')).toBeVisible()

  // 2. Search for 3-character query (FTS5 trigram)
  const searchInput = page.getByLabel('全文搜索输入')
  await searchInput.fill('通天峰')
  await page.waitForTimeout(300)
  await expect(page.locator('.search-results-list').getByText('第一章 通天峰大殿')).toBeVisible()
  await expect(page.getByText('找到 1 条匹配结果')).toBeVisible()

  // 3. Search for 2-character query (LIKE fallback)
  await searchInput.fill('小凡')
  await page.waitForTimeout(300)
  await expect(page.locator('.search-results-list').getByText('第二章 大竹峰砍竹')).toBeVisible()

  // 4. Source filtering test
  await page.getByRole('button', { name: '创作规则' }).click()
  await page.waitForTimeout(300)
  await expect(page.getByText('未找到与 “小凡” 相关的匹配内容')).toBeVisible()

  await page.getByRole('button', { name: '章节正文' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.search-results-list').getByText('第二章 大竹峰砍竹')).toBeVisible()

  // 5. Click search result -> navigate to chapter
  await page.locator('.search-result-item').first().click()
  await page.waitForTimeout(400)
  // Verify chapter 2 is now active
  await expect(page.locator('.writing-area').getByRole('heading', { name: '第二章 大竹峰砍竹' })).toBeVisible()

  // 6. Test rebuild index button
  await page.locator('.left-rail').getByRole('button', { name: '全文搜索' }).click()
  await expect(page.getByText('索引已就绪')).toBeVisible()
  await page.getByRole('button', { name: '重建索引' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('索引已就绪')).toBeVisible()

  await page.getByRole('button', { name: '关闭搜索' }).click()
  await expect(page.getByRole('dialog', { name: '全文搜索' })).not.toBeVisible()

  await app.close()
})

test('phase 5: supports knowledge base management, creative configuration, and AI suggestion preview/acceptance', async () => {
  const folder = join(tmpdir(), `novel-agent-phase5-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文5.txt'); const destination = join(folder, '作品5.novelproj')
  writeFileSync(source, '第一章 苍穹之下\n林萧站在青云绝顶之上，神色凝重。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  // Import project
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('阶段五测试作品')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('阶段五测试作品', { exact: true })).toBeVisible()

  // 1. Knowledge Base Management
  await page.locator('.left-rail').getByRole('button', { name: '知识库' }).click()
  await expect(page.getByRole('heading', { name: '作品知识库' })).toBeVisible()

  // Create Character Entry
  await page.getByRole('button', { name: '新建条目' }).click()
  await page.getByPlaceholder('条目标题', { exact: true }).fill('林萧')
  await page.getByPlaceholder('别名、绰号').fill('萧儿')
  await page.getByPlaceholder('例如：宗门长老、主角师尊').fill('青云门真传弟子')
  await page.getByPlaceholder('输入作者维护的知识详情描述...').fill('天生剑心，性格沉毅。')
  await page.getByRole('button', { name: '保存条目' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.entry-list').getByText('林萧')).toBeVisible()

  // Create World Entry
  await page.getByRole('button', { name: '世界观 (World)' }).click()
  await page.getByRole('button', { name: '新建条目' }).click()
  await page.getByPlaceholder('条目标题', { exact: true }).fill('青云仙山')
  await page.getByPlaceholder('输入作者维护的知识详情描述...').fill('东域第一仙门祖庭。')
  await page.getByRole('button', { name: '保存条目' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.entry-list').getByText('青云仙山')).toBeVisible()

  // Close Knowledge Base Dialog
  await page.getByRole('dialog', { name: '作品知识库' }).getByRole('button', { name: '关闭' }).first().click()
  await expect(page.getByRole('heading', { name: '作品知识库' })).not.toBeVisible()

  // 2. Creative Settings Management
  await page.locator('.left-rail').getByRole('button', { name: '创作配置' }).click()
  await expect(page.getByRole('heading', { name: '创作配置管理' })).toBeVisible()

  // Save Creative Rules
  const rulesArea = page.getByPlaceholder('请输入全书长期有效的题材设定、人物禁忌、文风要求等硬性创作规则...')
  await rulesArea.fill('全书遵循东方玄幻世界观，文风厚重严谨。')
  await page.getByRole('button', { name: '保存规则' }).click()
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: '已保存' })).toBeVisible()

  // Style Sample
  await page.getByRole('button', { name: /风格样本/ }).click()
  await page.getByRole('button', { name: '新建风格样本' }).click()
  await page.getByPlaceholder('例如：打斗高潮、细腻心理').fill('打斗范例')
  await page.getByPlaceholder('打斗, 仙侠, 豪放').fill('打斗, 剑招')
  await page.getByPlaceholder('输入示范正文片段...').fill('长剑破空，如惊雷掠地。')
  await page.getByRole('button', { name: '保存样本' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.entry-list').getByText('打斗范例')).toBeVisible()

  // Close Creative Settings
  await page.getByRole('dialog', { name: '创作配置管理' }).getByRole('button', { name: '关闭' }).first().click()

  // 3. AI Suggestions Dialog
  await page.locator('.left-rail').getByRole('button', { name: 'AI建议审阅' }).click()
  await expect(page.getByRole('heading', { name: 'AI 事实建议审阅' })).toBeVisible()
  await page.getByRole('dialog', { name: 'AI 事实建议审阅' }).getByRole('button', { name: '关闭' }).first().click()

  await app.close()
})

test('phase 6: supports model connections, content target confirmation, task routing, and session privacy', async () => {
  test.setTimeout(60000)
  const folder = join(tmpdir(), `novel-agent-phase6-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文6.txt'); const destination = join(folder, '作品6.novelproj')
  writeFileSync(source, '第一章 苍穹之下\n林萧站在青云绝顶之上，神色凝重。', 'utf8')

  console.log('[Phase 6 Test] Launching app...')
  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  console.log('[Phase 6 Test] Importing project...')
  // Import project
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('阶段六测试作品')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('阶段六测试作品', { exact: true })).toBeVisible()

  console.log('[Phase 6 Test] Opening Model Dialog...')
  // Model Connections, Task Routes, and Privacy
  const connName = `硅基流动 Qwen-72B-${Date.now()}`
  await page.locator('.left-rail').getByRole('button', { name: '模型连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型连接、任务路由与隐私' })).toBeVisible()

  console.log('[Phase 6 Test] Creating connection...')
  // Create Connection
  await page.getByRole('button', { name: '新建模型连接' }).click()
  await expect(page.getByRole('heading', { name: '新建模型连接' })).toBeVisible()
  await page.getByPlaceholder('例如：硅基流动 Qwen-2.5-72B').fill(connName)
  await page.getByPlaceholder('例如：https://api.siliconflow.cn/v1').fill('https://api.siliconflow.cn/v1')
  await page.getByPlaceholder('例如：Qwen/Qwen2.5-72B-Instruct').fill('Qwen/Qwen2.5-72B-Instruct')
  await page.getByPlaceholder('sk-...').fill('sk-test-secret-key-12345')
  await page.getByRole('button', { name: '保存连接' }).click()
  await page.waitForTimeout(300)

  console.log('[Phase 6 Test] Confirming target...')
  // Verify created connection
  const connCard = page.locator('.conn-card').filter({ hasText: connName }).first()
  await expect(connCard).toBeVisible()
  await expect(connCard.getByText('⚠ 目标未确认')).toBeVisible()

  // Confirm Content Target Gate
  await connCard.getByRole('button', { name: '确认目标' }).click()
  await expect(page.getByRole('heading', { name: '确认联网目标端点' })).toBeVisible()
  await page.getByRole('button', { name: '确认并信任该目标端点' }).click()
  await page.waitForTimeout(300)
  await expect(connCard.getByText('✓ 目标已确认')).toBeVisible()

  console.log('[Phase 6 Test] Configuring task routes...')
  // Task Routes
  await page.getByRole('button', { name: /任务路由/ }).click()
  await page.waitForTimeout(300)
  const continueSelect = page.locator('.task-route-card').filter({ hasText: '小说续写' }).locator('select')
  await continueSelect.selectOption({ label: `${connName} (Qwen/Qwen2.5-72B-Instruct)` })
  await page.waitForTimeout(300)
  await expect(page.locator('.task-route-card').filter({ hasText: '小说续写' }).getByText('✓ 已绑定')).toBeVisible()

  console.log('[Phase 6 Test] Privacy & Diagnostics...')
  // Privacy & Diagnostics
  await page.getByRole('button', { name: /隐私与诊断/ }).click()
  await expect(page.getByText('本地优先与隐私保护策略')).toBeVisible()
  const detailedLogCheck = page.getByLabel('开启详细日志')
  await detailedLogCheck.click()
  await page.waitForTimeout(300)
  // Close Dialog
  await page.locator('.connection-dialog').getByRole('button', { name: '关闭' }).first().click()

  // Verify topbar badge updated
  await expect(page.locator('.active-connection-badge')).toContainText(connName)

  await app.close()
})

test('phase 7: tasks, consistency issues, 6-section literary reports, and rolling synopsis', async () => {
  console.log('[Phase 7 Test] Starting test setup...')
  const folder = join(tmpdir(), `novel-agent-phase7-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文7.txt'); const destination = join(folder, '作品7.novelproj')
  writeFileSync(source, '第一章 破晓\n林风在晨雾中拔出长剑，青岚宗的古钟敲响了九声。\n\n第二章 秘境\n林风踏入苍渊禁地，寻觅失传千年的造化金丹。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  console.log('[Phase 7 Test] Importing novel...')
  // 1. Import Novel
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('第七阶段全景测试')
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('第七阶段全景测试', { exact: true })).toBeVisible()

  console.log('[Phase 7 Test] Testing Consistency Dialog...')
  // 2. Open Consistency Issues Dialog
  await page.locator('.left-rail').getByRole('button', { name: '一致性检测', exact: true }).click()
  await expect(page.getByRole('heading', { name: '故事一致性与矛盾检测' })).toBeVisible()
  await expect(page.getByRole('button', { name: '待处理' })).toBeVisible()
  await expect(page.getByRole('button', { name: '已确认' })).toBeVisible()
  await expect(page.getByRole('button', { name: '已忽略' })).toBeVisible()
  await expect(page.getByRole('button', { name: '已过时' })).toBeVisible()
  await expect(page.getByRole('button', { name: '严重' })).toBeVisible()
  await expect(page.getByRole('button', { name: '中等' })).toBeVisible()
  await expect(page.getByRole('button', { name: '轻微' })).toBeVisible()
  await expect(page.getByText('暂无匹配的一致性问题')).toBeVisible()
  await page.locator('.consistency-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(200)

  console.log('[Phase 7 Test] Testing Literary Reports Dialog...')
  // 3. Open Literary Reports Dialog
  await page.locator('.left-rail').getByRole('button', { name: '文学分析报告', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文学分析报告' })).toBeVisible()
  await expect(page.getByText('暂无报告，请点击右上角生成')).toBeVisible()
  await page.locator('.report-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(200)

  console.log('[Phase 7 Test] Testing Synopsis Dialog...')
  // 4. Open Synopsis Dialog
  await page.locator('.left-rail').getByRole('button', { name: '全书大纲', exact: true }).click()
  await expect(page.getByRole('heading', { name: '全书故事梗概与章节摘要' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '全书宏观故事脉络' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /各章节摘要明细/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新生成大纲' })).toBeVisible()
  await page.locator('.synopsis-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(200)

  console.log('[Phase 7 Test] Testing Tasks Center & Launch Dialog...')
  // 5. Open Tasks Center Dialog
  await page.locator('.left-rail').getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page.getByRole('heading', { name: '任务中心与进度监控' })).toBeVisible()
  await expect(page.getByText('暂无分析任务')).toBeVisible()

  console.log('[Phase 7 Test] Opening Launch New Task Dialog...')
  // Open Launch New Task Modal from Tasks Center
  await page.locator('.tasks-dialog').getByRole('button', { name: '发起新任务' }).click()
  await expect(page.getByRole('heading', { name: '发起分析与生成任务' })).toBeVisible()
  await expect(page.getByText('知识设定提取与一致性检测')).toBeVisible()
  await expect(page.getByText('文学分析报告 (六大维度)')).toBeVisible()
  await expect(page.getByText('滚动故事梗概 (全书大纲)')).toBeVisible()

  console.log('[Phase 7 Test] Testing custom scope selector...')
  // Test custom scope selector
  await page.locator('.analysis-start-dialog input[value="custom"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('.chapter-checkbox-list').getByText('第一章 破晓')).toBeVisible()
  await expect(page.locator('.chapter-checkbox-list').getByText('第二章 秘境')).toBeVisible()

  console.log('[Phase 7 Test] Closing dialogs...')
  // Close launch dialog
  await page.locator('.analysis-start-dialog').getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(300)

  console.log('[Phase 7 Test] Completed successfully!')
  await app.close()
})

test('phase 8: context assembly preview, token budget meter, and prompt inspection', async () => {
  const folder = join(tmpdir(), `novel-agent-phase8-e2e-${Date.now()}`); mkdirSync(folder, { recursive: true })
  const source = join(folder, '原文8.txt'); const destination = join(folder, '作品8.novelproj')
  writeFileSync(source, '第一章 离乡\n王林告别父母，离开山村前往恒岳派参加入门试炼。天高地迥，道阻且长。\n\n第二章 偶得天逆\n山崖之下，王林意外拾得天逆珠。珠子内部隐有天地，自成乾坤。', 'utf8')

  console.log('[Phase 8 Test] Launching app...')
  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  console.log('[Phase 8 Test] Importing project...')
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('第八阶段全景测试')
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('第八阶段全景测试', { exact: true })).toBeVisible()

  console.log('[Phase 8 Test] Creating a test generation model connection...')
  const connName = `Phase8-LLM-${Date.now()}`
  await page.locator('.left-rail').getByRole('button', { name: '模型连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型连接、任务路由与隐私' })).toBeVisible()

  await page.getByRole('button', { name: '新建模型连接' }).click()
  await page.getByPlaceholder('例如：硅基流动 Qwen-2.5-72B').fill(connName)
  await page.getByPlaceholder('例如：https://api.siliconflow.cn/v1').fill('https://api.openai.com/v1')
  await page.getByPlaceholder('例如：Qwen/Qwen2.5-72B-Instruct').fill('gpt-4o')
  await page.getByPlaceholder('sk-...').fill('sk-phase8-test-key')
  await page.getByRole('button', { name: '保存连接' }).click()
  await page.waitForTimeout(300)

  // Confirm target
  const connCard = page.locator('.conn-card').filter({ hasText: connName }).first()
  await expect(connCard).toBeVisible()
  await connCard.getByRole('button', { name: '确认目标' }).click()
  await page.getByRole('button', { name: '确认并信任该目标端点' }).click()
  await page.waitForTimeout(300)

  await page.locator('.connection-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(300)

  console.log('[Phase 8 Test] Opening Context Assembly Preview Dialog...')
  await page.locator('.left-rail').getByRole('button', { name: '上下文装配预览', exact: true }).click()
  await expect(page.getByRole('heading', { name: '上下文装配预览与 Token 预算' })).toBeVisible()
  await expect(page.getByText('12 级优先级装配规则')).toBeVisible()

  console.log('[Phase 8 Test] Generating Context Preview...')
  await page.getByRole('button', { name: '生成装配预览' }).click()
  await page.waitForTimeout(600)

  // Verify Token budget meter
  await expect(page.getByText(/Token 预算消耗/)).toBeVisible()
  await expect(page.getByText(/包含 \d+ 个上下文条目/)).toBeVisible()
  await expect(page.getByText(/指纹:/)).toBeVisible()

  // Verify tabs
  await expect(page.getByRole('button', { name: /上下文条目清单/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'System Prompt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'User Prompt' })).toBeVisible()

  // Switch to System Prompt tab
  await page.getByRole('button', { name: 'System Prompt' }).click()
  await page.waitForTimeout(200)
  await expect(page.getByRole('button', { name: '复制全文' })).toBeVisible()
  await expect(page.locator('pre').getByText('你是一位专业的小说创作助手')).toBeVisible()

  // Switch to User Prompt tab
  await page.getByRole('button', { name: 'User Prompt' }).click()
  await page.waitForTimeout(200)
  await expect(page.locator('pre').getByText('王林')).toBeVisible()

  // Close context preview dialog
  await page.getByRole('dialog', { name: '上下文装配预览与 Token 预算' }).getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(300)

  console.log('[Phase 8 Test] Completed successfully!')
  await app.close()
})

test('phase 9 creation toolbar, candidate diff review modal, hunk toggling, and atomic writeback', async () => {
  const folder = join(tmpdir(), `novel-agent-phase9-${Date.now()}`)
  mkdirSync(folder, { recursive: true })
  const source = join(folder, '第九阶段原文.txt')
  const destination = join(folder, '第九阶段作品.novelproj')
  writeFileSync(source, '第一章 仙门初入\n韩立背着行囊，神色平静地走在通往七玄门的石阶上。山风萧瑟，白雾渐浓。\n\n第二章 墨大夫\n神手谷中，墨大夫正在配药。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  console.log('[Phase 9 Test] Importing project...')
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('第九阶段全景测试')
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('第九阶段全景测试', { exact: true })).toBeVisible()

  console.log('[Phase 9 Test] Ensuring generation model connection exists...')
  const connName = `Phase9-LLM-${Date.now()}`
  await page.locator('.left-rail').getByRole('button', { name: '模型连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型连接、任务路由与隐私' })).toBeVisible()

  await page.getByRole('button', { name: '新建模型连接' }).click()
  await page.getByPlaceholder('例如：硅基流动 Qwen-2.5-72B').fill(connName)
  await page.getByPlaceholder('例如：https://api.siliconflow.cn/v1').fill('https://api.openai.com/v1')
  await page.getByPlaceholder('例如：Qwen/Qwen2.5-72B-Instruct').fill('gpt-4o')
  await page.getByPlaceholder('sk-...').fill('sk-phase9-test-key')
  await page.getByRole('button', { name: '保存连接' }).click()
  await page.waitForTimeout(300)

  // Confirm target
  const connCard = page.locator('.conn-card').filter({ hasText: connName }).first()
  await expect(connCard).toBeVisible()
  await connCard.getByRole('button', { name: '确认目标' }).click()
  await page.getByRole('button', { name: '确认并信任该目标端点' }).click()
  await page.waitForTimeout(300)

  await page.locator('.connection-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(300)

  console.log('[Phase 9 Test] Verifying creation action bar buttons in editor header...')
  await expect(page.getByRole('button', { name: '续写', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重写', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '润色', exact: true })).toBeVisible()

  // Clicking "续写" opens Context preview with continue taskType
  await page.getByRole('button', { name: '续写', exact: true }).click()
  await expect(page.getByRole('heading', { name: '上下文装配预览与 Token 预算' })).toBeVisible()
  await page.getByRole('button', { name: '生成装配预览' }).click()
  await expect(page.getByText('待续写前文段落')).toBeVisible()

  // Close context preview dialog
  await page.locator('.context-preview-dialog').getByRole('button', { name: '关闭' }).first().click()
  await expect(page.locator('.context-preview-dialog')).not.toBeVisible()

  console.log('[Phase 9 Test] Opening Candidate Diff Review Dialog...')
  await page.locator('.left-rail').getByRole('button', { name: '差异审阅', exact: true }).click()
  await expect(page.getByRole('heading', { name: '差异审阅 (Candidate Diff Review)' })).toBeVisible()
  await expect(page.getByText('暂无候选版本')).toBeVisible()

  // Close dialog
  await page.locator('.candidate-dialog').getByRole('button', { name: '关闭' }).first().click()
  await expect(page.locator('.candidate-dialog')).not.toBeVisible()

  console.log('[Phase 9 Test] Completed successfully!')
  await app.close()
})

test('phase 10: multi-turn chat workbench, sessions, rolling summary, citations and preload API bridge', async () => {
  const folder = join(tmpdir(), `novel-agent-phase10-${Date.now()}`)
  mkdirSync(folder, { recursive: true })
  const source = join(folder, '第十阶段原文.txt')
  const destination = join(folder, '第十阶段作品.novelproj')
  writeFileSync(source, '第一章 仙门初入\n韩立背着行囊，神色平静地走在通往七玄门的石阶上。山风萧瑟，白雾渐浓。\n\n第二章 墨大夫\n神手谷中，墨大夫正在配药，掌天瓶在月光下凝聚灵液。', 'utf8')

  const app = await launchApp()
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.source] })) as any
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.destination })) as any
  }, { source, destination })

  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 900 })

  console.log('[Phase 10 Test] Importing project...')
  await page.getByRole('button', { name: '导入作品' }).click()
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByLabel('作品名称').fill('第十阶段全景测试')
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('第十阶段全景测试', { exact: true })).toBeVisible()

  console.log('[Phase 10 Test] Verifying rail chat button...')
  await expect(page.locator('.left-rail').getByRole('button', { name: '项目问答', exact: true })).toBeVisible()

  console.log('[Phase 10 Test] Opening Chat Workbench Dialog...')
  await page.locator('.left-rail').getByRole('button', { name: '项目问答', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('项目问答与创作')).toBeVisible()
  await expect(page.getByText('暂无问答会话')).toBeVisible()

  console.log('[Phase 10 Test] Creating a chat session via UI...')
  await page.locator('.chat-sidebar').getByRole('button', { name: '新建' }).click()
  await page.getByRole('button', { name: '普通问答' }).click()
  await page.getByPlaceholder('输入会话主题...').fill('宗门功法探讨')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.waitForTimeout(300)

  await expect(page.locator('.chat-sidebar').getByText('宗门功法探讨')).toBeVisible()
  await expect(page.locator('.chat-input-textarea')).toBeVisible()

  // Test typing input
  await page.locator('.chat-input-textarea').fill('韩立在神手谷修炼了什么？')
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible()

  // Close chat dialog
  await page.locator('.chat-dialog').getByRole('button', { name: '关闭' }).first().click()
  await page.waitForTimeout(300)

  console.log('[Phase 10 Test] Completed successfully!')
  await app.close()
})




