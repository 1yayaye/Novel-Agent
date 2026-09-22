export function createStreamThrottler<T>(intervalMs: number, emit: (value: T) => void): {
  push(value: T): void
  flush(): void
} {
  let pending: T | undefined
  let hasPending = false
  let lastEmittedAt: number | undefined
  let timer: NodeJS.Timeout | undefined

  const emitPending = () => {
    if (!hasPending) return
    const value = pending as T
    pending = undefined
    hasPending = false
    lastEmittedAt = Date.now()
    emit(value)
  }

  const schedule = (delayMs: number) => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      emitPending()
    }, delayMs)
    timer.unref?.()
  }

  return {
    push(value) {
      pending = value
      hasPending = true

      const elapsed = lastEmittedAt === undefined ? Infinity : Date.now() - lastEmittedAt
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        emitPending()
      } else {
        schedule(intervalMs - elapsed)
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      emitPending()
    }
  }
}
