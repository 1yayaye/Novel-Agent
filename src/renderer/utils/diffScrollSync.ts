import type { CandidateHunk } from '../../shared/project'

export function computeProportionalScroll(params: {
  sourceScrollTop: number
  sourceScrollHeight: number
  sourceClientHeight: number
  targetScrollHeight: number
  targetClientHeight: number
}): number {
  const sourceMax = params.sourceScrollHeight - params.sourceClientHeight
  if (sourceMax <= 0) return 0
  const ratio = params.sourceScrollTop / sourceMax

  const targetMax = params.targetScrollHeight - params.targetClientHeight
  if (targetMax <= 0) return 0
  return Math.round(ratio * targetMax)
}

export function renderDeleteHunkPreview(hunk: CandidateHunk) {
  if (hunk.hunkType !== 'delete') return null
  return {
    isBadge: hunk.selected,
    className: `hunk-interactive-item diff-remove ${hunk.selected ? 'diff-deleted-placeholder' : ''}`.trim(),
    text: hunk.selected ? '[已删除段落 - 点击恢复]' : hunk.originalContent
  }
}
