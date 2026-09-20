import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CandidateHunk } from '../src/shared/project'
import { computeProportionalScroll, renderDeleteHunkPreview } from '../src/renderer/utils/diffScrollSync'

describe('Ticket 05: Candidate Diff Review - Reversible Delete Badge & Proportional Scroll Sync', () => {
  it('renders visible placeholder badge when a delete hunk is selected (deleted)', () => {
    const deleteHunk: CandidateHunk = {
      id: 'hunk-1',
      candidateId: 'cand-1',
      position: 2,
      hunkType: 'delete',
      originalContent: '这段原文应该被删除',
      candidateContent: '',
      selected: true
    }

    // When selected is true (adopted delete), renders the reversible badge with non-empty text
    const selectedResult = renderDeleteHunkPreview(deleteHunk)
    expect(selectedResult).not.toBeNull()
    expect(selectedResult?.isBadge).toBe(true)
    expect(selectedResult?.text).toBe('[已删除段落 - 点击恢复]')
    expect(selectedResult?.className).toContain('diff-deleted-placeholder')

    // When selected is false (retained original), renders the original content
    const unselectedResult = renderDeleteHunkPreview({ ...deleteHunk, selected: false })
    expect(unselectedResult?.isBadge).toBe(false)
    expect(unselectedResult?.text).toBe('这段原文应该被删除')
    expect(unselectedResult?.className).not.toContain('diff-deleted-placeholder')
  })

  it('calculates dual-column proportional scroll synchronization with zero jitter', () => {

    // Source at 0% (top) -> Target at 0%
    expect(
      computeProportionalScroll({
        sourceScrollTop: 0,
        sourceScrollHeight: 2000,
        sourceClientHeight: 500,
        targetScrollHeight: 3500,
        targetClientHeight: 500
      })
    ).toBe(0)

    // Source at 50% (750px of 1500px max) -> Target at 50% (1500px of 3000px max)
    expect(
      computeProportionalScroll({
        sourceScrollTop: 750,
        sourceScrollHeight: 2000,
        sourceClientHeight: 500,
        targetScrollHeight: 3500,
        targetClientHeight: 500
      })
    ).toBe(1500)

    // Source at 100% (bottom: 1500px) -> Target at 100% (3000px)
    expect(
      computeProportionalScroll({
        sourceScrollTop: 1500,
        sourceScrollHeight: 2000,
        sourceClientHeight: 500,
        targetScrollHeight: 3500,
        targetClientHeight: 500
      })
    ).toBe(3000)
  })

  it('verifies stylesheet definitions for candidate diff review and deleted badges', () => {
    const cssPath = resolve(__dirname, '../src/renderer/styles.css')
    const css = readFileSync(cssPath, 'utf8')

    expect(css).toContain('.candidate-dialog')
    expect(css).toContain('.split-panels-container')
    expect(css).toContain('.diff-deleted-placeholder')
    expect(css).toContain('.diff-deleted-badge')
    expect(css).toContain('.hunk-interactive-item')

    const tsxPath = resolve(__dirname, '../src/renderer/components/dialogs/CandidateReviewDialog.tsx')
    const tsx = readFileSync(tsxPath, 'utf8')
    expect(tsx).toContain('[已删除段落 - 点击恢复]')
    expect(tsx).toContain('isSyncingScrollRef')
    expect(tsx).toContain('handleLeftScroll')
    expect(tsx).toContain('handleRightScroll')
    expect(tsx).toContain('renderDeleteHunkPreview')
  })
})
