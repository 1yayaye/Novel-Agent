import type React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@appica/ui-react/tooltip'
import { Button } from '@appica/ui-react/button'

export const IconButton = ({
  label,
  onClick,
  children,
  disabled = false,
  className = '',
  title,
  side = 'bottom'
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  className?: string
  title?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}) => (
  <TooltipProvider delay={300}>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={`icon-button ${className}`.trim()}
            aria-label={label}
            onClick={onClick}
            onFocus={(event) => event.preventDefault()}
            disabled={disabled}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>{title ?? label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

