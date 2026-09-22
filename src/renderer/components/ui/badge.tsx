import * as React from 'react'
import { cn } from './utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-[#efe6da] text-[#2c2523] border-transparent',
    secondary: 'bg-[#e5ddd3] text-[#54473b] border-transparent',
    success: 'bg-[#e8f3ee] text-[#2d6a4f] border-[#c4e1d3]',
    warning: 'bg-[#fef3c7] text-[#b45309] border-[#fde68a]',
    destructive: 'bg-[#fceee9] text-[#c85a32] border-[#f8cfc3]',
    outline: 'border border-[#dacdbe] text-[#7d6b59] bg-transparent'
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors select-none',
        variants[variant || 'default'],
        className
      )}
      {...props}
    />
  )
}
