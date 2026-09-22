import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowGuideBanner } from '../src/renderer/components/workbench/WorkflowGuideBanner'

describe('Workflow Guide Banner (Novel Onboarding & Pre-analysis Guidance)', () => {
  it('renders onboarding guide banner when project has chapters but lacks summaries and reports', () => {
    const handleStartKnowledge = vi.fn()
    const handleStartReport = vi.fn()

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGuideBanner, {
        totalChapters: 10,
        summaryCount: 0,
        reportCount: 0,
        isReadOnly: false,
        onStartKnowledgeAnalysis: handleStartKnowledge,
        onStartReportAnalysis: handleStartReport
      })
    )

    expect(html).toContain('workflow-guide-banner')
    expect(html).toContain('新小说导入就绪 · 建议先完成核心分析')
    expect(html).toContain('未初始化')
    expect(html).toContain('当前共有')
    expect(html).toContain('10')
    expect(html).toContain('一键提取剧情与大纲')
    expect(html).toContain('分析文风报告')
  })

  it('renders only report button if summaries exist but reports do not', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGuideBanner, {
        totalChapters: 5,
        summaryCount: 5,
        reportCount: 0,
        isReadOnly: false,
        onStartKnowledgeAnalysis: vi.fn(),
        onStartReportAnalysis: vi.fn()
      })
    )

    expect(html).toContain('workflow-guide-banner')
    expect(html).toContain('分析文风报告')
    expect(html).not.toContain('一键提取剧情与大纲')
  })

  it('renders nothing when project has zero chapters', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGuideBanner, {
        totalChapters: 0,
        summaryCount: 0,
        reportCount: 0,
        isReadOnly: false,
        onStartKnowledgeAnalysis: vi.fn(),
        onStartReportAnalysis: vi.fn()
      })
    )

    expect(html).toBe('')
  })

  it('renders nothing when both summaries and reports are completed', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGuideBanner, {
        totalChapters: 8,
        summaryCount: 8,
        reportCount: 1,
        isReadOnly: false,
        onStartKnowledgeAnalysis: vi.fn(),
        onStartReportAnalysis: vi.fn()
      })
    )

    expect(html).toBe('')
  })

  it('disables action buttons when isReadOnly is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGuideBanner, {
        totalChapters: 12,
        summaryCount: 0,
        reportCount: 0,
        isReadOnly: true,
        onStartKnowledgeAnalysis: vi.fn(),
        onStartReportAnalysis: vi.fn()
      })
    )

    expect(html).toContain('disabled=""')
  })
})
