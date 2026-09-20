import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from 'node:worker_threads'
import type Database from 'better-sqlite3'
import {
  type ApplyCandidateInput,
  type CandidateApplyResult,
  type CandidateDetail,
  type CandidateHunk,
  type CandidateHunkDraft,
  type CandidateHunkType,
  type CandidateState,
  type CandidateSummary,
  type Chapter,
  type ChapterSnapshot,
  type TaskType
} from '../shared/project'
import { ProjectError, type ProjectStore } from './project-store'
import type { SearchIndex } from './search-index'

interface CandidateRow {
  id: string
  task_id: string | null
  chapter_id: string
  chapter_version: number
  start_offset: number | null
  end_offset: number | null
  original_content: string
  raw_output: string
  edited_content: string | null
  version: number
  state: CandidateState
  created_at: number
  updated_at: number
  task_type?: TaskType | null
}

interface CandidateHunkRow {
  id: string
  candidate_id: string
  position: number
  hunk_type: CandidateHunkType
  original_content: string
  candidate_content: string
  selected: number
}

interface CandidateChapterRow {
  id: string
  title: string
  position: number
  content: string
  version: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/**
 * Computes Longest Common Subsequence of generic array items.
 */
function lcs<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y
): Array<{ aIndex: number; bIndex: number }> {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return []

  const totalCells = (m + 1) * (n + 1)
  if (totalCells > 16000000) {
    return []
  }

  const stride = n + 1
  const dp = new Int32Array(totalCells)

  for (let i = 1; i <= m; i++) {
    const row = i * stride
    const prevRow = (i - 1) * stride
    const ai = a[i - 1]
    for (let j = 1; j <= n; j++) {
      if (equals(ai, b[j - 1])) {
        dp[row + j] = dp[prevRow + (j - 1)] + 1
      } else {
        const up = dp[prevRow + j]
        const left = dp[row + (j - 1)]
        dp[row + j] = up >= left ? up : left
      }
    }
  }

  const matches: Array<{ aIndex: number; bIndex: number }> = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    const row = i * stride
    const prevRow = (i - 1) * stride
    if (equals(a[i - 1], b[j - 1])) {
      matches.unshift({ aIndex: i - 1, bIndex: j - 1 })
      i--
      j--
    } else if (dp[prevRow + j] >= dp[row + (j - 1)]) {
      i--
    } else {
      j--
    }
  }
  return matches
}

function getWorkerPath(): string | null {
  const candidates = [
    join(__dirname, 'worker.cjs'),
    join(__dirname, '../worker/index.cjs'),
    resolve(__dirname, '../../src/worker/index.cjs'),
    resolve(process.cwd(), 'out/main/worker.cjs'),
    resolve(process.cwd(), 'src/worker/index.cjs')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function runWorkerDiffSync(
  a: string[],
  b: string[]
): Array<{ aIndex: number; bIndex: number }> | null {
  const workerPath = getWorkerPath()
  if (!workerPath) return null

  let worker: Worker | undefined
  let port1: MessagePort | undefined
  try {
    worker = new Worker(workerPath)
    worker.on('error', () => {})
    const channel = new MessageChannel()
    port1 = channel.port1
    const port2 = channel.port2
    const sab = new SharedArrayBuffer(4)
    const int32 = new Int32Array(sab)

    worker.postMessage(
      {
        type: 'diff',
        orig: a.join(''),
        cand: b.join(''),
        port: port2,
        sab
      },
      [port2]
    )

    // Wait up to 5 seconds for worker completion
    Atomics.wait(int32, 0, 0, 5000)
    const response = receiveMessageOnPort(port1)

    if (response?.message?.type === 'diff-result' && Array.isArray(response.message.matches)) {
      return response.message.matches as Array<{ aIndex: number; bIndex: number }>
    }
    return null
  } catch {
    return null
  } finally {
    port1?.close()
    worker?.terminate().catch(() => undefined)
  }
}

function computeLcsWithWorkerFallback(
  a: string[],
  b: string[]
): Array<{ aIndex: number; bIndex: number }> {
  if (Math.max(a.length, b.length) > 3000) {
    const workerMatches = runWorkerDiffSync(a, b)
    if (workerMatches) return workerMatches
  }
  return lcs(a, b)
}

/**
 * Character-level diff on Unicode codepoints (Unicode-safe).
 * Implements two-pointer common prefix-suffix trimming to minimize matrix allocations (ADR 0002).
 */
function computeCharDiffHunks(orig: string, cand: string): CandidateHunkDraft[] {
  if (orig === cand) {
    return [{ position: 0, hunkType: 'equal', originalContent: orig, candidateContent: cand, selected: true }]
  }
  if (!orig) {
    return [{ position: 0, hunkType: 'insert', originalContent: '', candidateContent: cand, selected: true }]
  }
  if (!cand) {
    return [{ position: 0, hunkType: 'delete', originalContent: orig, candidateContent: '', selected: true }]
  }

  const origChars = Array.from(orig)
  const candChars = Array.from(cand)
  const m = origChars.length
  const n = candChars.length

  // Two-pointer common prefix
  let prefixLen = 0
  while (prefixLen < m && prefixLen < n && origChars[prefixLen] === candChars[prefixLen]) {
    prefixLen++
  }

  // Two-pointer common suffix
  let suffixLen = 0
  while (
    suffixLen < m - prefixLen &&
    suffixLen < n - prefixLen &&
    origChars[m - 1 - suffixLen] === candChars[n - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const midOrigChars = origChars.slice(prefixLen, m - suffixLen)
  const midCandChars = candChars.slice(prefixLen, n - suffixLen)

  const hunks: CandidateHunkDraft[] = []

  // Add prefix equal hunk if present
  if (prefixLen > 0) {
    const prefixText = origChars.slice(0, prefixLen).join('')
    hunks.push({ position: 0, hunkType: 'equal', originalContent: prefixText, candidateContent: prefixText, selected: true })
  }

  // Middle diff
  if (midOrigChars.length === 0 && midCandChars.length > 0) {
    const insertText = midCandChars.join('')
    hunks.push({ position: 0, hunkType: 'insert', originalContent: '', candidateContent: insertText, selected: true })
  } else if (midOrigChars.length > 0 && midCandChars.length === 0) {
    const deleteText = midOrigChars.join('')
    hunks.push({ position: 0, hunkType: 'delete', originalContent: deleteText, candidateContent: '', selected: true })
  } else if (midOrigChars.length > 0 && midCandChars.length > 0) {
    const midOrigStr = midOrigChars.join('')
    const midCandStr = midCandChars.join('')
    const totalCells = (midOrigChars.length + 1) * (midCandChars.length + 1)

    if (totalCells > 16000000) {
      const origSentences = midOrigStr.split(/(?<=[。！？\n])/)
      const candSentences = midCandStr.split(/(?<=[。！？\n])/)

      if (origSentences.length > 1 || candSentences.length > 1) {
        const sMatches = lcs(origSentences, candSentences)
        if (sMatches.length > 0) {
          let oIdx = 0
          let cIdx = 0
          for (const match of sMatches) {
            const dOrig = origSentences.slice(oIdx, match.aIndex).join('')
            const dCand = candSentences.slice(cIdx, match.bIndex).join('')
            if (dOrig || dCand) {
              hunks.push(...computeCharDiffHunks(dOrig, dCand))
            }
            const matchedS = origSentences[match.aIndex]
            if (hunks.length > 0 && hunks[hunks.length - 1].hunkType === 'equal') {
              hunks[hunks.length - 1].originalContent += matchedS
              hunks[hunks.length - 1].candidateContent += matchedS
            } else {
              hunks.push({ position: 0, hunkType: 'equal', originalContent: matchedS, candidateContent: matchedS, selected: true })
            }
            oIdx = match.aIndex + 1
            cIdx = match.bIndex + 1
          }
          const fOrig = origSentences.slice(oIdx).join('')
          const fCand = candSentences.slice(cIdx).join('')
          if (fOrig || fCand) {
            hunks.push(...computeCharDiffHunks(fOrig, fCand))
          }
        } else {
          hunks.push({ position: 0, hunkType: 'replace', originalContent: midOrigStr, candidateContent: midCandStr, selected: true })
        }
      } else {
        hunks.push({ position: 0, hunkType: 'replace', originalContent: midOrigStr, candidateContent: midCandStr, selected: true })
      }
    } else {
      const midMatches = computeLcsWithWorkerFallback(midOrigChars, midCandChars)

      let origIdx = 0
      let candIdx = 0

      for (const match of midMatches) {
        const origDiff = midOrigChars.slice(origIdx, match.aIndex).join('')
        const candDiff = midCandChars.slice(candIdx, match.bIndex).join('')

        if (origDiff || candDiff) {
          if (origDiff && candDiff) {
            hunks.push({ position: 0, hunkType: 'replace', originalContent: origDiff, candidateContent: candDiff, selected: true })
          } else if (origDiff) {
            hunks.push({ position: 0, hunkType: 'delete', originalContent: origDiff, candidateContent: '', selected: true })
          } else if (candDiff) {
            hunks.push({ position: 0, hunkType: 'insert', originalContent: '', candidateContent: candDiff, selected: true })
          }
        }

        const matchedChar = midOrigChars[match.aIndex]
        if (hunks.length > 0 && hunks[hunks.length - 1].hunkType === 'equal') {
          hunks[hunks.length - 1].originalContent += matchedChar
          hunks[hunks.length - 1].candidateContent += matchedChar
        } else {
          hunks.push({ position: 0, hunkType: 'equal', originalContent: matchedChar, candidateContent: matchedChar, selected: true })
        }

        origIdx = match.aIndex + 1
        candIdx = match.bIndex + 1
      }

      const finalOrigDiff = midOrigChars.slice(origIdx).join('')
      const finalCandDiff = midCandChars.slice(candIdx).join('')
      if (finalOrigDiff || finalCandDiff) {
        if (finalOrigDiff && finalCandDiff) {
          hunks.push({ position: 0, hunkType: 'replace', originalContent: finalOrigDiff, candidateContent: finalCandDiff, selected: true })
        } else if (finalOrigDiff) {
          hunks.push({ position: 0, hunkType: 'delete', originalContent: finalOrigDiff, candidateContent: '', selected: true })
        } else if (finalCandDiff) {
          hunks.push({ position: 0, hunkType: 'insert', originalContent: '', candidateContent: finalCandDiff, selected: true })
        }
      }
    }
  }

  // Add suffix equal hunk if present
  if (suffixLen > 0) {
    const suffixText = origChars.slice(m - suffixLen).join('')
    if (hunks.length > 0 && hunks[hunks.length - 1].hunkType === 'equal') {
      hunks[hunks.length - 1].originalContent += suffixText
      hunks[hunks.length - 1].candidateContent += suffixText
    } else {
      hunks.push({ position: 0, hunkType: 'equal', originalContent: suffixText, candidateContent: suffixText, selected: true })
    }
  }

  return hunks.map((h, idx) => ({ ...h, position: idx }))
}

/**
 * Two-tier Chinese diff algorithm:
 * Tier 1: Paragraph-level LCS.
 * Tier 2: Unicode character-level LCS within modified paragraph blocks.
 * SPEC 6.10
 */
export function computeDiffHunks(originalText: string, candidateText: string): CandidateHunkDraft[] {
  if (originalText === candidateText) {
    return [{ position: 0, hunkType: 'equal', originalContent: originalText, candidateContent: candidateText, selected: true }]
  }
  if (!originalText) {
    return [{ position: 0, hunkType: 'insert', originalContent: '', candidateContent: candidateText, selected: true }]
  }
  if (!candidateText) {
    return [{ position: 0, hunkType: 'delete', originalContent: originalText, candidateContent: '', selected: true }]
  }

  // Tier 1: Split into paragraphs preserving newline endings
  const origParagraphs = originalText.split(/(?<=\n)/)
  const candParagraphs = candidateText.split(/(?<=\n)/)

  const matches = lcs(origParagraphs, candParagraphs)
  const rawHunks: CandidateHunkDraft[] = []

  let origPIdx = 0
  let candPIdx = 0

  for (const match of matches) {
    const diffOrigP = origParagraphs.slice(origPIdx, match.aIndex)
    const diffCandP = candParagraphs.slice(candPIdx, match.bIndex)

    if (diffOrigP.length > 0 || diffCandP.length > 0) {
      const origBlock = diffOrigP.join('')
      const candBlock = diffCandP.join('')
      // Tier 2: Character-level diff within modified block
      const subHunks = computeCharDiffHunks(origBlock, candBlock)
      rawHunks.push(...subHunks)
    }

    const matchedP = origParagraphs[match.aIndex]
    if (rawHunks.length > 0 && rawHunks[rawHunks.length - 1].hunkType === 'equal') {
      rawHunks[rawHunks.length - 1].originalContent += matchedP
      rawHunks[rawHunks.length - 1].candidateContent += matchedP
    } else {
      rawHunks.push({
        position: 0,
        hunkType: 'equal',
        originalContent: matchedP,
        candidateContent: matchedP,
        selected: true
      })
    }

    origPIdx = match.aIndex + 1
    candPIdx = match.bIndex + 1
  }

  const finalOrigBlock = origParagraphs.slice(origPIdx).join('')
  const finalCandBlock = candParagraphs.slice(candPIdx).join('')
  if (finalOrigBlock || finalCandBlock) {
    const subHunks = computeCharDiffHunks(finalOrigBlock, finalCandBlock)
    rawHunks.push(...subHunks)
  }

  return rawHunks.map((h, position) => ({ ...h, position }))
}

/**
 * Synthesizes final text from hunks and their selection states.
 * SPEC 6.10: "作者可逐块选择采用原文或候选；最终预览是所有选择合成的确定文本。"
 */
export function synthesizeText(hunks: Array<{ originalContent: string; candidateContent: string; selected: boolean }>): string {
  return hunks.map((h) => (h.selected ? h.candidateContent : h.originalContent)).join('')
}

export class CandidateService {
  constructor(
    private readonly store: ProjectStore,
    private readonly searchIndex?: SearchIndex
  ) {}

  getCandidate(sessionId: string, candidateId: string): CandidateDetail {
    return this.store.read(sessionId, (db) => {
      const row = db.prepare(`
        SELECT c.id, c.task_id, c.chapter_id, c.chapter_version, c.start_offset, c.end_offset,
               c.original_content, c.raw_output, c.edited_content, c.version, c.state,
               c.created_at, c.updated_at, t.type AS task_type
        FROM candidate c
        LEFT JOIN task t ON t.id = c.task_id
        WHERE c.id = ?
      `).get(candidateId) as CandidateRow | undefined

      if (!row) throw new ProjectError('VALIDATION_ERROR', '候选不存在')

      const hunkRows = db.prepare(`
        SELECT id, candidate_id, position, hunk_type, original_content, candidate_content, selected
        FROM candidate_hunk
        WHERE candidate_id = ?
        ORDER BY position ASC
      `).all(candidateId) as CandidateHunkRow[]

      const hunks: CandidateHunk[] = hunkRows.map((h) => ({
        id: h.id,
        candidateId: h.candidate_id,
        position: h.position,
        hunkType: h.hunk_type,
        originalContent: h.original_content,
        candidateContent: h.candidate_content,
        selected: Boolean(h.selected)
      }))

      const finalSynthesizedText = synthesizeText(hunks)

      return {
        id: row.id,
        taskId: row.task_id,
        chapterId: row.chapter_id,
        chapterVersion: row.chapter_version,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        originalContent: row.original_content,
        rawOutput: row.raw_output,
        editedContent: row.edited_content,
        version: row.version,
        state: row.state,
        taskType: (row.task_type as TaskType) || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        hunks,
        finalSynthesizedText
      }
    })
  }

  listCandidates(sessionId: string, filters?: { chapterId?: string; taskId?: string }): CandidateSummary[] {
    return this.store.read(sessionId, (db) => {
      let query = `
        SELECT c.id, c.task_id, c.chapter_id, c.chapter_version, c.start_offset, c.end_offset,
               c.raw_output, c.edited_content, c.version, c.state, c.created_at, c.updated_at,
               t.type AS task_type
        FROM candidate c
        LEFT JOIN task t ON t.id = c.task_id
        WHERE 1=1
      `
      const params: unknown[] = []
      if (filters?.chapterId) {
        query += ' AND c.chapter_id = ?'
        params.push(filters.chapterId)
      }
      if (filters?.taskId) {
        query += ' AND c.task_id = ?'
        params.push(filters.taskId)
      }
      query += ' ORDER BY c.created_at DESC, c.rowid DESC'

      const rows = db.prepare(query).all(...params) as Array<CandidateRow & { raw_output: string; edited_content: string | null }>
      return rows.map((r) => {
        const text = r.edited_content !== null ? r.edited_content : r.raw_output
        return {
          id: r.id,
          taskId: r.task_id,
          chapterId: r.chapter_id,
          chapterVersion: r.chapter_version,
          startOffset: r.start_offset,
          endOffset: r.end_offset,
          version: r.version,
          state: r.state,
          taskType: (r.task_type as TaskType) || undefined,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          previewExcerpt: text.slice(0, 80)
        }
      })
    })
  }

  updateText(sessionId: string, candidateId: string, editedContent: string, expectedVersion: number): CandidateDetail {
    this.store.transaction(sessionId, (db) => {
      const candidate = db.prepare('SELECT * FROM candidate WHERE id = ?').get(candidateId) as CandidateRow | undefined
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '候选不存在')
      if (candidate.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '候选已被其他操作修改，请重新载入')
      }
      if (candidate.state !== 'ready') {
        throw new ProjectError('INVALID_STATE_TRANSITION', `处于 ${candidate.state} 状态的候选不可编辑`)
      }

      const now = Date.now()
      const hunks = computeDiffHunks(candidate.original_content, editedContent)

      db.prepare('DELETE FROM candidate_hunk WHERE candidate_id = ?').run(candidateId)
      const insertHunk = db.prepare(`
        INSERT INTO candidate_hunk(id, candidate_id, position, hunk_type, original_content, candidate_content, selected)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const h of hunks) {
        insertHunk.run(randomUUID(), candidateId, h.position, h.hunkType, h.originalContent, h.candidateContent, h.selected ? 1 : 0)
      }

      db.prepare(`
        UPDATE candidate
        SET edited_content = ?, version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(editedContent, now, candidateId)
    })

    return this.getCandidate(sessionId, candidateId)
  }

  stageHunk(sessionId: string, candidateId: string, hunkPosition: number, selected: boolean, expectedVersion: number): CandidateDetail {
    this.store.transaction(sessionId, (db) => {
      const candidate = db.prepare('SELECT * FROM candidate WHERE id = ?').get(candidateId) as CandidateRow | undefined
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '候选不存在')
      if (candidate.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '候选已被其他操作修改，请重新载入')
      }
      if (candidate.state !== 'ready') {
        throw new ProjectError('INVALID_STATE_TRANSITION', `处于 ${candidate.state} 状态的候选不可调整差异块勾选`)
      }

      const now = Date.now()
      const hunk = db.prepare('SELECT id FROM candidate_hunk WHERE candidate_id = ? AND position = ?').get(candidateId, hunkPosition) as { id: string } | undefined
      if (!hunk) throw new ProjectError('VALIDATION_ERROR', `未找到位置为 ${hunkPosition} 的差异块`)

      db.prepare('UPDATE candidate_hunk SET selected = ? WHERE candidate_id = ? AND position = ?').run(selected ? 1 : 0, candidateId, hunkPosition)
      db.prepare('UPDATE candidate SET version = version + 1, updated_at = ? WHERE id = ?').run(now, candidateId)
    })

    return this.getCandidate(sessionId, candidateId)
  }

  retain(sessionId: string, candidateId: string, expectedVersion: number): CandidateDetail {
    this.store.transaction(sessionId, (db) => {
      const candidate = db.prepare('SELECT * FROM candidate WHERE id = ?').get(candidateId) as CandidateRow | undefined
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '候选不存在')
      if (candidate.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '候选已被其他操作修改，请重新载入')
      }
      if (candidate.state !== 'cancelled') {
        throw new ProjectError('INVALID_STATE_TRANSITION', '只有已取消的候选才能保留为待审阅状态')
      }

      const now = Date.now()
      const chap = db.prepare('SELECT version, deleted_at FROM chapter WHERE id = ?').get(candidate.chapter_id) as { version: number; deleted_at: number | null } | undefined

      let targetState: CandidateState = 'ready'
      if (!chap || chap.deleted_at !== null || chap.version !== candidate.chapter_version) {
        targetState = 'stale'
      }

      if (targetState === 'ready') {
        const text = candidate.edited_content !== null ? candidate.edited_content : candidate.raw_output
        const hunks = computeDiffHunks(candidate.original_content, text)
        db.prepare('DELETE FROM candidate_hunk WHERE candidate_id = ?').run(candidateId)
        const insertHunk = db.prepare(`
          INSERT INTO candidate_hunk(id, candidate_id, position, hunk_type, original_content, candidate_content, selected)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const h of hunks) {
          insertHunk.run(randomUUID(), candidateId, h.position, h.hunkType, h.originalContent, h.candidateContent, h.selected ? 1 : 0)
        }
      }

      db.prepare('UPDATE candidate SET state = ?, version = version + 1, updated_at = ? WHERE id = ?').run(targetState, now, candidateId)
    })

    return this.getCandidate(sessionId, candidateId)
  }

  reject(sessionId: string, candidateId: string, expectedVersion: number): CandidateDetail {
    this.store.transaction(sessionId, (db) => {
      const candidate = db.prepare('SELECT * FROM candidate WHERE id = ?').get(candidateId) as CandidateRow | undefined
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '候选不存在')
      if (candidate.version !== expectedVersion) {
        throw new ProjectError('VERSION_CONFLICT', '候选已被其他操作修改，请重新载入')
      }
      if (candidate.state !== 'ready') {
        throw new ProjectError('INVALID_STATE_TRANSITION', `处于 ${candidate.state} 状态的候选不可拒绝`)
      }

      const now = Date.now()
      db.prepare("UPDATE candidate SET state = 'rejected', version = version + 1, updated_at = ? WHERE id = ?").run(now, candidateId)
    })

    return this.getCandidate(sessionId, candidateId)
  }

  apply(sessionId: string, input: ApplyCandidateInput): CandidateApplyResult {
    const { candidateId, expectedCandidateVersion, expectedChapterVersion } = input

    const result = this.store.transaction(sessionId, (db) => {
      const candidate = db.prepare('SELECT * FROM candidate WHERE id = ?').get(candidateId) as CandidateRow | undefined
      if (!candidate) throw new ProjectError('VALIDATION_ERROR', '候选不存在')
      if (candidate.version !== expectedCandidateVersion) {
        throw new ProjectError('VERSION_CONFLICT', '候选已被其他操作修改，请重新载入')
      }
      if (candidate.state !== 'ready') {
        throw new ProjectError('INVALID_STATE_TRANSITION', `处于 ${candidate.state} 状态的候选不可写回`)
      }

      const chap = db.prepare('SELECT id, title, position, content, version, created_at, updated_at, deleted_at FROM chapter WHERE id = ?').get(candidate.chapter_id) as CandidateChapterRow | undefined
      if (!chap || chap.deleted_at !== null) {
        db.prepare("UPDATE candidate SET state = 'stale', version = version + 1, updated_at = ? WHERE id = ?").run(Date.now(), candidateId)
        throw new ProjectError('STALE_CANDIDATE', '目标章节已不存在或被删除，候选已失效')
      }

      if (chap.version !== expectedChapterVersion || chap.version !== candidate.chapter_version) {
        db.prepare("UPDATE candidate SET state = 'stale', version = version + 1, updated_at = ? WHERE id = ?").run(Date.now(), candidateId)
        throw new ProjectError('STALE_CANDIDATE', '章节正文已发生变化，当前候选已失效，禁止写回')
      }

      // Read Hunks & Synthesize replacement text
      const hunkRows = db.prepare(`
        SELECT id, candidate_id, position, hunk_type, original_content, candidate_content, selected
        FROM candidate_hunk
        WHERE candidate_id = ?
        ORDER BY position ASC
      `).all(candidateId) as CandidateHunkRow[]

      const hunks: CandidateHunk[] = hunkRows.map((h) => ({
        id: h.id,
        candidateId: h.candidate_id,
        position: h.position,
        hunkType: h.hunk_type,
        originalContent: h.original_content,
        candidateContent: h.candidate_content,
        selected: Boolean(h.selected)
      }))

      const synthesized = synthesizeText(hunks)

      // Calculate final whole-chapter content
      let newChapterContent = ''
      if (candidate.start_offset !== null && candidate.end_offset !== null) {
        newChapterContent = chap.content.slice(0, candidate.start_offset) + synthesized + chap.content.slice(candidate.end_offset)
      } else if (candidate.start_offset !== null) {
        newChapterContent = chap.content.slice(0, candidate.start_offset) + synthesized + chap.content.slice(candidate.start_offset)
      } else {
        newChapterContent = synthesized
      }

      const now = Date.now()
      const snapshotId = randomUUID()

      // 1. Create permanent snapshot BEFORE writeback (SPEC 6.10, 13.4)
      db.prepare(`
        INSERT INTO chapter_snapshot(id, chapter_id, chapter_version, title, name, content, snapshot_kind, permanent, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'ai_apply', 1, ?)
      `).run(snapshotId, chap.id, chap.version, chap.title, chap.content, now)

      const snapshot: ChapterSnapshot = {
        id: snapshotId,
        chapterId: chap.id,
        chapterVersion: chap.version,
        title: chap.title,
        name: null,
        snapshotKind: 'ai_apply',
        permanent: true,
        createdAt: now
      }

      // 2. Write new content & increment chapter version (SPEC 6.10)
      const nextChapterVersion = chap.version + 1
      db.prepare(`
        UPDATE chapter
        SET content = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(newChapterContent, nextChapterVersion, now, chap.id)

      // 3. Invalidate derived data (SPEC 11.4, ADR 0001)
      db.prepare("UPDATE content_chunk SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(chap.id)
      db.prepare("UPDATE chapter_summary SET state = 'stale' WHERE chapter_id = ? AND state = 'current'").run(chap.id)
      db.prepare("UPDATE source_evidence SET state = 'stale' WHERE chapter_id = ? AND state = 'valid'").run(chap.id)
      db.prepare("UPDATE consistency_issue SET state = 'stale' WHERE chapter_id = ? AND state NOT IN ('dismissed','stale')").run(chap.id)
      db.prepare("UPDATE candidate SET state = 'stale', updated_at = ? WHERE chapter_id = ? AND state = 'ready' AND id <> ?").run(now, chap.id, candidateId)
      db.prepare("UPDATE chapter_outline SET state = 'stale', updated_at = ? WHERE chapter_id = ? AND state IN ('draft','confirmed','current')").run(now, chap.id)

      // 4. Mark search dirty
      db.prepare('UPDATE project_meta SET search_revision = search_revision + 1, updated_at = ?').run(now)

      // 5. Record in candidate_apply
      const applyId = randomUUID()
      const contentHash = createHash('sha256').update(newChapterContent).digest('hex')
      db.prepare(`
        INSERT INTO candidate_apply(id, candidate_id, chapter_id, before_chapter_version, after_chapter_version, chapter_snapshot_id, final_content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(applyId, candidateId, chap.id, chap.version, nextChapterVersion, snapshotId, contentHash, now)

      // 6. Transition candidate to 'applied' & bump version
      db.prepare(`
        UPDATE candidate
        SET state = 'applied', version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(now, candidateId)

      const updatedChapter: Chapter = {
        id: chap.id,
        title: chap.title,
        position: chap.position,
        content: newChapterContent,
        version: nextChapterVersion,
        createdAt: chap.created_at,
        updatedAt: now
      }

      return {
        chapter: updatedChapter,
        snapshot
      }
    })

    void this.searchIndex?.sync(sessionId).catch(() => {})
    const candidateDetail = this.getCandidate(sessionId, candidateId)

    return {
      chapter: result.chapter,
      candidate: candidateDetail,
      snapshot: result.snapshot
    }
  }
}
