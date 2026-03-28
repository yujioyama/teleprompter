import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings } from './useSettings'

beforeEach(() => {
  localStorage.clear()
})

describe('useSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
  })

  it('updates trimEnabled', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimEnabled: false })
    })
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPaddingStart).toBe(0.5) // unchanged
    expect(result.current[0].trimPaddingEnd).toBe(0.8) // unchanged
  })

  it('updates trimPaddingStart', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingStart: 1.2 }) })
    expect(result.current[0].trimPaddingStart).toBe(1.2)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('updates trimPaddingEnd', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingEnd: 1.5 }) })
    expect(result.current[0].trimPaddingEnd).toBe(1.5)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingEnd: 1.0 }) })
    const raw = localStorage.getItem('teleprompter_settings')
    expect(JSON.parse(raw!).trimPaddingEnd).toBe(1.0)
  })

  it('loads persisted settings on mount', () => {
    localStorage.setItem(
      'teleprompter_settings',
      JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 })
    )
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 })
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('teleprompter_settings', 'not-json')
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 })
  })

  it('uses defaults for new fields when loading old-format data', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
    const { result } = renderHook(() => useSettings())
    // trimEnabled is preserved from old data; new fields fall back to DEFAULTS
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPaddingStart).toBe(0.5)
    expect(result.current[0].trimPaddingEnd).toBe(0.8)
  })
})
