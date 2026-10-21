import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useObjectUrl } from './useObjectUrl'

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

describe('useObjectUrl', () => {
  it('gives a URL for the blob, and none without one', () => {
    const { result, rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: null as Blob | null },
    })
    expect(result.current).toBeNull()
    rerender({ blob: new Blob(['a']) })
    expect(result.current).toBe('blob:1')
  })

  it('revokes the URL once the blob changes or goes', () => {
    const { result, rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: new Blob(['a']) as Blob | null },
    })
    rerender({ blob: new Blob(['b']) })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    expect(result.current).toBe('blob:2')

    rerender({ blob: null })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2')
    expect(result.current).toBeNull()
  })

  it('keeps the same URL while the blob stays the same', () => {
    const blob = new Blob(['a'])
    const { result, rerender } = renderHook(() => useObjectUrl(blob))
    rerender()
    expect(result.current).toBe('blob:1')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('revokes the URL when the component goes away', () => {
    const blob = new Blob(['a'])
    const { unmount } = renderHook(() => useObjectUrl(blob))
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
  })
})
