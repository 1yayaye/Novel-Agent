/**
 * Allocation-free character counter for Chinese and multilingual text.
 * Strictly parity-compatible with: Array.from(text.replace(/\s/g, '')).length
 * 
 * Performance:
 * - Scans strings in a single pass without allocating intermediate strings or arrays.
 * - Accurately skips all JavaScript RegExp \s whitespace characters:
 *   - ASCII whitespace: \t (0x09), \n (0x0A), \v (0x0B), \f (0x0C), \r (0x0D), space (0x20)
 *   - Unicode whitespace: \u00A0, \u1680, \u2000-\u200A, \u2028, \u2029, \u202F, \u205F, \u3000, \uFEFF
 * - Correctly counts surrogate pairs (astral plane / emojis) as 1 character (matching Array.from code points).
 */
export function count(text: string): number {
  if (!text || typeof text !== 'string') return 0
  let c = 0
  const len = text.length
  let i = 0
  while (i < len) {
    const code = text.charCodeAt(i++)
    // Fast path: common CJK characters (0x3001..0xD7FF)
    if (code > 0x3000 && code < 0xd800) {
      c++
    } else if (code > 32 && code < 127) {
      // Fast path: ASCII printable characters
      c++
    } else if (code <= 32) {
      // ASCII whitespace: \t (9), \n (10), \v (11), \f (12), \r (13), space (32)
      if (code !== 32 && (code < 9 || code > 13)) c++
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: check if followed by low surrogate
      if (i < len && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff) {
        i++
      }
      c++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate
      c++
    } else if (code > 0xdfff && code !== 0xfeff) {
      // High plane characters except \uFEFF (zero-width no-break space)
      c++
    } else if (code > 126 && code < 0x2000) {
      // Latin-1 / Unicode up to 0x2000; skip \u00A0 and \u1680
      if (code !== 0x00a0 && code !== 0x1680) c++
    } else if (code > 0x200a && code < 0x3000) {
      // General punctuation range; skip line/paragraph separators & math space
      if (code !== 0x2028 && code !== 0x2029 && code !== 0x202f && code !== 0x205f) c++
    }
  }
  return c
}
