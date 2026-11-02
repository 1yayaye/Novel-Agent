/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

import { PresetConversionService } from '../src/main/preset-conversion'
import { ProjectStore } from '../src/main/project-store'
import { ConnectionStore, calculateContentTargetFingerprint } from '../src/main/connection-store'
import type { ModelGateway, ChatMessage } from '../src/main/model-gateway'
import { PromptSettingsStore, presetContentFingerprint } from '../src/main/prompt-store'
import { compilePromptMessages } from '../src/main/prompt-runtime'
import type { NovelPromptPreset, PresetConversionStatus } from '../src/shared/project'
import { PresetConversionDialog } from '../src/renderer/components/dialogs/PresetConversionDialog'

const fixturesDir = join(process.cwd(), 'tests/fixtures/tavern-presets')
const tempDir = join(process.cwd(), 'test-results/preset-conversion/real-tests')

const REAL_FIXTURES = [
  { file: 'Izumi 1002.json', minItems: 200 },
  { file: 'Kemini_Dramatron_v3.1.json', minItems: 50 },
  { file: '[主预设] V19.7.3 狐神抚 · 毓忻.json', minItems: 200 },
  { file: '智脑-Z（10.1）-2.json', minItems: 80 }
]

function setupEnvironment() {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
  mkdirSync(tempDir, { recursive: true })

  const projectStore = new ProjectStore(tempDir)
  const connectionStore = new ConnectionStore(tempDir)

  // 创建真实生成连接
  const connection = connectionStore.create({
    name: '测试生成模型',
    kind: 'generation',
    baseUrl: 'https://api.example.com/v1',
    model: 'gemini-2.5-flash',
    apiKey: 'sk-test-key-123456',
    isLocalService: false,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    safetyMarginRatio: 0.1,
    tokenEstimationRatio: 1.2
  })

  const fingerprint = calculateContentTargetFingerprint(connection.baseUrl, connection.model)
  connectionStore.confirmContentTarget(connection.id, fingerprint)

  return { projectStore, connectionStore, connection }
}

describe('真实测试 1：四个真实酒馆预设文件的静态检查与特征解析 (inspect)', () => {
  let projectStore: ProjectStore
  let connectionStore: ConnectionStore
  let connection: any

  beforeEach(() => {
    const env = setupEnvironment()
    projectStore = env.projectStore
    connectionStore = env.connectionStore
    connection = env.connection
  })

  afterEach(() => {
    cleanup()
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it.each(REAL_FIXTURES)('真实检查 $file：来源条目、字符统计、Token 预估与上游参考规范', ({ file, minItems }) => {
    const filePath = join(fixturesDir, file)
    const jsonContent = readFileSync(filePath, 'utf8')
    const service = new PresetConversionService(projectStore, connectionStore, undefined, () => {})

    const inspection = service.inspect({
      jsonContent,
      fileName: file,
      connectionId: connection.id
    })

    // 格式与指纹断言
    expect(inspection.format).toBe('tavern')
    expect(inspection.sourceFingerprint).toBe(createHash('sha256').update(jsonContent).digest('hex'))
    expect(inspection.sourceCharacters).toBe(jsonContent.length)
    expect(inspection.name).toBeTruthy()

    // 来源条目条数与分类断言
    expect(inspection.items.length).toBeGreaterThanOrEqual(minItems)
    const kinds = new Set(inspection.items.map((i) => i.kind))
    expect(kinds.has('prompt')).toBe(true)

    // Token 与批次估算
    expect(inspection.estimatedSourceTokens).toBeGreaterThan(0)
    expect(inspection.initialAnalysisBatches).toBeGreaterThan(0)

    // 上游参考资料断言
    expect(inspection.referenceVersion).toBe('2026-10-12.1')
    expect(inspection.references.length).toBeGreaterThanOrEqual(2)
    expect(inspection.references.some((r) => r.name.includes('SillyTavern'))).toBe(true)
    expect(inspection.references.some((r) => r.name.includes('Tavern Helper') || r.url.includes('JS-Slash-Runner'))).toBe(true)
  })
})

describe('真实测试 2：原生预设零模型导入、归档、时间戳更新与哈希跟踪', () => {
  let projectStore: ProjectStore
  let connectionStore: ConnectionStore

  beforeEach(() => {
    const env = setupEnvironment()
    projectStore = env.projectStore
    connectionStore = env.connectionStore
  })

  afterEach(() => {
    cleanup()
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it('原生预设不调用模型，直接 ready 并持久化到来源归档目录', async () => {
    const originalPreset: NovelPromptPreset = {
      id: 'old-preset-uuid',
      name: '原生小说创作预设',
      description: '全套静态插槽',
      blocks: [
        { id: 'b1', name: '系统设定', role: 'system', content: '专业小说创作。', enabled: true, position: 'relative', depth: 0, order: 0 },
        { id: 'b2', name: '历史插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 1, marker: 'marker.history' },
        { id: 'b3', name: '任务插槽', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.task' }
      ],
      createdAt: 1000,
      updatedAt: 1000
    }

    const jsonContent = JSON.stringify(originalPreset)
    const progressStatuses: PresetConversionStatus[] = []
    const service = new PresetConversionService(projectStore, connectionStore, undefined, (status) => {
      progressStatuses.push(status)
    })

    // 1. inspect 确认格式为 novel
    const inspection = service.inspect({ jsonContent, fileName: 'export.json' })
    expect(inspection.format).toBe('novel')
    expect(inspection.connection).toBeNull()
    expect(inspection.items).toHaveLength(0)

    // 2. start 启动任务
    const { taskId } = service.start({ jsonContent, fileName: 'export.json' })
    expect(taskId).toBeTruthy()

    // 验证原文件已被归档保存
    const expectedFingerprint = createHash('sha256').update(jsonContent).digest('hex')
    const archivePath = join(projectStore.dataDirectory, 'preset-conversion-sources', `${expectedFingerprint}.json`)
    expect(existsSync(archivePath)).toBe(true)
    expect(readFileSync(archivePath, 'utf8')).toBe(jsonContent)

    // 等待微任务完成直接进入 ready
    await new Promise((r) => setTimeout(r, 20))
    const status = service.getStatus(taskId)
    expect(status.state).toBe('ready')

    // 3. 读取结果
    const result = service.getResult(taskId)
    expect(result.format).toBe('novel')
    expect(result.preset.name).toBe('原生小说创作预设')
    expect(result.preset.id).not.toBe('old-preset-uuid') // 生成了全新 ID
    expect(result.preset.createdAt).toBeGreaterThan(1000) // 更新了时间戳
    expect(result.preset.blocks).toHaveLength(3)

    // 4. 保存至全局预设库
    const promptStore = new PromptSettingsStore(tempDir)
    const saved = promptStore.save({
      activePresetId: result.preset.id,
      presets: [result.preset]
    })
    expect(saved.store.activePresetId).toBe(result.preset.id)
    expect(promptStore.getActivePreset()?.id).toBe(result.preset.id)
  })
})

describe('真实测试 3：转换报告生成、编译集成与 modified 偏离检测', () => {
  let projectStore: ProjectStore
  let connectionStore: ConnectionStore
  let connection: any

  beforeEach(() => {
    const env = setupEnvironment()
    projectStore = env.projectStore
    connectionStore = env.connectionStore
    connection = env.connection
  })

  afterEach(() => {
    cleanup()
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it('转换为预设附加 conversionReport，在编辑内容后 modified 自动标为 true', () => {
    const promptStore = new PromptSettingsStore(tempDir)
    const testPreset: NovelPromptPreset = {
      id: 'converted-p1',
      name: 'AI 转换后预设',
      description: '由酒馆预设转换',
      blocks: [
        { id: 'b1', name: '系统设定', role: 'system', content: '故事背景。', enabled: true, position: 'relative', depth: 0, order: 0 },
        { id: 'b2', name: '历史', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 1, marker: 'marker.history' },
        { id: 'b3', name: '任务', role: 'user', content: '', enabled: true, position: 'relative', depth: 0, order: 2, marker: 'marker.task' }
      ],
      conversionReport: {
        sourceFingerprint: 'mock-src-fp',
        referenceVersion: '2026-10-12.1',
        references: [],
        model: { connectionId: connection.id, connectionVersion: 1, name: 'Gemini', model: 'gemini' },
        createdAt: Date.now(),
        convertedFingerprint: '',
        modified: false,
        compatibility: 'ai-adapted-static',
        items: [
          { sourceId: 'src-1', path: '$.prompts[0]', name: '系统设定', kind: 'prompt', disposition: 'retained', reason: '保留', targetBlockIds: ['b1'], losses: [] }
        ],
        warnings: [],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, requests: 1, reportedRequests: 1 }
      },
      createdAt: 1000,
      updatedAt: 1000
    }

    // 计算初始 convertedFingerprint
    testPreset.conversionReport!.convertedFingerprint = presetContentFingerprint(testPreset)

    // 初始保存：modified 应为 false
    const state1 = promptStore.save({ activePresetId: testPreset.id, presets: [testPreset] })
    expect(state1.store.presets[0].conversionReport?.modified).toBe(false)

    // 编辑内容（修改了 Block 正文）
    const modifiedPreset: NovelPromptPreset = {
      ...testPreset,
      blocks: [
        { ...testPreset.blocks[0], content: '故事背景已由作者二次编辑。' },
        testPreset.blocks[1],
        testPreset.blocks[2]
      ]
    }

    // 保存后：modified 应自动更新为 true
    const state2 = promptStore.save({ activePresetId: modifiedPreset.id, presets: [modifiedPreset] })
    expect(state2.store.presets[0].conversionReport?.modified).toBe(true)

    // 验证提示词编译能够正常集成该预设
    const snap = promptStore.snapshot()
    const messages = compilePromptMessages('continue', {
      instruction: '描写下一幕。',
      materials: {
        knowledge: [{ role: 'user', content: '设定资料' }]
      }
    }, snap)

    expect(messages.some((m) => m.content.includes('故事背景已由作者二次编辑'))).toBe(true)
  })
})

describe('真实测试 4：前端 PresetConversionDialog 挂载真实 500KB 酒馆文件', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('真实挂载 Kemini_Dramatron_v3.1.json 预设文件并展示真实统计数据', async () => {
    const rawContent = readFileSync(join(fixturesDir, 'Kemini_Dramatron_v3.1.json'), 'utf8')
    const realFile = new File([rawContent], 'Kemini_Dramatron_v3.1.json', { type: 'application/json' })

    const env = setupEnvironment()
    const service = new PresetConversionService(env.projectStore, env.connectionStore, undefined, () => {})

    // 将真实 service 的 inspect 挂在 window.novelAgent 上
    const bridge = {
      prompt: {
        inspectPresetConversion: vi.fn().mockImplementation(async (input) => service.inspect(input)),
        startPresetConversion: vi.fn().mockResolvedValue({ taskId: 'real-task-123' }),
        getPresetConversionStatus: vi.fn(),
        getPresetConversionResult: vi.fn(),
        cancelPresetConversion: vi.fn(),
        onPresetConversionProgress: vi.fn().mockReturnValue(() => {}),
        getPresetStore: vi.fn().mockResolvedValue({ store: { activePresetId: null, presets: [] }, warnings: [] }),
        savePresetStore: vi.fn()
      },
      connection: {
        list: vi.fn().mockResolvedValue(env.connectionStore.list('generation'))
      }
    }
    Object.defineProperty(window, 'novelAgent', { configurable: true, value: bridge })

    render(
      <PresetConversionDialog
        open={true}
        file={realFile}
        onClose={vi.fn()}
        onImportSuccess={vi.fn()}
      />
    )

    // 验证真实文件解析在 UI 上的呈现
    await screen.findByText('酒馆预设 (Tavern)')
    expect(screen.getByText(/Kemini_Dramatron_v3\.1\.json/)).toBeTruthy()
    // 字符数应真实显示
    expect(screen.getByText('字符总数')).toBeTruthy()
    expect(screen.getAllByText(/字/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '开始 AI 转换' })).toBeTruthy()
    expect(bridge.prompt.inspectPresetConversion).toHaveBeenCalledTimes(1)
  })
})
