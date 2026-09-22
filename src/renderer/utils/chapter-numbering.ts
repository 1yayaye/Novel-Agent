type ChapterTitle = { title: string }

const CHAPTER_TITLE = /^\s*第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回卷部](?:(?:\s*[：:、.-]\s*|\s+).+)?\s*$/u

const firstChapterIndexCache = new WeakMap<readonly ChapterTitle[], number>()

export function getFirstChapterIndex(chapters: readonly ChapterTitle[]): number {
  const cached = firstChapterIndexCache.get(chapters)
  if (cached !== undefined) return cached
  const idx = chapters.findIndex(({ title }) => CHAPTER_TITLE.test(title))
  try {
    firstChapterIndexCache.set(chapters, idx)
  } catch {
    // ignore if chapters is not an object key
  }
  return idx
}

// ponytail: infer front matter from titles; persist an explicit kind only if renamed/non-standard titles need exact classification.
export function getChapterNumber(
  chapters: readonly ChapterTitle[],
  index: number,
  firstChapterIndex?: number
): number | undefined {
  const firstIdx = firstChapterIndex !== undefined ? firstChapterIndex : getFirstChapterIndex(chapters)
  if (firstIdx < 0) return index + 1
  return index < firstIdx ? undefined : index - firstIdx + 1
}
