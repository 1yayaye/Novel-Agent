import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './utils'

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = ''
}: {
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
}) => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d6a4f]/30 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] select-none'

  const variants: Record<string, string> = {
    default:
      'bg-[#2d6a4f] text-white shadow-sm hover:bg-[#24583e] active:bg-[#1b4332]',
    destructive:
      'bg-[#c85a32] text-white shadow-sm hover:bg-[#a84724] active:bg-[#8d3b1e]',
    outline:
      'border border-[#dacdbe] bg-transparent text-[#2c2523] hover:bg-[#f5efe6] active:bg-[#efe6da]',
    secondary:
      'bg-[#efe6da] text-[#2c2523] hover:bg-[#e5ddd3] active:bg-[#d6cbbf]',
    ghost:
      'text-[#54473b] hover:bg-[#efe6da]/60 active:bg-[#efe6da]',
    link:
      'text-[#2d6a4f] underline-offset-4 hover:underline'
  }

  const sizes: Record<string, string> = {
    default: 'h-9 px-4 py-2',
    sm: 'h-8 rounded-lg px-3 text-xs',
    lg: 'h-10 rounded-xl px-6',
    icon: 'h-9 w-9 rounded-lg'
  }

  return cn(base, variants[variant || 'default'], sizes[size || 'default'], className)
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
