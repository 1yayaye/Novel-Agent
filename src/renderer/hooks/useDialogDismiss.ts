import { useEffect, useRef, useCallback } from 'react'

export interface UseDialogDismissOptions<T extends HTMLElement = HTMLDivElement> {
  onClose?: () => void
  isOpen?: boolean
  disableEscape?: boolean
  disableBackdropClick?: boolean
  trapFocus?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
  restoreFocus?: boolean
  triggerRef?: React.RefObject<HTMLElement | null>
}

interface ModalRecord {
  id: symbol
  dismiss: () => void
  getDisableEscape: () => boolean
  getDialogElement: () => HTMLElement | null
}

// Module-level stack of active modals (LIFO)
const modalStack: ModalRecord[] = []
let isGlobalKeyDownAttached = false
let lastNonModalFocusElement: HTMLElement | null = null
let isGlobalFocusListenerAttached = false

function initGlobalFocusTracking() {
  if (typeof document === 'undefined' || isGlobalFocusListenerAttached) return
  document.addEventListener(
    'focus',
    (e) => {
      if (e.target instanceof HTMLElement) {
        const isInsideModal = modalStack.some((m) => {
          const el = m.getDialogElement()
          return el ? el.contains(e.target as Node) : false
        })
        if (!isInsideModal) {
          lastNonModalFocusElement = e.target
        }
      }
    },
    true
  )
  isGlobalFocusListenerAttached = true
}

if (typeof document !== 'undefined') {
  initGlobalFocusTracking()
}

function handleGlobalEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  // Do not dismiss dialog during IME composition (e.g. Chinese Pinyin composition cancellation)
  if (e.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) return
  if (modalStack.length === 0) return

  // The top-most modal is the last item in the stack (LIFO)
  const topModal = modalStack[modalStack.length - 1]
  if (!topModal) return

  // Consume Escape in capture phase to prevent background elements from intercepting
  e.preventDefault()
  e.stopPropagation()

  if (!topModal.getDisableEscape()) {
    topModal.dismiss()
  }
}

function pushModal(record: ModalRecord) {
  modalStack.push(record)
  if (typeof window !== 'undefined' && !isGlobalKeyDownAttached) {
    window.addEventListener('keydown', handleGlobalEscape, true)
    isGlobalKeyDownAttached = true
  }
}

function removeModal(id: symbol) {
  const index = modalStack.findIndex((m) => m.id === id)
  if (index !== -1) {
    modalStack.splice(index, 1)
  }
  if (modalStack.length === 0 && typeof window !== 'undefined' && isGlobalKeyDownAttached) {
    window.removeEventListener('keydown', handleGlobalEscape, true)
    isGlobalKeyDownAttached = false
  }
}

/** Exposed for inspection and testing */
export function getActiveModalStackDepth(): number {
  return modalStack.length
}

/** Reset helper for testing isolation */
export function clearActiveModalStack(): void {
  modalStack.length = 0
  lastNonModalFocusElement = null
  if (typeof window !== 'undefined' && isGlobalKeyDownAttached) {
    window.removeEventListener('keydown', handleGlobalEscape, true)
    isGlobalKeyDownAttached = false
  }
}

function isElementVisible(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false
  if ((el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled) return false
  if (el.closest('[aria-hidden="true"]') || el.closest('[inert]')) return false

  if (el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0) {
    return true
  }
  // Fallback for jsdom / test environments where layout is not computed
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return el.style.display !== 'none' && el.style.visibility !== 'hidden'
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector =
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector))
  return elements.filter((el) => {
    // Exclude elements that belong to a nested dialog inside container
    const closestDialog = el.closest('[role="dialog"]')
    if (closestDialog && closestDialog !== container && container.contains(closestDialog)) {
      return false
    }
    return isElementVisible(el)
  })
}

export function useDialogDismiss<T extends HTMLElement = HTMLDivElement>({
  onClose,
  isOpen = true,
  disableEscape = false,
  disableBackdropClick = false,
  trapFocus = true,
  initialFocusRef,
  restoreFocus = true,
  triggerRef
}: UseDialogDismissOptions<T> = {}) {
  const dialogRef = useRef<T | null>(null)
  const isMouseDownOnBackdropRef = useRef(false)
  const modalIdRef = useRef<symbol>(Symbol('dialog'))
  const triggerElementRef = useRef<HTMLElement | null>(null)

  // Capture currently active element synchronously during render BEFORE DOM autoFocus / commit runs
  if (
    isOpen &&
    !triggerElementRef.current &&
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLElement
  ) {
    if (!dialogRef.current || !dialogRef.current.contains(document.activeElement)) {
      triggerElementRef.current = document.activeElement
    }
  }

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const disableEscapeRef = useRef(disableEscape)
  disableEscapeRef.current = disableEscape

  const isCurrentModalTop = useCallback(() => {
    return modalStack.length === 0 || modalStack[modalStack.length - 1]?.id === modalIdRef.current
  }, [])

  // 1. Modal stack registration for LIFO Escape handling
  useEffect(() => {
    initGlobalFocusTracking()
    if (!isOpen) return

    const id = modalIdRef.current
    const record: ModalRecord = {
      id,
      dismiss: () => {
        onCloseRef.current?.()
      },
      getDisableEscape: () => disableEscapeRef.current,
      getDialogElement: () => dialogRef.current
    }
    pushModal(record)

    return () => {
      removeModal(id)
    }
  }, [isOpen])

  // 2. Focus Restoration: capture activeElement when opening, restore on close/unmount
  useEffect(() => {
    if (!isOpen) {
      triggerElementRef.current = null
      return
    }

    if (triggerRef?.current) {
      triggerElementRef.current = triggerRef.current
    } else if (!triggerElementRef.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      if (dialogRef.current && dialogRef.current.contains(document.activeElement)) {
        if (lastNonModalFocusElement && !dialogRef.current.contains(lastNonModalFocusElement)) {
          triggerElementRef.current = lastNonModalFocusElement
        }
      } else {
        triggerElementRef.current = document.activeElement
      }
    }

    return () => {
      if (restoreFocus && triggerElementRef.current) {
        const trigger = triggerElementRef.current
        triggerElementRef.current = null
        const isConnected = typeof trigger.isConnected === 'boolean' ? trigger.isConnected : document.contains(trigger)
        if (isConnected && typeof trigger.focus === 'function') {
          trigger.focus()
        }
      }
    }
  }, [isOpen, restoreFocus, triggerRef])

  // 3. Focus Trap on Tab / Shift+Tab, auto initial focus, and focus retention
  useEffect(() => {
    if (!isOpen || !trapFocus) return

    const dialogEl = dialogRef.current
    if (!dialogEl) return

    // Auto focus initial element or first focusable
    const timer = window.setTimeout(() => {
      if (!isCurrentModalTop()) return

      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
      } else {
        const focusableElements = getFocusableElements(dialogEl)
        const first = focusableElements[0]
        if (first && !dialogEl.contains(document.activeElement)) {
          first.focus()
        }
      }
    }, 40)

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (!isCurrentModalTop()) return

      const focusableElements = getFocusableElements(dialogEl)
      if (focusableElements.length === 0) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === firstElement || !dialogEl.contains(document.activeElement)) {
          e.preventDefault()
          e.stopPropagation()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement || !dialogEl.contains(document.activeElement)) {
          e.preventDefault()
          e.stopPropagation()
          firstElement.focus()
        }
      }
    }

    // Focus retention: keep focus trapped inside this dialog if it is top-most
    const handleFocusIn = (e: FocusEvent) => {
      if (!isCurrentModalTop()) return

      if (dialogEl && e.target && !dialogEl.contains(e.target as Node)) {
        const focusables = getFocusableElements(dialogEl)
        if (focusables.length > 0) {
          e.preventDefault()
          focusables[0].focus()
        }
      }
    }

    dialogEl.addEventListener('keydown', handleTabKey)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      window.clearTimeout(timer)
      dialogEl.removeEventListener('keydown', handleTabKey)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [isOpen, trapFocus, initialFocusRef, isCurrentModalTop])

  // 4. Safe Backdrop Dismissal (prevents drag-selection release from closing dialog)
  const onBackdropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disableBackdropClick || !onCloseRef.current) return
      if (e.target === e.currentTarget) {
        isMouseDownOnBackdropRef.current = true
      } else {
        isMouseDownOnBackdropRef.current = false
      }
    },
    [disableBackdropClick]
  )

  const onBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (disableBackdropClick || !onCloseRef.current) return
      if (e.target === e.currentTarget && isMouseDownOnBackdropRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
      }
      isMouseDownOnBackdropRef.current = false
    },
    [disableBackdropClick]
  )

  return {
    dialogRef,
    onBackdropMouseDown,
    onBackdropClick,
    backdropProps: {
      onMouseDown: onBackdropMouseDown,
      onClick: onBackdropClick
    }
  }
}
