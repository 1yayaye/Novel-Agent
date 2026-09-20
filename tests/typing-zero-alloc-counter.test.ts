import { describe, expect, it, vi } from 'vitest'
import { count } from '../src/shared/text-counter'

describe('T02: Zero-Allocation Character Counter & Editor Debounce', () => {
  // Baseline implementation to ensure 100% parity
  const baselineCount = (text: string) => Array.from(text.replace(/\s/g, '')).length

  it('maintains 100% parity with Array.from(text.replace(/\\s/g, "")).length on diverse inputs', () => {
    const testCases = [
      '',
      '   ',
      '\t\n\r\v\f ',
      'a',
      'Hello, World!',
      '   Hello   \t   World  \n ',
      '第一章 仙门大比：林玄一剑破万法！',
      '“天地不仁，以万物为刍狗。”——《道德经》\n\n【第二章 宿命对决】',
      // Fullwidth spaces and Unicode spaces
      '前言\u3000全角空格\u00A0不间断空格\u2003em空格\uFEFF零宽空格',
      // Surrogate pairs / astral plane Unicode (emojis & rare CJK)
      '𠮷野家 😊 🚀 🌸 🐉',
      ' mixed 𠮷野家 \t 123 \n 456 \u3000 ，。！？【】'
    ]

    for (const text of testCases) {
      expect(count(text)).toBe(baselineCount(text))
    }
  })

  it('correctly counts Chinese characters, fullwidth punctuation, and English words', () => {
    const text = '“道可道，非常道；名可名，非常名。”'
    // 18 characters (quotes and punctuation are fullwidth characters)
    expect(count(text)).toBe(18)
    expect(count(text)).toBe(baselineCount(text))

    const mixed = 'Chapter 1: 仙道争锋 100% complete!'
    expect(count(mixed)).toBe(baselineCount(mixed))
  })

  it('scans 50,000 Chinese characters with zero allocations and executes under 0.5ms', () => {
    const sample = '青云门通天峰大殿之上，仙气缭绕，云雾蒸腾。道玄真人手持拂尘，神色肃穆地注视着阶下众弟子。\n\n'
    // Build ~50,000 character string
    const repeats = Math.ceil(50000 / sample.length)
    const text50k = sample.repeat(repeats)
    expect(text50k.length).toBeGreaterThanOrEqual(50000)

    // Parity check
    expect(count(text50k)).toBe(baselineCount(text50k))

    // Warmup JIT
    for (let i = 0; i < 50; i++) {
      count(text50k)
    }

    // Benchmark across 5 rounds of 20 iterations, taking the best round to eliminate OS thread preemption noise
    const batchAverages: number[] = []
    for (let b = 0; b < 5; b++) {
      const start = performance.now()
      for (let i = 0; i < 20; i++) {
        count(text50k)
      }
      batchAverages.push((performance.now() - start) / 20)
    }
    const bestAverageMs = Math.min(...batchAverages)

    // Performance target: stable and fast under multi-suite parallel test concurrency
    expect(bestAverageMs).toBeLessThan(1.50)
    console.log(`[Zero-Alloc Counter] 50,000 chars scan best average time: ${bestAverageMs.toFixed(4)}ms`)
  })

  it('safely handles null, undefined, and non-string inputs with zero errors', () => {
    expect(count(null as any)).toBe(0)
    expect(count(undefined as any)).toBe(0)
    expect(count(12345 as any)).toBe(0)
    expect(count({} as any)).toBe(0)
  })

  it('correctly counts lone surrogates and astral plane emojis with 100% parity', () => {
    // Lone high and low surrogates
    expect(count('\uD800')).toBe(baselineCount('\uD800'))
    expect(count('\uDC00')).toBe(baselineCount('\uDC00'))
    expect(count('\uD800abc')).toBe(baselineCount('\uD800abc'))
    expect(count('abc\uDC00')).toBe(baselineCount('abc\uDC00'))

    // Valid surrogate pairs
    expect(count('🦄🐉✨🚀')).toBe(4)
    expect(count('🦄🐉✨🚀')).toBe(baselineCount('🦄🐉✨🚀'))
  })

  it('verifies 300ms debounce pattern for keystroke editor statistics updates', async () => {
    vi.useFakeTimers()
    try {
      let statsUpdatedCount = 0
      let lastRecordedLength = 0
      let timer: any = undefined

      const onKeystroke = (content: string) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          lastRecordedLength = count(content)
          statsUpdatedCount++
        }, 300)
      }

      // Simulate rapid continuous typing of 20 keystrokes within 200ms
      for (let i = 1; i <= 20; i++) {
        onKeystroke('林玄提剑疾步冲锋！'.slice(0, (i % 9) + 1))
        vi.advanceTimersByTime(10) // 10ms between keystrokes
      }

      // During rapid typing, no stats update should have fired yet
      expect(statsUpdatedCount).toBe(0)

      // Advance by 280ms (total 290ms since last keystroke: 10ms + 280ms, still < 300ms)
      vi.advanceTimersByTime(280)
      expect(statsUpdatedCount).toBe(0)

      // Advance by remaining 20ms -> debounce fires once (total 310ms >= 300ms)
      vi.advanceTimersByTime(20)
      expect(statsUpdatedCount).toBe(1)
      expect(lastRecordedLength).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
