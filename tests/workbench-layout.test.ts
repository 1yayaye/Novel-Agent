import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Workbench layout', () => {
  it('keeps window layout styles and visible copy aligned', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')
    const css = read('src/renderer/styles/index.css')
    const actionDock = read('src/renderer/features/workbench/ActionDock.tsx')
    const iconButton = read('src/renderer/components/common/IconButton.tsx')
    const knowledge = read('src/renderer/components/dialogs/KnowledgeBaseDialog.tsx')
    const candidate = read('src/renderer/components/dialogs/CandidateReviewDialog.tsx')
    const outline = read('src/renderer/components/dialogs/OutlineEditorDialog.tsx')

    expect(css).toContain('grid-template-columns: 260px minmax(0, 1fr)')
    for (const selector of [
      '.dialog-header',
      '.dialog-footer',
      '.icon-button',
      '.text-button',
      '.primary-button',
      '.workflow-guide-banner',
      '.outline-empty-flow',
      '.knowledge-body',
      '.candidate-review-body',
      '.chat-layout',
      '.chat-input-box',
      '.chat-input-textarea'
    ]) {
      expect(css).toContain(selector)
    }

    expect(actionDock).toContain('w-max whitespace-nowrap')
    expect(iconButton).toContain('event.preventDefault()')

    for (const copy of ['人物 (Characters)', '世界观 (World)', '时间线 (Timeline)', '伏笔 (Foreshadow)', 'search_revision']) {
      expect(knowledge).not.toContain(copy)
    }
    expect(knowledge).toContain('closeButton={false}')
    expect(knowledge).toContain('人物关系图谱')

    for (const copy of ['Candidate Diff Review', 'Apply & Snapshot', 'ai_apply', 'Candidate Expired', '(Failed)', '(Cancelled)']) {
      expect(candidate).not.toContain(copy)
    }
    expect(candidate).toContain('差异审阅')
    expect(candidate).toContain('写回正文')
    expect(candidate).toContain('closeButton={false}')
    expect(outline).toContain('closeButton={false}')
  })
})

