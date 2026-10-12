/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRESET_STORE, type PresetStoreData, type NovelPromptPreset } from '../src/shared/prompt-settings'
import { CreativeSettingsDialog } from '../src/renderer/components/dialogs/CreativeSettingsDialog'
import { ContextPreviewDialog } from '../src/renderer/components/dialogs/ContextPreviewDialog'
import { ChatWorkbenchDialog } from '../src/renderer/components/dialogs/ChatWorkbenchDialog'
import { DialogHost } from '../src/renderer/features/dialogs/DialogHost'
import { useProjectStore } from '../src/renderer/stores/useProjectStore'
import { useWorkbenchStore } from '../src/renderer/stores/useWorkbenchStore'
import { useEditorStore } from '../src/renderer/stores/useEditorStore'
import { useTaskStore } from '../src/renderer/stores/useTaskStore'

vi.mock('../src/renderer/components/editor/ProseEditor.js', () => ({
  ProseEditor: ({ value, onChange, readOnly }: any) => <textarea aria-label="作品规则正文" value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
}))

const sessionId = '00000000-0000-4000-8000-000000000001'
const chapterId = '00000000-0000-4000-8000-000000000002'
const chatId = '00000000-0000-4000-8000-000000000003'
const connectionId = '00000000-0000-4000-8000-000000000004'
const packageId = '00000000-0000-4000-8000-000000000005'
const defaultStore = (): PresetStoreData => structuredClone(DEFAULT_PRESET_STORE)
const chapter = { id: chapterId, title: '本章', position: 0, content: '作者原文。', characterCount: 5, version: 1, createdAt: 1, updatedAt: 1 }
const outlineText = ['本章目标', '场景节拍', '人物与动机', '冲突与信息增量', '连续性风险', '结尾钩子'].map((name) => `## 【${name}】\n本章资料。`).join('\n')

function context(overrides: Record<string, unknown> = {}): any {
  return { id: packageId, taskType: 'continue', stage: null, workflowType: null, target: { chapterId }, connectionId, configurationFingerprint: 'frozen-request', promptSnapshot: { activePreset: null, definitionFingerprint: 'definition', fingerprint: 'saved', budget: { connectionId, connectionVersion: 1, contextWindow: 10000, maxOutputTokens: 2000, safetyMarginRatio: 0.1, tokenEstimationRatio: 1.3 } }, messages: [{ role: 'system', content: '固定协议' }, { role: 'assistant', content: '历史回复' }, { role: 'user', content: '本次任务' }], systemMessage: '错误的旧汇总', userMessage: '错误的旧汇总', items: [], excludedItems: [], estimatedInputTokens: 20, availableInputTokens: 7000, warnings: [], ...overrides }
}

function api() {
  return {
    prompt: {
      getPresetStore: vi.fn().mockResolvedValue({ store: defaultStore(), warnings: [] }),
      savePresetStore: vi.fn().mockImplementation(async (input) => ({ store: structuredClone(input), warnings: [] })),
      parseTavernFile: vi.fn().mockResolvedValue({ id: 'imported-1', name: '导入的预设', blocks: [], createdAt: 1, updatedAt: 1 }),
      getBundle: vi.fn().mockResolvedValue({ rules: { content: '作者自定义规则', version: 3 }, presets: [], styleSamples: [] })
    },
    connection: { list: vi.fn().mockResolvedValue([{ id: connectionId, name: 'Gemini 兼容服务', model: 'gemini', kind: 'generation' }]) },
    preset: { list: vi.fn().mockResolvedValue([]) }, styleSample: { list: vi.fn().mockResolvedValue([]) },
    creativeRule: { update: vi.fn() },
    context: { preview: vi.fn().mockResolvedValue(context()), get: vi.fn().mockResolvedValue(context({ stage: 'chapter_outline', workflowType: 'creation_workflow' })) },
    creation: { start: vi.fn().mockResolvedValue({ taskId: 'task-1', candidateId: 'candidate-1' }) },
    candidate: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ id: 'candidate-1', chapterId, chapterVersion: 1, originalContent: '', rawOutput: '<thinking>污染</thinking>正文', version: 1, state: 'ready', hunks: [{ id: 'hunk-1', position: 0, hunkType: 'insert', originalContent: '', candidateContent: '纯正文', selected: true }], createdAt: 1, updatedAt: 1 }) },
    chapter: { list: vi.fn().mockResolvedValue([chapter]) }, task: { list: vi.fn().mockResolvedValue([]) },
    chat: { list: vi.fn().mockResolvedValue([{ id: chatId, title: '本章协作', targetChapterId: chapterId, workflowType: 'creation_workflow', stage: 'chapter_outline', version: 2, createdAt: 1, updatedAt: 1 }]), listMessages: vi.fn().mockResolvedValue([{ id: 'message-1', chatSessionId: chatId, role: 'assistant', state: 'completed', content: outlineText, contextPackageId: packageId, createdAt: 1 }]), getSummary: vi.fn().mockResolvedValue(null), updateStage: vi.fn() },
    outline: { getLatestChapterOutline: vi.fn().mockResolvedValue(null), saveChapterOutline: vi.fn().mockResolvedValue({ id: 'outline-1', chapterId, content: outlineText, state: 'draft', version: 1 }), confirmChapterOutline: vi.fn() }
  }
}

let bridge: ReturnType<typeof api>
beforeEach(() => {
  bridge = api()
  Object.defineProperty(window, 'novelAgent', { configurable: true, value: bridge })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  useProjectStore.setState({ project: null, chapters: [], selectedChapterId: null })
  useWorkbenchStore.setState({ activeDialog: null, dialogPayload: null })
  useEditorStore.getState().loadChapter(null)
  useTaskStore.setState({ tasks: [], activeTaskId: null })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('global creative settings and request preview', () => {
  it('shows empty state onboarding card when preset store is initially empty', async () => {
    render(<CreativeSettingsDialog onClose={vi.fn()} />)
    await screen.findByText('尚未创建或导入预设')
    expect(screen.getAllByRole('button', { name: '新建空白预设' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: '导入酒馆预设 (.json)' }).length).toBeGreaterThanOrEqual(1)
  })

  it('allows creating a blank preset, toggling a block and saving preset store', async () => {
    render(<CreativeSettingsDialog onClose={vi.fn()} />)
    await screen.findByText('尚未创建或导入预设')
    fireEvent.click(screen.getAllByRole('button', { name: '新建空白预设' })[0])
    const toggle = await screen.findByRole('switch', { name: '系统创作设定' })
    fireEvent.click(toggle)
    expect(screen.getByText('待保存')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存全局设置' }))
    await waitFor(() => expect(bridge.prompt.savePresetStore).toHaveBeenCalledTimes(1))
    const savedArg = bridge.prompt.savePresetStore.mock.calls[0][0] as PresetStoreData
    expect(savedArg.presets).toHaveLength(1)
    expect(savedArg.presets[0].blocks.find((b) => b.name === '系统创作设定')?.enabled).toBe(false)
  })

  it('retains draft when saving preset store fails', async () => {
    bridge.prompt.savePresetStore.mockRejectedValue(new Error('磁盘无法写入'))
    const preset: NovelPromptPreset = {
      id: 'p1', name: '预设1', blocks: [{ id: 'b1', name: '系统创作设定', role: 'system', content: 'c', enabled: true, position: 'relative', depth: 0, order: 0 }], createdAt: 1, updatedAt: 1
    }
    bridge.prompt.getPresetStore.mockResolvedValue({ store: { activePresetId: 'p1', presets: [preset] }, warnings: [] })
    render(<CreativeSettingsDialog onClose={vi.fn()} />)
    const toggle = await screen.findByRole('switch', { name: '系统创作设定' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '保存全局设置' }))
    await screen.findByText(/磁盘无法写入/)
  })

  it('opens confirmation dialog before deleting an active preset', async () => {
    const preset: NovelPromptPreset = {
      id: 'p1', name: '预设1', blocks: [{ id: 'b1', name: '系统创作设定', role: 'system', content: 'c', enabled: true, position: 'relative', depth: 0, order: 0 }], createdAt: 1, updatedAt: 1
    }
    bridge.prompt.getPresetStore.mockResolvedValue({ store: { activePresetId: 'p1', presets: [preset] }, warnings: [] })
    render(<CreativeSettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('switch', { name: '系统创作设定' })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByText(/确定要删除预设「预设1」吗/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除预设' }))
    await screen.findByText('尚未创建或导入预设')
  })

  it('offers repair saving when a damaged configuration fell back to empty preset with warnings', async () => {
    bridge.prompt.getPresetStore.mockResolvedValue({ store: defaultStore(), warnings: ['配置损坏，原文件已保留'] })
    render(<CreativeSettingsDialog onClose={vi.fn()} />)
    expect((await screen.findAllByText('配置损坏，原文件已保留')).length).toBeGreaterThanOrEqual(1)
    expect((screen.getByRole('button', { name: '保存全局设置' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '保存全局设置' }))
    await waitFor(() => expect(bridge.prompt.savePresetStore).toHaveBeenCalledWith(defaultStore()))
  })

  it('allows global saving with a read-only project and leaves its author rules intact', async () => {
    const preset: NovelPromptPreset = {
      id: 'p1', name: '预设1', blocks: [{ id: 'b1', name: '系统创作设定', role: 'system', content: 'c', enabled: true, position: 'relative', depth: 0, order: 0 }], createdAt: 1, updatedAt: 1
    }
    bridge.prompt.getPresetStore.mockResolvedValue({ store: { activePresetId: 'p1', presets: [preset] }, warnings: [] })
    render(<CreativeSettingsDialog sessionId={sessionId} isReadOnly onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('switch', { name: '系统创作设定' }))
    fireEvent.click(screen.getByRole('button', { name: '保存全局设置' }))
    await waitFor(() => expect(bridge.prompt.savePresetStore).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('tab', { name: '全书创作规则' }))
    expect((await screen.findByLabelText('作品规则正文') as HTMLTextAreaElement).value).toBe('作者自定义规则')
    expect((screen.getByLabelText('作品规则正文') as HTMLTextAreaElement).readOnly).toBe(true)
    expect(bridge.creativeRule.update).not.toHaveBeenCalled()
  })

  it('invalidates a shown preview after parameters change and never starts the old package', async () => {
    const start = vi.fn()
    render(<ContextPreviewDialog sessionId={sessionId} chapters={[chapter]} onClose={vi.fn()} onStartCreation={start} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '生成装配预览' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成装配预览' }))
    await screen.findByText('历史回复')
    expect(screen.queryByText('错误的旧汇总')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('输入对 AI 的具体写作要求...'), { target: { value: '新的本次要求' } })
    await waitFor(() => expect((screen.getByRole('button', { name: '开始生成候选' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '开始生成候选' }))
    expect(start).not.toHaveBeenCalled()
  })

  it('discards a late preview response assembled from earlier inputs', async () => {
    let finish!: (value: any) => void
    bridge.context.preview.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<ContextPreviewDialog sessionId={sessionId} chapters={[chapter]} onClose={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '生成装配预览' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成装配预览' }))
    fireEvent.change(screen.getByPlaceholderText('输入对 AI 的具体写作要求...'), { target: { value: '改变后的要求' } })
    await act(async () => finish(context()))
    expect(screen.queryByText('历史回复')).toBeNull()
  })

  it('inspects immutable historical messages without reassembly or a start button', async () => {
    render(<ContextPreviewDialog sessionId={sessionId} chapters={[chapter]} contextPackageId={packageId} onClose={vi.fn()} onStartCreation={vi.fn()} />)
    await screen.findByText('历史回复')
    expect(bridge.context.get).toHaveBeenCalledWith({ sessionId, contextPackageId: packageId })
    expect(bridge.context.preview).not.toHaveBeenCalled()
    expect(bridge.connection.list).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '开始生成候选' })).toBeNull()
    expect(screen.getByText(/输出上限 2,000/)).toBeTruthy()
  })
})

describe('workflow renderer integration', () => {
  it('passes workflow, outline, chapter and chat identity through the host and starts the candidate API', async () => {
    const payload = { taskType: 'continue', workflowType: 'creation_workflow', stage: 'content', outlineId: 'outline-1', outlineVersion: 3, chatSessionId: chatId, target: { chapterId, chatId, startOffset: 4, endOffset: 4 } }
    useProjectStore.setState({ project: { sessionId, mode: 'read_write' } as any, chapters: [chapter], selectedChapterId: chapterId })
    useWorkbenchStore.getState().openDialog('context', payload)
    render(<DialogHost />)
    await waitFor(() => expect((screen.getByRole('button', { name: '生成装配预览' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '生成装配预览' }))
    await screen.findByText('历史回复')
    expect(bridge.context.preview).toHaveBeenCalledWith(expect.objectContaining(payload))
    fireEvent.click(screen.getByRole('button', { name: '开始生成候选' }))
    await waitFor(() => expect(bridge.creation.start).toHaveBeenCalledWith({ sessionId, contextPackageId: packageId }))
    await waitFor(() => expect(useWorkbenchStore.getState().dialogPayload).toEqual({ candidateId: 'candidate-1' }))
    expect(useTaskStore.getState().activeTaskId).toBe('task-1')
    await screen.findByText('纯正文')
    fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('纯正文')
    expect(screen.queryByText(/污染/)).toBeNull()
  })

  it('saves a completed chapter-outline reply as a draft without confirming it', async () => {
    render(<ChatWorkbenchDialog sessionId={sessionId} chapters={[chapter]} isReadOnly={false} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '保存为章大纲草稿' }))
    await waitFor(() => expect(bridge.outline.saveChapterOutline).toHaveBeenCalledWith(expect.objectContaining({ sessionId, chapterId, content: outlineText, state: 'draft' })))
    expect(bridge.outline.confirmChapterOutline).not.toHaveBeenCalled()
    expect(bridge.chat.updateStage).not.toHaveBeenCalled()
  })

  it('refuses to save an outline reply originating from a different chapter', async () => {
    bridge.context.get.mockResolvedValue(context({ stage: 'chapter_outline', workflowType: 'creation_workflow', target: { chapterId: 'different-chapter' } }))
    render(<ChatWorkbenchDialog sessionId={sessionId} chapters={[chapter]} isReadOnly={false} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '保存为章大纲草稿' }))
    await screen.findByText(/这条回复不是当前目标章节的章大纲/)
    expect(bridge.outline.saveChapterOutline).not.toHaveBeenCalled()
  })

  it('preserves the draft version gate and stays in outline planning when saving conflicts', async () => {
    bridge.outline.getLatestChapterOutline.mockResolvedValue({ id: 'outline-existing', chapterId, content: '作者草稿', state: 'draft', version: 7 } as any)
    bridge.outline.saveChapterOutline.mockRejectedValue(new Error('版本冲突，请刷新后重试'))
    render(<ChatWorkbenchDialog sessionId={sessionId} chapters={[chapter]} isReadOnly={false} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '保存为章大纲草稿' }))
    await screen.findByText(/版本冲突，请刷新后重试/)
    expect(bridge.outline.saveChapterOutline).toHaveBeenCalledWith(expect.objectContaining({ outlineId: 'outline-existing', expectedVersion: 7, state: 'draft' }))
    expect(bridge.outline.confirmChapterOutline).not.toHaveBeenCalled()
    expect(bridge.chat.updateStage).not.toHaveBeenCalled()
  })
})
