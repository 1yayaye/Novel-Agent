import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from './utils'

export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerPortal = DialogPrimitive.Portal
export const DrawerClose = DialogPrimitive.Close

export const DrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'right' | 'left'
  showOverlay?: boolean
}

export const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, children, side = 'right', showOverlay = false, ...props }, ref) => (
  <DrawerPortal>
    {showOverlay && <DrawerOverlay />}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed top-0 bottom-0 z-40 flex flex-col w-[380px] sm:w-[440px] max-w-[90vw] bg-[#faf8f5] border-[#e5ddd3] p-0 shadow-2xl transition-transform duration-300 ease-in-out',
        side === 'right'
          ? 'right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'
          : 'left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

export const DrawerHeader = ({
  className,
  children,
  onClose,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) => (
  <div
    className={cn(
      'flex items-center justify-between px-5 py-4 border-b border-[#e5ddd3] bg-[#faf8f5]/80 backdrop-blur shrink-0',
      className
    )}
    {...props}
  >
    <div className="flex flex-col space-y-1">{children}</div>
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg p-1.5 text-[#7d6b59] hover:bg-[#efe6da] transition-colors focus:outline-none"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </button>
    )}
  </div>
)
DrawerHeader.displayName = 'DrawerHeader'

export const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-[#2c2523]', className)}
    {...props}
  />
))
DrawerTitle.displayName = DialogPrimitive.Title.displayName

export const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs text-[#7d6b59]', className)}
    {...props}
  />
))
DrawerDescription.displayName = DialogPrimitive.Description.displayName

export const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex-1 overflow-y-auto p-5 space-y-4', className)}
    {...props}
  />
)
DrawerBody.displayName = 'DrawerBody'
