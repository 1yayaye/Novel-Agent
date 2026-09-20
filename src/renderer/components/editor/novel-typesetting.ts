/**
 * Novel Typesetting Utilities
 * Standard Chinese novel formatting and punctuation normalization helpers
 */

/**
 * Formats Chinese novel text:
 * 1. Trims each line.
 * 2. If line is not empty, ensures it starts with two full-width Chinese spaces (　　).
 * 3. Compresses 3 or more consecutive empty lines to standard 1 empty line.
 */
export function formatNovelParagraphs(text: string): string {
  if (!text) return ''
  const lines = text.split('\n')
  const formattedLines: string[] = []
  let emptyLineCount = 0

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '') {
      emptyLineCount++
      if (emptyLineCount <= 1 && formattedLines.length > 0) {
        formattedLines.push('')
      }
    } else {
      emptyLineCount = 0
      // Strip any existing leading spaces/tabs/full-width spaces
      const cleanContent = trimmed.replace(/^[\s\u3000\u00A0\t]+/, '')
      // Add standard 2 full-width spaces indentation
      formattedLines.push(`　　${cleanContent}`)
    }
  }

  return formattedLines.join('\n')
}

/**
 * Cleans redundant consecutive blank lines:
 * Collapses 2 or more consecutive blank lines into a single blank line.
 */
export function cleanRedundantBlankLines(text: string): string {
  if (!text) return ''
  return text.replace(/\n\s*\n\s*\n+/g, '\n\n')
}

/**
 * Normalizes English/half-width punctuation to standard Chinese full-width novel punctuation:
 * , -> ，
 * ? -> ？
 * ! -> ！
 * : -> ：
 * ; -> ；
 * ( -> （
 * ) -> ）
 * "..." / '...' -> “...” / ‘...’
 */
export function normalizeChinesePunctuation(text: string): string {
  if (!text) return ''
  let result = text
    .replace(/,/g, '，')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/:/g, '：')
    .replace(/;/g, '；')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/\[/g, '【')
    .replace(/\]/g, '】')
    .replace(/\.{3,}/g, '……') // Convert 3+ dots to ellipsis

  // Smart Chinese quotes pairing
  let inDoubleQuote = false
  result = result.replace(/"/g, () => {
    inDoubleQuote = !inDoubleQuote
    return inDoubleQuote ? '“' : '”'
  })

  let inSingleQuote = false
  result = result.replace(/'/g, () => {
    inSingleQuote = !inSingleQuote
    return inSingleQuote ? '‘' : '’'
  })

  return result
}

/**
 * Wraps text with matching punctuation marks
 */
export function wrapWithPunctuation(text: string, left: string, right: string): string {
  return `${left}${text}${right}`
}
