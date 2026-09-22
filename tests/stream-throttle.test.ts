import { describe, expect, it, vi } from 'vitest'
import { createStreamThrottler } from '../src/main/stream-throttle'

describe('createStreamThrottler', () => {
  it('emits immediately, keeps the latest pending value, and flushes once', () => {
    vi.useFakeTimers()
    try {
      const values: number[] = []
      const throttler = createStreamThrottler(60, (value: number) => values.push(value))

      throttler.push(1)
      throttler.push(2)
      throttler.push(3)
      expect(values).toEqual([1])

      vi.advanceTimersByTime(59)
      expect(values).toEqual([1])
      vi.advanceTimersByTime(1)
      expect(values).toEqual([1, 3])

      throttler.push(4)
      throttler.flush()
      throttler.flush()
      expect(values).toEqual([1, 3, 4])
    } finally {
      vi.useRealTimers()
    }
  })
})
