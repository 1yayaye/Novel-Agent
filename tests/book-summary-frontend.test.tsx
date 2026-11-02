/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartAnalysisDialog } from '../src/renderer/components/dialogs/StartAnalysisDialog'
import { BookSummaryDialog } from '../src/renderer/components/dialogs/BookSummaryDialog'
import type { TaskDetail, BookOutline, ChapterHeader } from '../src/shared/project'

const mockChapters: ChapterHeader[] = [
  { id: 'c1', title: '第一章 青牛镇', position: 0, version: 1, characterCount: 2000, createdAt: 1, updatedAt: 1 },
  { id: 'c2', title: '第二章 七玄门', position: 1, version: 1, characterCount: 2500, createdAt: 1, updatedAt: 1 }
]

const mockTaskDetail: TaskDetail = {
  id: 'task-bs-1',
  type: 'book_summary',
  state: 'completed',
  cancelRequested: false,
  createdAt: 1700000000000,
  updatedAt: 1700000060000,
  completedAt: 1700000060000,
  scopeJson: JSON.stringify({ all: true, segmentSize: 50000, stageSize: 300000 }),
  steps: [
    { id: 'step-1', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 0, createdAt: 1, updatedAt: 1 },
    { id: 'step-2', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 1, createdAt: 1, updatedAt: 1 },
    { id: 'step-3', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 2, createdAt: 1, updatedAt: 1 },
    { id: 'step-4', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 3, createdAt: 1, updatedAt: 1 },
    { id: 'step-5', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 4, createdAt: 1, updatedAt: 1 },
    { id: 'step-6', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 5, createdAt: 1, updatedAt: 1 },
    { id: 'step-7', taskId: 'task-bs-1', state: 'completed', attemptCount: 1, position: 6, createdAt: 1, updatedAt: 1 }
  ],
  bookSummary: {
    protocolVersion: 1,
    resultState: 'current',
    sources: [
      { chapterId: 'c1', title: '第一章 青牛镇', version: 1, position: 0, charCount: 2000, hash: 'hash1' },
      { chapterId: 'c2', title: '第二章 七玄门', version: 1, position: 1, charCount: 2500, hash: 'hash2' }
    ],
    totalChars: 4500,
    segmentSize: 50000,
    stageSize: 300000,
    stepPlan: [
      { stepId: 'step-1', kind: 'small', title: '小总结 1：青牛镇 / 七玄门', segmentIndex: 1, stageIndex: 1 },
      { stepId: 'step-2', kind: 'mainline', title: '主线更新 1', segmentIndex: 1, stageIndex: 1 },
      { stepId: 'step-3', kind: 'stage', title: '阶段 1 大总结', stageIndex: 1 },
      { stepId: 'step-4', kind: 'relations', title: '阶段 1 人物关系图', stageIndex: 1 },
      { stepId: 'step-5', kind: 'systemAssess', title: '首阶段体系判断', stageIndex: 1 },
      { stepId: 'step-6', kind: 'super', title: '全书超级总结' },
      { stepId: 'step-7', kind: 'outline', title: '全书大纲候选' }
    ],
    artifacts: [
      {
        stepId: 'step-1',
        position: 0,
        kind: 'small',
        title: '小总结 1：青牛镇 / 七玄门',
        segmentIndex: 1,
        stageIndex: 1,
        ranges: [{ chapterId: 'c1', startOffset: 0, endOffset: 2000 }],
        content: '第一章至第二章剧情梗概：主角韩立离开家乡加入七玄门。',
        notApplicable: false
      },
      {
        stepId: 'step-4',
        position: 3,
        kind: 'relations',
        title: '阶段 1 人物关系图',
        stageIndex: 1,
        ranges: [{ chapterId: 'c1', startOffset: 0, endOffset: 2000 }],
        content: '人物关系详述：韩立与厉飞雨为生死之交。',
        notApplicable: false,
        graph: {
          nodes: [
            { id: 'n1', name: '韩立', role: '主角', weight: 5 },
            { id: 'n2', name: '厉飞雨', role: '好友', weight: 4 }
          ],
          edges: [
            { source: 'n1', target: 'n2', label: '生死之交', type: 'ally', strength: 5 }
          ]
        }
      },
      {
        stepId: 'step-5',
        position: 4,
        kind: 'systemAssess',
        title: '首阶段体系判断',
        stageIndex: 1,
        ranges: [{ chapterId: 'c1', startOffset: 0, endOffset: 2000 }],
        content: '体系判断详情：正文中明确提到了炼气期与筑基期划分。',
        notApplicable: false,
        assessment: {
          applicable: true,
          label: '修仙等级体系',
          reason: '正文中明确提到了炼气期与筑基期划分。',
          fields: ['境界', '灵根', '寿元']
        }
      },
      {
        stepId: 'step-7',
        position: 6,
        kind: 'outline',
        title: '全书大纲候选',
        ranges: [{ chapterId: 'c1', startOffset: 0, endOffset: 2000 }],
        content: '# 全书宏观大纲候选\n\n## 第一幕：初入仙途\n韩立得到小绿瓶...',
        notApplicable: false
      }
    ],
    outlineCandidate: '# 全书宏观大纲候选\n\n## 第一幕：初入仙途\n韩立得到小绿瓶...'
  }
}

describe('Book Summary Frontend Integration', () => {
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

    vi.stubGlobal('novelAgent', {
      connection: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: '测试模型', model: 'test-model', baseUrl: 'http://localhost/v1', confirmedContentTargetFingerprint: 'fg-1' }
        ])
      },
      preset: {
        list: vi.fn().mockResolvedValue([])
      },
      analysis: {
        start: vi.fn().mockResolvedValue({ taskId: 'task-bs-new' }),
        pause: vi.fn().mockResolvedValue({ success: true }),
        resume: vi.fn().mockResolvedValue({ taskId: 'task-bs-1' }),
        cancel: vi.fn().mockResolvedValue({ success: true }),
        exportSummary: vi.fn().mockResolvedValue({ savedPath: 'C:\\exports\\summary.md' }),
        applyOutline: vi.fn().mockResolvedValue({
          id: 'out-1',
          content: '# 全书宏观大纲候选\n\n## 第一幕：初入仙途\n韩立得到小绿瓶...',
          version: 2,
          state: 'draft',
          sourceVersions: { c1: 1, c2: 1 },
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      },
      task: {
        get: vi.fn().mockResolvedValue(mockTaskDetail),
        list: vi.fn().mockResolvedValue([mockTaskDetail]),
        retry: vi.fn().mockResolvedValue({ id: 'task-bs-1', state: 'queued' }),
        retryStep: vi.fn().mockResolvedValue({ id: 'task-bs-1', state: 'running' }),
        onProgress: vi.fn().mockReturnValue(() => {})
      },
      outline: {
        getBookOutline: vi.fn().mockResolvedValue({
          id: 'out-1',
          content: '# 原有旧大纲\n韩立入七玄门。',
          version: 1,
          state: 'confirmed',
          sourceVersions: {},
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe('StartAnalysisDialog for book_summary', () => {
    it('sets stageSize default to 300000 and removes chapter checkboxes for book_summary', async () => {
      const handleStarted = vi.fn()
      render(
        <StartAnalysisDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          chapters={mockChapters}
          canUsePipelines={true}
          initialType="book_summary"
          isReadOnly={false}
          onClose={vi.fn()}
          onStarted={handleStarted}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('全书总结')).toBeTruthy()
      })

      // Checks that full-book scope info card is rendered and chapter checkboxes are absent
      expect(screen.getByText(/分析章节范围：全书所有未删除章节/)).toBeTruthy()
      expect(screen.queryByText('自定义勾选章节')).toBeNull()

      // Click start
      const startButton = screen.getByRole('button', { name: /开始执行任务/ })
      fireEvent.click(startButton)

      await waitFor(() => {
        expect(window.novelAgent.analysis.start).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'book_summary',
            scope: {
              all: true,
              segmentSize: 50000,
              stageSize: 300000
            }
          })
        )
        expect(handleStarted).toHaveBeenCalledWith('task-bs-new', 'book_summary')
      })
    })
  })

  describe('BookSummaryDialog rendering and features', () => {
    it('renders step plan and completed artifacts', async () => {
      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('全书剧情提取与大纲成果')).toBeTruthy()
        expect(screen.getByText('已完成')).toBeTruthy()
      })

      // Check step list
      expect(screen.getByText('小总结 1：青牛镇 / 七玄门')).toBeTruthy()
      expect(screen.getByText('阶段 1 人物关系图')).toBeTruthy()
      expect(screen.getByText('首阶段体系判断')).toBeTruthy()
      expect(screen.getAllByText('全书大纲候选').length).toBeGreaterThan(0)

      // Strictly verifies NO skipStep button exists in the dialog
      expect(screen.queryByText(/跳过步骤/)).toBeNull()
      expect(screen.queryByRole('button', { name: /跳过/ })).toBeNull()
    })

    it('renders relation graph details when selecting relations step', async () => {
      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('阶段 1 人物关系图')).toBeTruthy()
      })

      // Click on relations step
      fireEvent.click(screen.getByText('阶段 1 人物关系图'))

      await waitFor(() => {
        expect(screen.getByText(/人物关系图谱/)).toBeTruthy()
        expect(screen.getAllByText('韩立').length).toBeGreaterThan(0)
        expect(screen.getAllByText('厉飞雨').length).toBeGreaterThan(0)
        expect(screen.getAllByText('生死之交').length).toBeGreaterThan(0)
      })
    })

    it('renders system assessment details when selecting systemAssess step', async () => {
      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('首阶段体系判断')).toBeTruthy()
      })

      fireEvent.click(screen.getByText('首阶段体系判断'))

      await waitFor(() => {
        expect(screen.getByText('作品体系适用性判断')).toBeTruthy()
        expect(screen.getByText('修仙等级体系')).toBeTruthy()
        expect(screen.getByText('适用体系')).toBeTruthy()
        expect(screen.getAllByText(/炼气期与筑基期/).length).toBeGreaterThan(0)
        expect(screen.getByText('境界')).toBeTruthy()
        expect(screen.getByText('灵根')).toBeTruthy()
      })
    })

    it('exports summary via analysis.exportSummary', async () => {
      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /导出全部资料/ })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: /导出全部资料/ }))

      await waitFor(() => {
        expect(window.novelAgent.analysis.exportSummary).toHaveBeenCalledWith({
          sessionId: '00000000-0000-0000-0000-000000000001',
          taskId: 'task-bs-1'
        })
      })
    })

    it('opens outline comparison and applies draft with expectedVersion', async () => {
      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /比较并应用大纲/ })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: /比较并应用大纲/ }))

      await waitFor(() => {
        expect(screen.getByText('全书大纲双栏对比与应用')).toBeTruthy()
        expect(screen.getByText(/原有旧大纲/)).toBeTruthy()
        expect(screen.getAllByText(/全书宏观大纲候选/).length).toBeGreaterThan(0)
      })

      // Click apply outline
      const applyBtn = screen.getByRole('button', { name: /应用为全书大纲草稿/ })
      fireEvent.click(applyBtn)

      await waitFor(() => {
        expect(window.novelAgent.analysis.applyOutline).toHaveBeenCalledWith({
          sessionId: '00000000-0000-0000-0000-000000000001',
          taskId: 'task-bs-1',
          expectedVersion: 1
        })
      })
    })

    it('displays stale warning badge when resultState is stale', async () => {
      const staleTaskDetail: TaskDetail = {
        ...mockTaskDetail,
        bookSummary: {
          ...mockTaskDetail.bookSummary!,
          resultState: 'stale'
        }
      }
      vi.mocked(window.novelAgent.task.get).mockResolvedValueOnce(staleTaskDetail)

      render(
        <BookSummaryDialog
          sessionId="00000000-0000-0000-0000-000000000001"
          taskId="task-bs-1"
          isReadOnly={false}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/正文已变动 \(产物过时\)/)).toBeTruthy()
        expect(screen.getByText(/当前任务产物标记为「已过时」/)).toBeTruthy()
      })

      // Outline apply button should be disabled for stale task
      const applyOutlineBtn = screen.getByRole('button', { name: /比较并应用大纲/ })
      expect(applyOutlineBtn.hasAttribute('disabled')).toBe(true)
    })
  })
})
