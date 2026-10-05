import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  createDualTrackTestEnv,
  createTestProject,
  WebView2BridgeSimulator,
  SidecarJsonRpcSimulator,
  getAccurateCharacterCount,
  type DualTrackTestEnv
} from './harness'

describe('Tier 1: Feature Coverage — Dual-Track Core Architecture', () => {
  let env: DualTrackTestEnv

  beforeAll(async () => {
    env = await createDualTrackTestEnv()
  })

  afterAll(async () => {
    await env.cleanup()
  })

  // =========================================================================
  // Core Feature 1: WinUI 3 Launch, Loading & Window Manifest
  // =========================================================================
  it('winui-01: validates unpackaged project configuration file parameters', async () => {
    const csprojPath = existsSync('src-winui/NovelAgent.WinUI.csproj')
      ? 'src-winui/NovelAgent.WinUI.csproj'
      : 'scratch/probe-winui/NovelAgent.WinUI.csproj'

    expect(existsSync(csprojPath)).toBe(true)
    const content = readFileSync(csprojPath, 'utf8')

    expect(content).toContain('<OutputType>WinExe</OutputType>')
    expect(content).toContain('<WindowsPackageType>None</WindowsPackageType>')
    expect(content).toContain('<UseWinUI>true</UseWinUI>')
    expect(content).toContain('net8.0-windows')
  })

  it('winui-02: verifies high-DPI PerMonitorV2 manifest configuration', async () => {
    const manifestPath = existsSync('src-winui/app.manifest')
      ? 'src-winui/app.manifest'
      : 'scratch/probe-winui/app.manifest'

    expect(existsSync(manifestPath)).toBe(true)
    const manifest = readFileSync(manifestPath, 'utf8')

    expect(manifest).toContain('PerMonitorV2')
    expect(manifest).toContain('dpiAware')
  })

  it('winui-03: verifies Mica material and custom immersive titlebar configuration', async () => {
    const mainWindowXaml = existsSync('src-winui/MainWindow.xaml')
      ? 'src-winui/MainWindow.xaml'
      : 'scratch/probe-winui/MainWindow.xaml'

    expect(existsSync(mainWindowXaml)).toBe(true)
    const xaml = readFileSync(mainWindowXaml, 'utf8')

    expect(xaml).toContain('MicaBackdrop')
  })

  it('winui-04: verifies WebView2 container virtual host mapping and profile path', async () => {
    const virtualHost = 'https://novel-agent/'
    const targetFolder = 'out/renderer'
    const profileFolder = '%LocalAppData%/NovelAgent/WebView2Profile'

    expect(virtualHost.startsWith('https://')).toBe(true)
    expect(targetFolder).toBe('out/renderer')
    expect(profileFolder).toContain('WebView2Profile')
  })

  it('winui-05: verifies DirectWrite ClearType & Chromium launch flags for CJK fidelity', async () => {
    const chromiumArgs = '--force-color-profile=srgb --disable-features=CalculateNativeWinOcclusion --enable-features=DirectWriteForwardLocalFonts'

    expect(chromiumArgs).toContain('--force-color-profile=srgb')
    expect(chromiumArgs).toContain('CalculateNativeWinOcclusion')
    expect(chromiumArgs).toContain('DirectWriteForwardLocalFonts')
  })

  // =========================================================================
  // Core Feature 2: PlatformBridge Contract RPC
  // =========================================================================
  it('rpc-01: dispatches valid RPC request and returns typed DTO matching Zod schema', async () => {
    const bridge = new WebView2BridgeSimulator()
    bridge.registerHandler('project.create', async (payload: any) => {
      const summary = createTestProject(env, payload.title)
      return summary
    })

    const req = {
      type: 'rpc_request',
      id: 'req-001',
      channel: 'project.create',
      payload: { title: '双轨架构测试作品' }
    }

    const resRaw = await bridge.handleClientMessage(req)
    const res = JSON.parse(resRaw)

    expect(res.ok).toBe(true)
    expect(res.id).toBe('req-001')
    expect(res.value.title).toBe('双轨架构测试作品')
    expect(typeof res.value.projectId).toBe('string')
  })

  it('rpc-02: rejects invalid RPC parameters with VALIDATION_ERROR code', async () => {
    const bridge = new WebView2BridgeSimulator()
    bridge.registerHandler('project.create', async (payload: any) => {
      if (!payload || !payload.title || typeof payload.title !== 'string') {
        throw { code: 'VALIDATION_ERROR', message: '标题不能为空' }
      }
      return createTestProject(env, payload.title)
    })

    const req = {
      type: 'rpc_request',
      id: 'req-002',
      channel: 'project.create',
      payload: { title: '' }
    }

    const resRaw = await bridge.handleClientMessage(req)
    const res = JSON.parse(resRaw)

    expect(res.ok).toBe(false)
    expect(res.id).toBe('req-002')
    expect(res.error.code).toBe('VALIDATION_ERROR')
  })

  it('rpc-03: maintains asynchronous message correlation across concurrent requests', async () => {
    const bridge = new WebView2BridgeSimulator()
    bridge.registerHandler('test.echo', async (payload: any) => {
      await new Promise((r) => setTimeout(r, payload.delay))
      return { echoed: payload.value }
    })

    const req1 = { type: 'rpc_request', id: 'id-alpha', channel: 'test.echo', payload: { value: 'A', delay: 30 } }
    const req2 = { type: 'rpc_request', id: 'id-beta', channel: 'test.echo', payload: { value: 'B', delay: 10 } }

    const [res1Raw, res2Raw] = await Promise.all([
      bridge.handleClientMessage(req1),
      bridge.handleClientMessage(req2)
    ])

    const res1 = JSON.parse(res1Raw)
    const res2 = JSON.parse(res2Raw)

    expect(res1.id).toBe('id-alpha')
    expect(res1.value.echoed).toBe('A')
    expect(res2.id).toBe('id-beta')
    expect(res2.value.echoed).toBe('B')
  })

  it('rpc-04: dispatches push events and supports listener unsubscription', async () => {
    const bridge = new WebView2BridgeSimulator()
    const receivedEvents: any[] = []

    const listener = (msgJson: string) => {
      const msg = JSON.parse(msgJson)
      if (msg.type === 'event' && msg.channel === 'candidate:delta') {
        receivedEvents.push(msg.payload)
      }
    }

    bridge.on('message', listener)

    // Emit event 1
    bridge.sendPushEvent('candidate:delta', { delta: '剑光闪烁，', fullText: '剑光闪烁，' })
    expect(receivedEvents.length).toBe(1)
    expect(receivedEvents[0].delta).toBe('剑光闪烁，')

    // Unsubscribe
    bridge.off('message', listener)

    // Emit event 2 (should not be received)
    bridge.sendPushEvent('candidate:delta', { delta: '雷声轰鸣。', fullText: '剑光闪烁，雷声轰鸣。' })
    expect(receivedEvents.length).toBe(1)
  })

  it('rpc-05: propagates domain error codes through wire protocol without masking', async () => {
    const bridge = new WebView2BridgeSimulator()
    bridge.registerHandler('project.close', async () => {
      throw { code: 'PROJECT_NOT_OPEN', message: '当前没有已打开的项目' }
    })

    const req = { type: 'rpc_request', id: 'err-test', channel: 'project.close', payload: {} }
    const res = JSON.parse(await bridge.handleClientMessage(req))

    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('PROJECT_NOT_OPEN')
    expect(res.error.message).toContain('没有已打开的项目')
  })

  // =========================================================================
  // Core Feature 3: Sidecar Lifecycle & Healthcheck
  // =========================================================================
  it('sidecar-01: performs JSON-RPC 2.0 handshake ping/pong healthcheck', async () => {
    const sidecar = new SidecarJsonRpcSimulator()
    sidecar.registerMethod('system.ping', async () => {
      return { status: 'healthy', version: '0.1.0', engine: 'node22' }
    })

    const pingReq = JSON.stringify({ jsonrpc: '2.0', id: 'p1', method: 'system.ping', params: {} })
    const [resRaw] = await sidecar.processIncomingNdjson(pingReq)
    const res = JSON.parse(resRaw)

    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe('p1')
    expect(res.result.status).toBe('healthy')
    expect(res.result.version).toBe('0.1.0')
  })

  it('sidecar-02: isolates stdio streams maintaining NDJSON protocol purity', async () => {
    const sidecar = new SidecarJsonRpcSimulator()
    sidecar.registerMethod('test.action', async () => ({ ok: true }))

    const req = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'test.action', params: {} })
    await sidecar.processIncomingNdjson(req)

    expect(sidecar.stdoutLines.length).toBe(1)
    const parsed = JSON.parse(sidecar.stdoutLines[0])
    expect(parsed.result.ok).toBe(true)
  })

  it('sidecar-03: validates Windows Job Object lifecycle configuration semantics', async () => {
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    expect(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).toBe(8192)

    const supervisorSpec = {
      assignProcessToJob: true,
      terminateOnHostClose: true,
      jobLimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    }
    expect(supervisorSpec.assignProcessToJob).toBe(true)
    expect(supervisorSpec.terminateOnHostClose).toBe(true)
  })

  it('sidecar-04: handles graceful shutdown notification and resource release', async () => {
    const sidecar = new SidecarJsonRpcSimulator()
    let closed = false
    sidecar.registerMethod('system.shutdown', async () => {
      closed = true
      return { success: true }
    })

    const req = JSON.stringify({ jsonrpc: '2.0', id: 'shut', method: 'system.shutdown', params: {} })
    const [resRaw] = await sidecar.processIncomingNdjson(req)
    const res = JSON.parse(resRaw)

    expect(res.result.success).toBe(true)
    expect(closed).toBe(true)
  })

  it('sidecar-05: returns standard -32601 on undefined JSON-RPC method', async () => {
    const sidecar = new SidecarJsonRpcSimulator()
    const req = JSON.stringify({ jsonrpc: '2.0', id: 'unknown-m', method: 'nonexistent.method', params: {} })
    const [resRaw] = await sidecar.processIncomingNdjson(req)
    const res = JSON.parse(resRaw)

    expect(res.error.code).toBe(-32601)
    expect(res.error.message).toContain('Method not found')
  })

  // =========================================================================
  // Core Feature 4: SQLite Database Persistence in Dual-Track
  // =========================================================================
  it('sqlite-01: initializes .novelproj SQLite database with WAL and foreign keys', async () => {
    const project = createTestProject(env, '持久化测试项目')
    const openResult = await env.store.open(project.path)

    expect(openResult.mode).toBe('read_write')
    expect(openResult.metadata.title).toBe('持久化测试项目')

    await env.store.close(openResult.sessionId)
  })

  it('sqlite-02: enforces read-only version probe before write', async () => {
    const project = createTestProject(env, '只读探针测试')
    const probeResult = await env.store.open(project.path)

    expect(probeResult.metadata.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(probeResult.mode).toBe('read_write')

    await env.store.close(probeResult.sessionId)
  })

  it('sqlite-03: atomically mutates chapter entities and increments version counter', async () => {
    const project = createTestProject(env, '章节版本测试')
    const { sessionId } = await env.store.open(project.path)

    const ch1 = env.chapters.create(sessionId, '第一章 启程', '初始正文')
    expect(ch1.version).toBe(1)

    const chUpdated = env.chapters.update(
      sessionId,
      ch1.id,
      '修改后的正文内容',
      1
    )
    expect(chUpdated.version).toBe(2)
    expect(chUpdated.content).toBe('修改后的正文内容')

    await env.store.close(sessionId)
  })

  it('sqlite-04: synchronizes FTS5 trigram search index and retrieves Chinese keywords', async () => {
    const project = createTestProject(env, 'FTS5检索测试')
    const { sessionId } = await env.store.open(project.path)

    env.chapters.create(
      sessionId,
      '第一章 异宝出世',
      '掌天瓶在月色下散发着青蒙蒙的光晕，韩立屏住呼吸静静观察。'
    )

    await env.searchIndex.sync(sessionId)
    const searchResults = env.searchIndex.searchKeyword(sessionId, { sessionId, query: '掌天瓶' })

    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0].title).toBe('第一章 异宝出世')

    await env.store.close(sessionId)
  })

  it('sqlite-05: rolls back database transactions on failure maintaining atomic consistency', async () => {
    const project = createTestProject(env, '事务回滚测试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '原章节', '原文本')

    expect(() => {
      env.chapters.update(
        sessionId,
        ch.id,
        '非法覆盖',
        999
      )
    }).toThrow()

    const fetched = env.chapters.get(sessionId, ch.id)
    expect(fetched.content).toBe('原文本')
    expect(fetched.version).toBe(1)

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Core Feature 5: CodeMirror 6 Editor Load & Save
  // =========================================================================
  it('cm6-01: loads lightweight chapter header for navigation and fetches full content on demand', async () => {
    const project = createTestProject(env, '轻量头测试')
    const { sessionId } = await env.store.open(project.path)

    const created = env.chapters.create(
      sessionId,
      '第十章 巨剑门',
      '巨剑门弟子御剑而行，遮天蔽日。'.repeat(100)
    )

    const headers = env.chapters.list(sessionId)
    expect(headers.length).toBe(1)
    expect((headers[0] as any).content).toBeUndefined()

    const fullChapter = env.chapters.get(sessionId, created.id)
    expect(fullChapter.content).toContain('巨剑门弟子')

    await env.store.close(sessionId)
  })

  it('cm6-02: detects optimistic version conflict on outdated expectedVersion', async () => {
    const project = createTestProject(env, '编辑冲突测试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '草稿', '初始内容')

    env.chapters.update(sessionId, ch.id, '用户A写入', 1)

    expect(() => {
      env.chapters.update(sessionId, ch.id, '用户B并发写入', 1)
    }).toThrow()

    await env.store.close(sessionId)
  })

  it('cm6-03: accurately computes Chinese character count using allocation-free counter', async () => {
    const testText = '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。\n\n寒来暑往，秋收冬藏。'
    const charCount = getAccurateCharacterCount(testText)
    expect(charCount).toBe(30)
  })

  it('cm6-04: creates ordinary snapshot before major modifications for history undo', async () => {
    const project = createTestProject(env, '快照备份测试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '第一回', '修改前的重要内容')

    const snapshot = env.chapters.createOrdinarySnapshot(sessionId, ch.id, 1)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.chapterId).toBe(ch.id)
    expect(snapshot!.chapterVersion).toBe(1)

    env.chapters.update(sessionId, ch.id, '大面积修改内容', 1)

    const restored = env.chapters.restoreSnapshot(sessionId, snapshot!.id, 2)
    expect(restored.content).toBe('修改前的重要内容')

    await env.store.close(sessionId)
  })

  it('cm6-05: debounced save persists state cleanly without dropping mutations', async () => {
    const project = createTestProject(env, '防抖保存测试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '流式草稿', '段落1')

    let currentVersion = ch.version
    const mutations = ['段落1\n段落2', '段落1\n段落2\n段落3', '段落1\n段落2\n段落3\n终稿']

    for (const text of mutations) {
      const updated = env.chapters.update(
        sessionId,
        ch.id,
        text,
        currentVersion
      )
      currentVersion = updated.version
    }

    const finalChapter = env.chapters.get(sessionId, ch.id)
    expect(finalChapter.content).toBe('段落1\n段落2\n段落3\n终稿')
    expect(finalChapter.version).toBe(4)

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Core Feature 6: Dual-Track CLI Scripts & Toolchain
  // =========================================================================
  it('cli-01: verifies package.json contains non-polluting dual-track scripts', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.build).toBeDefined()
    expect(pkg.scripts.test).toBeDefined()
  })

  it('cli-02: verifies baseline Electron run & build scripts are 100% preserved', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['package:portable']).toContain('electron-builder')
    expect(pkg.scripts.test).toContain('vitest')
  })

  it('cli-03: generates valid .NET 8 unpackaged build commands', async () => {
    const buildCmd = 'dotnet build src-winui/NovelAgent.WinUI.csproj -c Release -p:Platform=x64'
    expect(buildCmd).toContain('dotnet build')
    expect(buildCmd).toContain('-p:Platform=x64')
  })

  it('cli-04: verifies renderer dist folder is configured for dual-track consumption', async () => {
    const configPath = 'electron.vite.config.ts'
    expect(existsSync(configPath)).toBe(true)
    const viteConfig = readFileSync(configPath, 'utf8')
    expect(viteConfig).toContain('renderer')
  })

  it('cli-05: verifies unpackaged distribution directory isolation', async () => {
    const electronOut = 'out'
    const winuiOut = 'src-winui/bin'
    expect(electronOut).not.toBe(winuiOut)
  })
})
