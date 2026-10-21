import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSaveWhenSettled } from './useSaveWhenSettled'

const DELAY = 300

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function render(signature: string | null, save = vi.fn()) {
  const hook = renderHook(({ signature }) => useSaveWhenSettled(signature, save, DELAY), {
    initialProps: { signature },
  })
  return { ...hook, save }
}

describe('useSaveWhenSettled', () => {
  it('saves once a change has settled, not per intermediate value', () => {
    const { rerender, save } = render('a')
    act(() => vi.advanceTimersByTime(DELAY))
    save.mockClear()

    rerender({ signature: 'b' })
    act(() => vi.advanceTimersByTime(DELAY - 100))
    rerender({ signature: 'c' })
    act(() => vi.advanceTimersByTime(DELAY - 100))
    expect(save).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(100))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not write back what was marked as stored', () => {
    const { result, rerender, save } = render(null)
    act(() => result.current('loaded'))
    rerender({ signature: 'loaded' })
    act(() => vi.advanceTimersByTime(DELAY))
    expect(save).not.toHaveBeenCalled()

    rerender({ signature: 'edited' })
    act(() => vi.advanceTimersByTime(DELAY))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('skips a change that went back to what is saved before it settled', () => {
    const { result, rerender, save } = render('saved')
    act(() => result.current('saved'))
    rerender({ signature: 'dragging' })
    act(() => vi.advanceTimersByTime(DELAY - 100))
    rerender({ signature: 'saved' })
    act(() => vi.advanceTimersByTime(DELAY))
    expect(save).not.toHaveBeenCalled()
  })

  it('saves nothing while the signature is null', () => {
    const { rerender, save } = render('a')
    act(() => vi.advanceTimersByTime(DELAY))
    save.mockClear()
    rerender({ signature: null })
    act(() => vi.advanceTimersByTime(DELAY))
    expect(save).not.toHaveBeenCalled()
  })

  it('saves with the latest save function', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ signature, save }) => useSaveWhenSettled(signature, save, DELAY), {
      initialProps: { signature: 'a', save: first },
    })
    rerender({ signature: 'b', save: second })
    act(() => vi.advanceTimersByTime(DELAY))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
