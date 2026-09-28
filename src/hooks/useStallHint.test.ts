import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { STALL_HINT_MS, useStallHint } from './useStallHint'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

describe('useStallHint', () => {
  it('turns on after the signature stays the same for 30 s', () => {
    const { result } = renderHook(() => useStallHint(0.4))
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(true)
  })

  it('starts over whenever the signature changes', () => {
    const { result, rerender } = renderHook(({ progress }) => useStallHint(progress), {
      initialProps: { progress: 0.1 },
    })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    rerender({ progress: 0.2 })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    expect(result.current).toBe(false)
  })

  it('turns back off once progress resumes', () => {
    const { result, rerender } = renderHook(({ progress }) => useStallHint(progress), {
      initialProps: { progress: 0.1 },
    })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS))
    expect(result.current).toBe(true)
    rerender({ progress: 0.2 })
    expect(result.current).toBe(false)
  })

  it('does not count time while the page is hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const { result } = renderHook(() => useStallHint(0.4))
    act(() => vi.advanceTimersByTime(STALL_HINT_MS * 2))
    expect(result.current).toBe(false)
  })
})
