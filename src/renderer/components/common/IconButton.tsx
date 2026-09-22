import type React from 'react'

export const IconButton = ({
  label,
  onClick,
  children,
  disabled = false,
  className = '',
  title
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  className?: string
  title?: string
}) => (
  <button
    className={`icon-button ${className}`.trim()}
    aria-label={label}
    title={title ?? label}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
)
