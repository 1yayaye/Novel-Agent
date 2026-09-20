import type React from 'react'

export const IconButton = ({ label, onClick, children, disabled = false, className = '' }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; className?: string }) => (
  <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
)
