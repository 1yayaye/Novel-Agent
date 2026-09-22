import { describe, expect, it } from 'vitest'
import { computeDiffHunks, synthesizeText } from '../src/main/candidate-service'
import type { CandidateHunk } from '../src/shared/project'

describe('Candidate Two-tier Diff & Text Synthesis (SPEC 8.2, 8.3)', () => {
  it('returns single equal hunk when original and candidate are identical', () => {
    const text = '韩立收拾行囊离开五里沟。\n山道崎岖，白云缭绕。'
    const hunks = computeDiffHunks(text, text)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({
      position: 0,
      hunkType: 'equal',
      originalContent: text,
      candidateContent: text,
      selected: true
    })
    expect(synthesizeText(hunks)).toBe(text)
  })

  it('handles complete insert when original is empty', () => {
    const candidate = '月华之下，小瓶泛出神异光芒。'
    const hunks = computeDiffHunks('', candidate)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].hunkType).toBe('insert')
    expect(hunks[0].originalContent).toBe('')
    expect(hunks[0].candidateContent).toBe(candidate)
    expect(hunks[0].selected).toBe(true)

    expect(synthesizeText(hunks)).toBe(candidate)
    // If unselected, returns original (empty)
    const unselected = [{ ...hunks[0], selected: false }]
    expect(synthesizeText(unselected)).toBe('')
  })

  it('handles complete delete when candidate is empty', () => {
    const original = '韩立收拾行囊离开五里沟。'
    const hunks = computeDiffHunks(original, '')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].hunkType).toBe('delete')
    expect(hunks[0].originalContent).toBe(original)
    expect(hunks[0].candidateContent).toBe('')
    expect(hunks[0].selected).toBe(true)

    expect(synthesizeText(hunks)).toBe('')
    // If unselected, preserves original
    const unselected = [{ ...hunks[0], selected: false }]
    expect(synthesizeText(unselected)).toBe(original)
  })

  it('computes character-level diff inside modified paragraphs with CJK characters', () => {
    const original = '韩立收拾行囊离开五里沟。'
    const candidate = '韩立收拾行装离开青牛镇。'
    const hunks = computeDiffHunks(original, candidate)

    // Should break into equal and replace/insert/delete chunks
    expect(hunks.length).toBeGreaterThan(1)
    expect(synthesizeText(hunks)).toBe(candidate)

    // Verify all original content pieces sum up to original text
    const reconstructedOriginal = hunks.map((h) => h.originalContent).join('')
    expect(reconstructedOriginal).toBe(original)

    // Verify all candidate content pieces sum up to candidate text
    const reconstructedCandidate = hunks.map((h) => h.candidateContent).join('')
    expect(reconstructedCandidate).toBe(candidate)

    // Adversarial Check 1: Two-pointer trimming performance on typical prose revision (>3,000 chars with localized edit)
    const longPrefix = '道可道非常道，玄之又玄众妙之门。'.repeat(200) // ~3,200 chars
    const longSuffix = '天地不仁以万物为刍狗，圣人不仁以百姓为刍狗。'.repeat(100) // ~2,300 chars
    const originalLong = `${longPrefix}【原文段落：韩立初入太南小会】${longSuffix}`
    const candidateLong = `${longPrefix}【修订段落：韩立谨慎参与太南小会】${longSuffix}`
    const t0 = performance.now()
    const trimmedHunks = computeDiffHunks(originalLong, candidateLong)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(15) // typical prose revisions sub-millisecond to under 15ms
    expect(synthesizeText(trimmedHunks)).toBe(candidateLong)

    // Adversarial Check 2: Large difference exceeding 3,000 characters (triggers background Worker thread fallback, ADR 0002)
    const largeOriginalBlock = Array.from({ length: 3200 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('')
    const largeCandidateBlock = Array.from({ length: 3200 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
    const workerHunks = computeDiffHunks(largeOriginalBlock, largeCandidateBlock)
    expect(workerHunks.length).toBeGreaterThan(0)
    expect(synthesizeText(workerHunks)).toBe(largeCandidateBlock)

    // Adversarial Check 3: 50,000 characters memory bounded diff completes without OOM and synthesizes accurately
    const repeats = 500
    const text50kOrig = '青云门通天峰大殿之上，仙气缭绕。'.repeat(repeats)
    const text50kCand = '青云门通天峰大殿之上，紫气东来。'.repeat(repeats)
    const large50kHunks = computeDiffHunks(text50kOrig, text50kCand)
    expect(large50kHunks.length).toBeGreaterThan(0)
    expect(synthesizeText(large50kHunks)).toBe(text50kCand)
  })

  it('keeps localized 5,000-character paragraph diffs on the main thread', () => {
    const prefix = '青云门通天峰大殿之上，仙气缭绕。'.repeat(230)
    const suffix = '山风穿过竹林，远处传来钟声。'.repeat(100)
    const original = `${prefix}【原文：韩立在石阶前停步】${suffix}`
    const candidate = `${prefix}【修订：韩立在石阶前回首】${suffix}`
    const startedAt = performance.now()
    const hunks = computeDiffHunks(original, candidate)

    expect(performance.now() - startedAt).toBeLessThan(20)
    expect(synthesizeText(hunks)).toBe(candidate)
  })

  it('preserves multi-line paragraphs in two-tier diff', () => {
    const original = '第一段：韩立拜入七玄门。\n第二段：神手谷采药。\n第三段：发现神秘绿瓶。'
    const candidate = '第一段：韩立拜入七玄门。\n第二段：神手谷精心采药。\n第三段：发现神秘绿瓶。'
    const hunks = computeDiffHunks(original, candidate)

    // First and third paragraphs should be equal
    const equalHunks = hunks.filter((h) => h.hunkType === 'equal')
    expect(equalHunks.length).toBeGreaterThanOrEqual(2)
    expect(synthesizeText(hunks)).toBe(candidate)
  })

  it('synthesizes text deterministically based on per-hunk selection', () => {
    const hunks: CandidateHunk[] = [
      {
        id: 'hunk-0',
        candidateId: 'cand-1',
        position: 0,
        hunkType: 'equal',
        originalContent: '韩立走在',
        candidateContent: '韩立走在',
        selected: true
      },
      {
        id: 'hunk-1',
        candidateId: 'cand-1',
        position: 1,
        hunkType: 'replace',
        originalContent: '山路上',
        candidateContent: '小径上',
        selected: false // Keep original
      },
      {
        id: 'hunk-2',
        candidateId: 'cand-1',
        position: 2,
        hunkType: 'insert',
        originalContent: '',
        candidateContent: '，步伐匆匆',
        selected: true // Adopt candidate insert
      }
    ]

    expect(synthesizeText(hunks)).toBe('韩立走在山路上，步伐匆匆')
  })

  it('correctly handles astral plane surrogate pairs and whitespace trimming with 100% synthesis fidelity', () => {
    // Astral plane insertion with common prefix and suffix
    const orig1 = '𠮷野家大促销'
    const cand1 = '𠮷野家超大促销'
    const hunks1 = computeDiffHunks(orig1, cand1)
    expect(hunks1.length).toBeGreaterThan(1)
    expect(synthesizeText(hunks1)).toBe(cand1)
    expect(hunks1.map((h) => h.originalContent).join('')).toBe(orig1)

    // Astral plane replacement
    const orig2 = '𠮷野家'
    const cand2 = '😊野家'
    const hunks2 = computeDiffHunks(orig2, cand2)
    expect(hunks2.length).toBe(2)
    expect(hunks2[0].hunkType).toBe('replace')
    expect(hunks2[0].originalContent).toBe('𠮷')
    expect(hunks2[0].candidateContent).toBe('😊')
    expect(hunks2[1].hunkType).toBe('equal')
    expect(hunks2[1].originalContent).toBe('野家')
    expect(synthesizeText(hunks2)).toBe(cand2)

    // Whitespace only edits
    const orig3 = 'abc  def'
    const cand3 = 'abc def'
    const hunks3 = computeDiffHunks(orig3, cand3)
    expect(synthesizeText(hunks3)).toBe(cand3)
    expect(hunks3.map((h) => h.originalContent).join('')).toBe(orig3)
  })
})
