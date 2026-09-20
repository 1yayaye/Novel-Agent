import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isNearBottom,
  decideScrollBehavior,
  SCROLL_BOTTOM_THRESHOLD_PX,
  type ScrollActionType
} from '../src/renderer/utils/chatScroll'

describe('Ticket 04: AI Chat Stream Smooth Scroll & Anti-Hijack Tracking', () => {
  it('calculates isNearBottom correctly with 80px tolerance boundary', () => {
    expect(SCROLL_BOTTOM_THRESHOLD_PX).toBe(80)

    // Exactly at bottom: scrollHeight=1000, clientHeight=400, scrollTop=600 -> dist = 0 <= 80 -> true
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true)

    // 50px away from bottom -> dist = 50 <= 80 -> true
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 550, clientHeight: 400 })).toBe(true)

    // Exactly 80px away from bottom -> true
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 520, clientHeight: 400 })).toBe(true)

    // 81px away from bottom (user scrolled up slightly) -> false
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 519, clientHeight: 400 })).toBe(false)

    // User scrolled high up (300px away) -> false
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false)

    // Null container falls back safely to true
    expect(isNearBottom(null)).toBe(true)
    expect(isNearBottom(undefined)).toBe(true)
  })

  it('verifies streaming vs user-initiated scroll behavior matrix', () => {
    // 1. User is at bottom during high-frequency token generation -> scrolls with 'auto'
    expect(decideScrollBehavior('stream_delta', true)).toEqual({
      shouldScroll: true,
      behavior: 'auto',
      force: false
    })

    // 2. User scrolled up to read earlier history during generation -> DOES NOT scroll (anti-hijack)
    expect(decideScrollBehavior('stream_delta', false)).toEqual({
      shouldScroll: false,
      behavior: 'auto',
      force: false
    })

    // 3. User sends a new message while scrolled up -> forces smooth scroll to bottom
    expect(decideScrollBehavior('user_send', false)).toEqual({
      shouldScroll: true,
      behavior: 'smooth',
      force: true
    })

    // 4. Session switched -> instantly scrolls to bottom
    expect(decideScrollBehavior('session_switch', false)).toEqual({
      shouldScroll: true,
      behavior: 'auto',
      force: true
    })
  })

  it('simulates rapid token streaming burst without queuing animation frames', () => {
    let scrollCount = 0
    let lastBehavior = ''

    const mockContainer = {
      scrollHeight: 1000,
      scrollTop: 600,
      clientHeight: 400,
      scrollTo: vi.fn(({ behavior }: { top: number; behavior: string }) => {
        scrollCount++
        lastBehavior = behavior
      })
    }

    const onTokenStream = (tokens: string[], nearBottom: boolean) => {
      const decision = decideScrollBehavior('stream_delta', nearBottom)
      for (const _token of tokens) {
        if (decision.shouldScroll) {
          mockContainer.scrollTo({ top: mockContainer.scrollHeight, behavior: decision.behavior })
        }
      }
    }

    // High frequency burst of 50 tokens while at bottom
    const burst = Array.from({ length: 50 }, (_, i) => `token_${i}`)
    onTokenStream(burst, true)

    expect(scrollCount).toBe(50)
    expect(lastBehavior).toBe('auto')

    // Now user scrolls up (anti-hijack)
    scrollCount = 0
    onTokenStream(burst, false)
    expect(scrollCount).toBe(0)
  })

  it('verifies ChatWorkbenchDialog integrates decideScrollBehavior, isNearBottom, and triggerScroll', () => {
    const dialogPath = resolve(__dirname, '../src/renderer/components/dialogs/ChatWorkbenchDialog.tsx')
    const content = readFileSync(dialogPath, 'utf8')
    expect(content).toContain('decideScrollBehavior')
    expect(content).toContain('isNearBottom')
    expect(content).toContain('triggerScroll')
  })
})
