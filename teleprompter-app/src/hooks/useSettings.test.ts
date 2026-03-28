import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings } from './useSettings'

beforeEach(() => {
  localStorage.clear()
})

describe('useSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
  })

  it('updates trimEnabled', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimEnabled: false })
    })
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPadding).toBe(0.5) // unchanged
  })

  it('updates trimPadding', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimPadding: 1.2 })
    })
    expect(result.current[0].trimPadding).toBe(1.2)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimPadding: 0.8 })
    })
    const raw = localStorage.getItem('teleprompter_settings')
    expect(JSON.parse(raw!).trimPadding).toBe(0.8)
  })

  it('loads persisted settings on mount', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: false, trimPadding: 1.0 })
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('teleprompter_settings', 'not-json')
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPadding: 0.5 })
  })
})
