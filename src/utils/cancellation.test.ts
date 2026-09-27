import { describe, it, expect, vi } from 'vitest'
import { CancelledError, onAbort, raceAbort, throwIfCancelled } from './cancellation'

describe('throwIfCancelled', () => {
  it('does nothing without a signal or before it aborts', () => {
    expect(() => throwIfCancelled()).not.toThrow()
    expect(() => throwIfCancelled(new AbortController().signal)).not.toThrow()
  })

  it('throws CancelledError once the signal has aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfCancelled(controller.signal)).toThrow(CancelledError)
  })
})

describe('onAbort', () => {
  it('runs stop when the signal aborts', () => {
    const controller = new AbortController()
    const stop = vi.fn()
    onAbort(controller.signal, stop)
    expect(stop).not.toHaveBeenCalled()
    controller.abort()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('runs stop right away for an already-aborted signal', () => {
    const controller = new AbortController()
    controller.abort()
    const stop = vi.fn()
    onAbort(controller.signal, stop)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('no longer runs stop once unregistered', () => {
    const controller = new AbortController()
    const stop = vi.fn()
    onAbort(controller.signal, stop)()
    controller.abort()
    expect(stop).not.toHaveBeenCalled()
  })

  it('is a no-op without a signal', () => {
    const stop = vi.fn()
    onAbort(undefined, stop)()
    expect(stop).not.toHaveBeenCalled()
  })
})

describe('raceAbort', () => {
  it('passes the result through', async () => {
    await expect(raceAbort(Promise.resolve('done'), new AbortController().signal)).resolves.toBe('done')
  })

  it('passes a failure through', async () => {
    const failure = new Error('boom')
    await expect(raceAbort(Promise.reject(failure), new AbortController().signal)).rejects.toBe(failure)
  })

  it('rejects with CancelledError on abort, even if the promise never settles', async () => {
    const controller = new AbortController()
    const raced = raceAbort(new Promise(() => {}), controller.signal)
    controller.abort()
    await expect(raced).rejects.toBeInstanceOf(CancelledError)
  })

  it('rejects at once for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(raceAbort(new Promise(() => {}), controller.signal)).rejects.toBeInstanceOf(CancelledError)
  })

  it('returns the promise as-is without a signal', () => {
    const promise = Promise.resolve(1)
    expect(raceAbort(promise)).toBe(promise)
  })
})
