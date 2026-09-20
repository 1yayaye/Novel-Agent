import { createHash, randomUUID } from 'node:crypto'

export interface ChunkResult {
  id: string
  startOffset: number
  endOffset: number
  content: string
  contentHash: string
}

function isSurrogatePair(str: string, index: number): boolean {
  if (index <= 0 || index >= str.length) return false
  const prevCode = str.charCodeAt(index - 1)
  const currCode = str.charCodeAt(index)
  return prevCode >= 0xd800 && prevCode <= 0xdbff && currCode >= 0xdc00 && currCode <= 0xdfff
}

function safeSliceIndex(str: string, targetIndex: number): number {
  if (targetIndex <= 0) return 0
  if (targetIndex >= str.length) return str.length
  if (isSurrogatePair(str, targetIndex)) {
    return targetIndex + 1
  }
  return targetIndex
}

interface Segment {
  start: number
  end: number
  text: string
}

/**
 * Split a long paragraph into sentence-level segments.
 * Chinese and English sentence delimiters: 。！？；!?\n
 */
function splitParagraphIntoSentences(paragraphText: string, paragraphStartOffset: number, targetSize: number): Segment[] {
  if (paragraphText.length <= targetSize) {
    return [{
      start: paragraphStartOffset,
      end: paragraphStartOffset + paragraphText.length,
      text: paragraphText
    }]
  }

  const segments: Segment[] = []
  const delimiterRegex = /([。！？；!?\n]|……|\.{3,})/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const sentencePieces: Array<{ start: number; end: number; text: string }> = []

  while ((match = delimiterRegex.exec(paragraphText)) !== null) {
    const end = match.index + match[0].length
    const text = paragraphText.slice(lastIndex, end)
    if (text.length > 0) {
      sentencePieces.push({
        start: paragraphStartOffset + lastIndex,
        end: paragraphStartOffset + end,
        text
      })
    }
    lastIndex = end
  }

  if (lastIndex < paragraphText.length) {
    sentencePieces.push({
      start: paragraphStartOffset + lastIndex,
      end: paragraphStartOffset + paragraphText.length,
      text: paragraphText.slice(lastIndex)
    })
  }

  // If pieces are still too long (e.g. no punctuation), force split by character count
  for (const piece of sentencePieces) {
    if (piece.text.length <= targetSize) {
      segments.push(piece)
    } else {
      let offset = 0
      while (offset < piece.text.length) {
        let step = targetSize
        const tentativeEnd = offset + step
        const safeEnd = safeSliceIndex(piece.text, tentativeEnd)
        const sliced = piece.text.slice(offset, safeEnd)
        segments.push({
          start: piece.start + offset,
          end: piece.start + safeEnd,
          text: sliced
        })
        offset = safeEnd
      }
    }
  }

  return segments
}

/**
 * Split chapter content into temporary chunks (~1000 characters target).
 * Accurately calculates startOffset and endOffset for each chunk.
 */
export function splitIntoChunks(content: string, targetSize = 1000): ChunkResult[] {
  if (!content || content.length === 0) {
    return []
  }

  // If overall content is smaller than targetSize, return as single chunk
  if (content.length <= targetSize) {
    const hash = createHash('sha256').update(content).digest('hex')
    return [{
      id: randomUUID(),
      startOffset: 0,
      endOffset: content.length,
      content,
      contentHash: hash
    }]
  }

  // 1. Identify raw paragraphs (delimited by \n\n or \n)
  const paragraphRegex = /([^\n]+(?:\n|$)+|\n+)/g
  let match: RegExpExecArray | null
  const allSegments: Segment[] = []

  let lastIndex = 0
  while ((match = paragraphRegex.exec(content)) !== null) {
    const start = match.index
    const text = match[0]
    const end = start + text.length
    lastIndex = end

    if (text.length <= targetSize) {
      allSegments.push({ start, end, text })
    } else {
      // Split long paragraph into sentences
      const subSegments = splitParagraphIntoSentences(text, start, targetSize)
      allSegments.push(...subSegments)
    }
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    allSegments.push({ start: lastIndex, end: content.length, text })
  }

  // 2. Aggregate segments into chunks up to targetSize
  const chunks: ChunkResult[] = []
  let currentStart = 0
  let currentEnd = 0
  let currentText = ''

  for (const seg of allSegments) {
    if (currentText.length === 0) {
      currentStart = seg.start
      currentEnd = seg.end
      currentText = seg.text
    } else if (currentText.length + seg.text.length <= targetSize) {
      currentText += seg.text
      currentEnd = seg.end
    } else {
      // Flush current chunk
      const hash = createHash('sha256').update(currentText).digest('hex')
      chunks.push({
        id: randomUUID(),
        startOffset: currentStart,
        endOffset: currentEnd,
        content: currentText,
        contentHash: hash
      })
      currentStart = seg.start
      currentEnd = seg.end
      currentText = seg.text
    }
  }

  if (currentText.length > 0) {
    const hash = createHash('sha256').update(currentText).digest('hex')
    chunks.push({
      id: randomUUID(),
      startOffset: currentStart,
      endOffset: currentEnd,
      content: currentText,
      contentHash: hash
    })
  }

  return chunks
}
