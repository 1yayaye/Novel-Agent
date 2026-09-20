import { describe, expect, it } from 'vitest'
import { rendererUrl } from '../src/main/runtime'

describe('rendererUrl', () => {
  it('never accepts a development URL in a packaged app', () => {
    expect(rendererUrl(true, 'http://127.0.0.1:5173')).toBeUndefined()
    expect(rendererUrl(false, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
  })
})
