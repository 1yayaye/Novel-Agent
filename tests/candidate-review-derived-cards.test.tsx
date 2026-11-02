/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidateReviewDialog } from '../src/renderer/components/dialogs/CandidateReviewDialog'
import type { CandidateDetail, CandidateSummary } from '../src/shared/project'

describe('CandidateReviewDialog derived cards (Meowssiah adaptation)', () => {
  const sessionId = 'test-session-id'
  const mockChapter = {
    id: 'chap-1',
    title: '第一章 灵气初现',
    position: 0,
    version: 1,
    characterCount: 100,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  const mockCandidateSummary: CandidateSummary = {
    id: 'cand-meow-1',
    taskId: 'task-1',
    chapterId: 'chap-1',
    chapterVersion: 1,
    version: 1,
    state: 'ready',
    taskType: 'continue',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    previewExcerpt: '风雪之中，韩立小心翼翼地前行...'
  }

  const mockCandidateDetailWithCards: CandidateDetail = {
    id: 'cand-meow-1',
    taskId: 'task-1',
    chapterId: 'chap-1',
    chapterVersion: 1,
    originalContent: '韩立站在山门前。',
    rawOutput: '<game>风雪之中，韩立小心翼翼地前行...</game>',
    version: 1,
    state: 'ready',
    taskType: 'continue',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hunks: [
      {
        id: 'hunk-1',
        candidateId: 'cand-meow-1',
        position: 0,
        hunkType: 'replace',
        originalContent: '韩立站在山门前。',
        candidateContent: '风雪之中，韩立小心翼翼地前行...',
        selected: true
      }
    ],
    finalSynthesizedText: '风雪之中，韩立小心翼翼地前行...',
    comment: '喵呜~ 这一段长春功的暖意和外面的大雪形成鲜明对比喵！',
    summary: '韩立冒雪穿行神手谷，凭借初具火候的长春功御寒。',
    plotOptions: [
      '敲响墨大夫的房门，主动报告练功进展',
      '绕过主屋，潜入后山药园查看草药生长',
      '回到自己草屋，加紧打坐修炼长春功'
    ]
  }

  beforeEach(() => {
    ;(window as any).novelAgent = {
      candidate: {
        list: vi.fn().mockResolvedValue([mockCandidateSummary]),
        get: vi.fn().mockResolvedValue(mockCandidateDetailWithCards),
        onDelta: vi.fn().mockReturnValue(() => {}),
        onDone: vi.fn().mockReturnValue(() => {})
      }
    }
  })

  afterEach(() => {
    cleanup()
    delete (window as any).novelAgent
  })

  it('renders commentary, summary, and plot options cards when derived fields exist', async () => {
    render(
      <CandidateReviewDialog
        sessionId={sessionId}
        chapters={[mockChapter]}
        initialCandidateId="cand-meow-1"
        isReadOnly={false}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('创作留言 / 批注')).toBeTruthy()
      expect(screen.getByText('剧情小结')).toBeTruthy()
      expect(screen.getByText('后续走向选项')).toBeTruthy()
    })

    // Verify card content text
    expect(screen.getByText(/喵呜~ 这一段长春功的暖意/)).toBeTruthy()
    expect(screen.getByText(/韩立冒雪穿行神手谷/)).toBeTruthy()
    expect(screen.getByText('敲响墨大夫的房门，主动报告练功进展')).toBeTruthy()
    expect(screen.getByText('绕过主屋，潜入后山药园查看草药生长')).toBeTruthy()
    expect(screen.getByText('回到自己草屋，加紧打坐修炼长春功')).toBeTruthy()
  })

  it('does not render derived cards container when candidate detail lacks comment, summary and plot options', async () => {
    const plainDetail: CandidateDetail = {
      ...mockCandidateDetailWithCards,
      comment: undefined,
      summary: undefined,
      plotOptions: undefined
    }
    vi.mocked((window as any).novelAgent.candidate.get).mockResolvedValue(plainDetail)

    const { container } = render(
      <CandidateReviewDialog
        sessionId={sessionId}
        chapters={[mockChapter]}
        initialCandidateId="cand-meow-1"
        isReadOnly={false}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('AI 候选 (AI CANDIDATE)')).toBeTruthy()
    })

    expect(container.querySelector('.candidate-derived-cards')).toBeNull()
  })
})
