import React from 'react'

export function StreamingText({ text }: { text: string }) {
  if (!text) return null

  // Split on whitespace while preserving spaces
  const tokens = text.split(/(\s+)/)

  return (
    <span className="inline text-inherit leading-relaxed">
      {tokens.map((token, i) => (
        <span key={i} className={token.trim() ? 'streaming-text-word' : 'inline'}>
          {token}
        </span>
      ))}
      <span
        className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-current opacity-80"
        style={{ animation: 'fade-in 150ms ease-out both' }}
      />
    </span>
  )
}
