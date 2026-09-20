import type React from 'react'

export function HighlightedText({ text, highlightOffsets }: { text: string; highlightOffsets: Array<[number, number]> }) {
  if (!highlightOffsets || highlightOffsets.length === 0) {
    return <span>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  highlightOffsets.forEach(([start, end], idx) => {
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }
    parts.push(
      <mark key={idx} className="search-highlight">
        {text.slice(start, end)}
      </mark>
    )
    lastIndex = end
  })

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <span>{parts}</span>
}
