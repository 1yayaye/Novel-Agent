/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PresetConversionInspection,
  PresetConversionStatus,
  PresetConversionResult,
  PresetConversionReport,
  NovelPromptPreset,
  PresetStoreData
} from '../src/shared/project'
import { PresetConversionReportView } from '../src/renderer/components/dialogs/PresetConversionReportView'
import { PresetConversionReportDialog } from '../src/renderer/components/dialogs/PresetConversionReportDialog'
import { PresetConversionDialog } from '../src/renderer/components/dialogs/PresetConversionDialog'
import { CreativeSettingsDialog } from '../src/renderer/components/dialogs/CreativeSettingsDialog'
import { useProjectStore } from '../src/renderer/stores/useProjectStore'
import { useWorkbenchStore } from '../src/renderer/stores/useWorkbenchStore'
import { useEditorStore } from '../src/renderer/stores/useEditorStore'
import { useTaskStore } from '../src/renderer/stores/useTaskStore'

const mockReport: PresetConversionReport = {
  sourceFingerprint: 'mock-source-fingerprint-1234567890',
  fileName: 'test-tavern-preset.json',
  referenceVersion: '2026-10-12.1',
  references: [
    { name: 'SillyTavern', revision: 'abcdef123456', url: 'https://github.com/SillyTavern/SillyTavern' },
    { name: 'JS-Slash-Runner', revision: '789012abcdef', url: 'https://github.com/SillyTavern/JS-Slash-Runner' }
  ],
  model: {
    connectionId: '00000000-0000-4000-8000-000000000001',
    connectionVersion: 1,
    name: 'Gemini 2.5 Flash',
    model: 'gemini-2.5-flash'
  },
  createdAt: 1700000000000,
  convertedFingerprint: 'converted-hash-123',
  modified: false,
  compatibility: 'ai-adapted-static',
  items: [
    {
      sourceId: 'src-1',
      path: '$.prompts[0]',
      name: '主系统设定',
      kind: 'prompt',
      disposition: 'retained',
      reason: '直接转换为系统创作设定块',
      targetBlockIds: ['blk-1'],
      losses: []
    },
    {
      sourceId: 'src-2',
      path: '$.extensions.tavern_helper.scripts[0]',
      name: '动态状态宏脚本',
      kind: 'script',
      disposition: 'adapted',
      reason: '将动态脚本改写为静态上下文指导要求',
      targetBlockIds: ['blk-2'],
      losses: ['脚本实时执行逻辑已降级为静态提示词指令']
    },
    {
      sourceId: 'src-3',
      path: '$.regex[0]',
      name: '无用换行消除正则',
      kind: 'regex',
      disposition: 'ignored',
      reason: '本项目有内置排版流水线，无需酒馆正则清洗',
      targetBlockIds: [],
      losses: []
    },
    {
      sourceId: 'src-4',
      path: '$.extensions.unsupported_ext',
      name: '未支持扩展',
      kind: 'extension',
      disposition: 'unsupported',
      reason: '无法静态映射该复杂扩展行为',
      targetBlockIds: [],
      losses: ['扩展功能已整体略过']
    }
  ],
  warnings: ['部分动态宏已被替换为静态占位'],
  usage: {
    promptTokens: 3500,
    completionTokens: 800,
    totalTokens: 4300,
    requests: 2,
    reportedRequests: 2
  }
}

const mockTavernInspection: PresetConversionInspection = {
  format: 'tavern',
  name: '测试酒馆预设',
  sourceFingerprint: 'fp-123',
  sourceCharacters: 15000,
  items: [
    { sourceId: 'src-1', path: '$.prompts[0]', name: '主系统设定', kind: 'prompt', characters: 500, enabled: true, order: 0 },
    { sourceId: 'src-2', path: '$.extensions.script', name: '辅助脚本', kind: 'script', characters: 1200, enabled: true, order: null }
  ],
  referenceVersion: '2026-10-12.1',
  references: [{ name: 'SillyTavern', revision: 'abcdef123', url: 'https://github.com/SillyTavern' }],
  connection: {
    id: '00000000-0000-4000-8000-000000000001',
    version: 1,
    name: 'Gemini 2.5 Flash',
    model: 'gemini-2.5-flash'
  },
  estimatedSourceTokens: 4200,
  initialAnalysisBatches: 2,
  warnings: ['包含 1 个脚本项，将自动进行静态降级适配']
}

const mockNovelInspection: PresetConversionInspection = {
  format: 'novel',
  name: '小说原生预设',
  sourceFingerprint: 'novel-fp-999',
  sourceCharacters: 2000,
  items: [],
  referenceVersion: '2026-10-12.1',
  references: [],
  connection: null,
  estimatedSourceTokens: null,
  initialAnalysisBatches: null,
  warnings: []
}

const mockConvertedPreset: NovelPromptPreset = {
  id: 'preset-converted-1',
  name: '转换后小说预设',
  description: '由酒馆预设自动适配生成',
  blocks: [
    {
      id: 'blk-1',
      name: '系统创作设定',
      role: 'system',
      content: '你是专业小说作家...',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: 0
    },
    {
      id: 'blk-2',
      name: '正文历史插槽',
      role: 'user',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: 1,
      marker: 'marker.history'
    },
    {
      id: 'blk-3',
      name: '作者任务插槽',
      role: 'user',
      content: '',
      enabled: true,
      position: 'relative',
      depth: 0,
      order: 2,
      marker: 'marker.task'
    }
  ],
  conversionReport: mockReport,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
}

const mockResult: PresetConversionResult = {
  taskId: 'task-1111-2222',
  format: 'tavern',
  preset: mockConvertedPreset,
  warnings: ['请审阅生成的历史与作者任务插槽']
}

function mockBridge() {
  let progressCallback: ((status: PresetConversionStatus) => void) | null = null
  return {
    prompt: {
      getPresetStore: vi.fn().mockResolvedValue({
        store: { activePresetId: 'default-p1', presets: [] },
        warnings: []
      }),
      savePresetStore: vi.fn().mockImplementation(async (store: PresetStoreData) => ({
        store: structuredClone(store),
        warnings: []
      })),
      inspectPresetConversion: vi.fn().mockResolvedValue(mockTavernInspection),
      startPresetConversion: vi.fn().mockResolvedValue({ taskId: 'task-1111-2222' }),
      getPresetConversionStatus: vi.fn().mockResolvedValue({
        taskId: 'task-1111-2222',
        name: '测试酒馆预设',
        state: 'analyzing',
        completedBatches: 1,
        totalBatches: 2,
        usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200, requests: 1, reportedRequests: 1 },
        createdAt: 100,
        updatedAt: 200,
        error: null
      } satisfies PresetConversionStatus),
      getPresetConversionResult: vi.fn().mockResolvedValue(mockResult),
      cancelPresetConversion: vi.fn().mockResolvedValue({ success: true }),
      onPresetConversionProgress: vi.fn().mockImplementation((cb) => {
        progressCallback = cb
        return () => { progressCallback = null }
      }),
      _triggerProgress: (status: PresetConversionStatus) => {
        if (progressCallback) progressCallback(status)
      }
    },
    connection: {
      list: vi.fn().mockResolvedValue([
        { id: '00000000-0000-4000-8000-000000000001', name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', kind: 'generation' },
        { id: '00000000-0000-4000-8000-000000000002', name: 'Claude 3.5 Sonnet', model: 'claude-3-5-sonnet', kind: 'generation' }
      ])
    }
  }
}

let bridge: ReturnType<typeof mockBridge>

beforeEach(() => {
  bridge = mockBridge()
  Object.defineProperty(window, 'novelAgent', { configurable: true, value: bridge })
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
  useProjectStore.setState({ project: null, chapters: [], selectedChapterId: null })
  useWorkbenchStore.setState({ activeDialog: null, dialogPayload: null })
  useEditorStore.getState().loadChapter(null)
  useTaskStore.setState({ tasks: [], activeTaskId: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PresetConversionReportView component', () => {
  it('renders model, token usage, warnings and breakdown counts', () => {
    render(<PresetConversionReportView report={mockReport} />)
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy()
    expect(screen.getByText('gemini-2.5-flash')).toBeTruthy()
    expect(screen.getByText('4,300')).toBeTruthy()
    expect(screen.getByText('4 个条目')).toBeTruthy()
    expect(screen.getByText('部分动态宏已被替换为静态占位')).toBeTruthy()
    expect(screen.getByRole('button', { name: /保留/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /改写/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /忽略/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /不支持/ })).toBeTruthy()
  })

  it('filters items by disposition', () => {
    render(<PresetConversionReportView report={mockReport} />)
    expect(screen.getByText('主系统设定')).toBeTruthy()
    expect(screen.getByText('动态状态宏脚本')).toBeTruthy()
    expect(screen.getByText('未支持扩展')).toBeTruthy()

    // 点击过滤为“改写”
    fireEvent.click(screen.getByRole('button', { name: '改写 (1)' }))
    expect(screen.queryByText('主系统设定')).toBeNull()
    expect(screen.getByText('动态状态宏脚本')).toBeTruthy()
    expect(screen.getByText('脚本实时执行逻辑已降级为静态提示词指令')).toBeTruthy()
  })
})

describe('PresetConversionReportDialog component', () => {
  it('renders dialog with preset name and report view', () => {
    const onClose = vi.fn()
    render(<PresetConversionReportDialog open={true} onClose={onClose} presetName="测试预设" report={mockReport} />)
    expect(screen.getByText(/预设：测试预设/)).toBeTruthy()
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PresetConversionDialog workflow', () => {
  it('inspects SillyTavern file, displays items and allows model selection', async () => {
    const file = new File(['{"prompts":[]}'], 'test-tavern.json', { type: 'application/json' })
    render(<PresetConversionDialog open={true} file={file} onClose={vi.fn()} onImportSuccess={vi.fn()} />)

    await screen.findByText('酒馆预设 (Tavern)')
    expect(screen.getByText('15,000 字')).toBeTruthy()
    expect(screen.getByText('4,200 约')).toBeTruthy()
    expect(screen.getByText('2 批')).toBeTruthy()
    expect(screen.getByText('主系统设定')).toBeTruthy()
    expect(screen.getByText('包含 1 个脚本项，将自动进行静态降级适配')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始 AI 转换' })).toBeTruthy()
  })

  it('inspects Native novel format and shows zero-model path', async () => {
    bridge.prompt.inspectPresetConversion.mockResolvedValueOnce(mockNovelInspection)
    const file = new File(['{"blocks":[]}'], 'native-novel.json', { type: 'application/json' })
    render(<PresetConversionDialog open={true} file={file} onClose={vi.fn()} onImportSuccess={vi.fn()} />)

    await screen.findByText('检测为本项目原生预设 (Novel Format)')
    expect(screen.getByText(/无需调用 AI 模型或消耗 Token/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '直接导入预设' })).toBeTruthy()
  })

  it('starts conversion, updates progress, cancels task when requested', async () => {
    const file = new File(['{"prompts":[]}'], 'test-tavern.json', { type: 'application/json' })
    render(<PresetConversionDialog open={true} file={file} onClose={vi.fn()} onImportSuccess={vi.fn()} />)

    await screen.findByRole('button', { name: '开始 AI 转换' })
    fireEvent.click(screen.getByRole('button', { name: '开始 AI 转换' }))

    await screen.findByText('已完成逻辑批次')
    expect(screen.getByText('1 / 2 批')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消转换任务' })).toBeTruthy()

    // 测试点击取消
    fireEvent.click(screen.getByRole('button', { name: '取消转换任务' }))
    await waitFor(() => expect(bridge.prompt.cancelPresetConversion).toHaveBeenCalledWith({ taskId: 'task-1111-2222' }))
  })

  it('transitions to result review when ready, allows editing blocks and saving to preset store', async () => {
    const onImportSuccess = vi.fn()
    const onClose = vi.fn()
    const file = new File(['{"prompts":[]}'], 'test-tavern.json', { type: 'application/json' })
    render(<PresetConversionDialog open={true} file={file} onClose={onClose} onImportSuccess={onImportSuccess} />)

    await screen.findByRole('button', { name: '开始 AI 转换' })
    fireEvent.click(screen.getByRole('button', { name: '开始 AI 转换' }))

    await screen.findByText('已完成逻辑批次')

    // 触发完成状态
    await act(async () => {
      bridge.prompt._triggerProgress({
        taskId: 'task-1111-2222',
        name: '测试酒馆预设',
        state: 'ready',
        completedBatches: 2,
        totalBatches: 2,
        usage: { promptTokens: 3500, completionTokens: 800, totalTokens: 4300, requests: 2, reportedRequests: 2 },
        createdAt: 100,
        updatedAt: 300,
        error: null
      })
    })

    // 进入审阅界面
    await screen.findByText('生成 Block 列表 (3)')
    expect(screen.getByDisplayValue('转换后小说预设')).toBeTruthy()
    expect(screen.getByText('系统创作设定')).toBeTruthy()
    expect(screen.getByText('正文历史插槽')).toBeTruthy()

    // 切换到 AI 兼容报告标签
    fireEvent.click(screen.getByRole('tab', { name: /AI 兼容报告/ }))
    expect(await screen.findByText('Gemini 2.5 Flash')).toBeTruthy()

    // 点击“保存并设为当前活跃预设”
    fireEvent.click(screen.getByRole('button', { name: '保存并设为当前活跃预设' }))
    await waitFor(() => expect(bridge.prompt.savePresetStore).toHaveBeenCalledTimes(1))

    const savedArg = bridge.prompt.savePresetStore.mock.calls[0][0] as PresetStoreData
    expect(savedArg.activePresetId).toBe('preset-converted-1')
    expect(savedArg.presets).toHaveLength(1)
    expect(savedArg.presets[0].name).toBe('转换后小说预设')
    expect(onImportSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('handles inspection error and displays retry button', async () => {
    bridge.prompt.inspectPresetConversion.mockRejectedValueOnce(new Error('JSON 格式损坏无法解析'))
    const file = new File(['bad json'], 'bad.json', { type: 'application/json' })
    render(<PresetConversionDialog open={true} file={file} onClose={vi.fn()} onImportSuccess={vi.fn()} />)

    await screen.findByText('预设检查或转换发生错误')
    expect(screen.getByText(/JSON 格式损坏无法解析/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy()
  })
})

describe('CreativeSettingsDialog preset conversion integration', () => {
  it('displays AI conversion badge, modification status and allows viewing compatibility report', async () => {
    const existingPresetWithReport: NovelPromptPreset = {
      ...mockConvertedPreset,
      id: 'existing-p1',
      name: '已有AI预设',
      conversionReport: {
        ...mockReport,
        modified: true
      }
    }

    bridge.prompt.getPresetStore.mockResolvedValueOnce({
      store: {
        activePresetId: 'existing-p1',
        presets: [existingPresetWithReport]
      },
      warnings: []
    })

    render(<CreativeSettingsDialog onClose={vi.fn()} />)

    await screen.findByText('AI 转换预设')
    expect(screen.getByText('已偏离转换初始')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看兼容报告' })).toBeTruthy()

    // 点击查看兼容报告打开弹窗
    fireEvent.click(screen.getByRole('button', { name: '查看兼容报告' }))
    expect(await screen.findByText('AI 预设转换兼容性报告')).toBeTruthy()
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy()
  })
})
