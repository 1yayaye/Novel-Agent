import { useRef, useState, useCallback, useEffect } from 'react'

export function useStreamThrottle(initialValue: string) {
  const [value, setValue] = useState(initialValue)
  const valueRef = useRef(initialValue)
  const frameRef = useRef<number | null>(null)

  const update = useCallback((newValue: string) => {
    valueRef.current = newValue
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        setValue(valueRef.current)
      })
    }
  }, [])

  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    valueRef.current = initialValue
    setValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [])

  return { value, update, flush }
}
