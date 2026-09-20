type ChapterTitle = { title: string }

const CHAPTER_TITLE = /^\s*第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回卷部](?:(?:\s*[：:、.-]\s*|\s+).+)?\s*$/u

// ponytail: infer front matter from titles; persist an explicit kind only if renamed/non-standard titles need exact classification.
export function getChapterNumber(chapters: readonly ChapterTitle[], index: number): number | undefined {
  const firstChapterIndex = chapters.findIndex(({ title }) => CHAPTER_TITLE.test(title))
  if (firstChapterIndex < 0) return index + 1
  return index < firstChapterIndex ? undefined : index - firstChapterIndex + 1
}
