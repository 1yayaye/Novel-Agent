import React, { createContext, useContext, useCallback, useMemo } from 'react'
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import {
  ToastProvider as AppicaToastProvider,
  Toaster,
  useToastManager
} from '@appica/ui-react/toast'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration?: number
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    // Fallback in case used outside ToastProvider
    return {
      showToast: (message: string, type = 'info') => {
        console.warn(`[Toast fallback: ${type}] ${message}`)
      },
      dismissToast: () => {}
    }
  }
  return context
}

function ToastBridge({ children }: { children: React.ReactNode }) {
  const toastManager = useToastManager()

  const dismissToast = useCallback(
    (id: string) => {
      toastManager.close(id)
    },
    [toastManager]
  )

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = 3500) => {
      let icon: React.ReactNode = <Info size={16} />
      if (type === 'success') icon = <CheckCircle2 size={16} />
      else if (type === 'error') icon = <AlertCircle size={16} />
      else if (type === 'warning') icon = <AlertTriangle size={16} />

      toastManager.add({
        title: message,
        type,
        timeout: duration ?? 3500,
        priority: type === 'error' ? 'high' : 'low',
        data: { icon }
      })
    },
    [toastManager]
  )

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppicaToastProvider>
      <Toaster position="bottom-right" />
      <ToastBridge>{children}</ToastBridge>
    </AppicaToastProvider>
  )
}
