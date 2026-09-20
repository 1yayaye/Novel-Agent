import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let isMounted = true
    if (window.novelAgent?.window?.isMaximized) {
      window.novelAgent.window
        .isMaximized()
        .then((max) => {
          if (isMounted) setIsMaximized(Boolean(max))
        })
        .catch(() => {})
    }

    const unsub = window.novelAgent?.window?.onMaximizedChange?.((max) => {
      if (isMounted) setIsMaximized(Boolean(max))
    })

    return () => {
      isMounted = false
      unsub?.()
    }
  }, [])

  const handleMinimize = () => {
    window.novelAgent?.window?.minimize?.().catch(() => {})
  }

  const handleToggleMaximize = () => {
    window.novelAgent?.window?.maximize?.().catch(() => {})
  }

  const handleClose = () => {
    window.novelAgent?.window?.close?.().catch(() => {})
  }

  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        type="button"
        className="win-btn minimize"
        onClick={handleMinimize}
        title="最小化"
        aria-label="最小化"
      >
        <Minus size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="win-btn maximize"
        onClick={handleToggleMaximize}
        title={isMaximized ? '向下还原' : '最大化'}
        aria-label={isMaximized ? '向下还原' : '最大化'}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3.5" y="1.5" width="7" height="7" rx="1" />
            <path d="M1.5 3.5V9.5C1.5 10.0523 1.94772 10.5 2.5 10.5H8.5" />
          </svg>
        ) : (
          <Square size={13} strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        className="win-btn close"
        onClick={handleClose}
        title="关闭"
        aria-label="关闭"
      >
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  )
}
