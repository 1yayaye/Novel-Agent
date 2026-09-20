import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { ImportPreviewResult } from '../shared/project'
import { count } from '../shared/text-counter'
import { ProjectError } from './project-store'

type Encoding = NonNullable<ImportPreviewResult>['encoding']

function decode(bytes: Buffer, encoding: Encoding): string {
  const label = encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : encoding === 'utf16be' ? 'utf-16be' : 'gb18030'
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n')
  } catch {
    throw new ProjectError('FILE_ENCODING_UNKNOWN', `无法按 ${encoding} 解码原文`)
  }
}

function detect(bytes: Buffer): { encoding: Encoding; confidence: 'high' | 'low'; text: string } {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return { encoding: 'utf8', confidence: 'high', text: decode(bytes, 'utf8') }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return { encoding: 'utf16le', confidence: 'high', text: decode(bytes, 'utf16le') }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return { encoding: 'utf16be', confidence: 'high', text: decode(bytes, 'utf16be') }
  try { return { encoding: 'utf8', confidence: 'high', text: decode(bytes, 'utf8') } } catch (error) {
    if (!(error instanceof ProjectError)) throw error
    return { encoding: 'gb18030', confidence: 'low', text: decode(bytes, 'gb18030') }
  }
}

function chapterBoundaries(text: string, isMarkdown: boolean): Array<{ start: number; end: number; title: string }> {
  const lines = text.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) { offsets.push(offset); offset += line.length + 1 }
  const found: Array<{ start: number; end: number; title: string }> = []
  const chinese = /^\s*(第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回卷部](?:(?:\s*[：:、.-]\s*|\s+).+)?)\s*$/u
  for (let index = 0; index < lines.length; index += 1) {
    const atx = isMarkdown ? /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index]) : null
    const setext = isMarkdown && index + 1 < lines.length && /^\s*(?:=+|-+)\s*$/.test(lines[index + 1]) && lines[index].trim()
    const match = atx?.[1] ?? chinese.exec(lines[index])?.[1] ?? (setext ? lines[index].trim() : undefined)
    if (match) found.push({ start: offsets[index], end: offsets[index] + lines[index].length + (setext ? lines[index + 1].length + 1 : 0) + 1, title: match.trim() })
  }
  return found
}

export function parseImport(source: string, encoding?: Encoding): NonNullable<ImportPreviewResult> {
  const extension = extname(source).toLowerCase()
  if (!['.txt', '.md', '.markdown'].includes(extension)) throw new ProjectError('VALIDATION_ERROR', '仅支持 TXT 或 Markdown 文件')
  let bytes: Buffer
  try { bytes = readFileSync(source) } catch { throw new ProjectError('IMPORT_INVALID', '无法读取原文文件') }
  const detected = encoding ? { encoding, confidence: 'high' as const, text: decode(bytes, encoding) } : detect(bytes)
  const boundaries = chapterBoundaries(detected.text, extension !== '.txt')
  const preamble = boundaries.length ? detected.text.slice(0, boundaries[0].start).replace(/^\n+|\n+$/g, '') : ''
  const chapters = boundaries.length
    ? [...(preamble ? [{ title: '正文', content: preamble }] : []), ...boundaries.flatMap((boundary, index) => {
      const content = detected.text.slice(boundary.end, boundaries[index + 1]?.start).replace(/^\n+|\n+$/g, '')
      return boundary.title ? [{ title: boundary.title, content }] : []
    })]
    : [{ title: '正文', content: detected.text }]
  return {
    source,
    encoding: detected.encoding,
    confidence: detected.confidence,
    characterCount: count(detected.text),
    suggestedTitle: basename(source, extension) || '未命名作品',
    chapters
  }
}
