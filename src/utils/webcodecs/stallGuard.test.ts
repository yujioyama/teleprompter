import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { guardAgainstStall, StallError } from './stallGuard'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

describe('guardAgainstStall', () => {
  it('passes the task result through', async () => {
    await expect(guardAgainstStall(async () => 'done', { timeoutMs: 5000 })).resolves.toBe('done')
  })

  it('passes a task failure through', async () => {
    const failure = new Error('encoder closed')
    await expect(guardAgainstStall(() => Promise.reject(failure), { timeoutMs: 5000 })).rejects.toBe(failure)
  })

  it('gives up on a task that stops reporting progress, and lets it be cancelled', async () => {
    const onStall = vi.fn()
    const guarded = guardAgainstStall(() => new Promise(() => {}), { timeoutMs: 5000, onStall })
    const settled = expect(guarded).rejects.toBeInstanceOf(StallError)

    await vi.advanceTimersByTimeAsync(4000)
    expect(onStall).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)

    await settled
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting as long as the task keeps reporting progress', async () => {
    let finish!: (value: string) => void
    let poke!: () => void
    const guarded = guardAgainstStall(
      p => {
        poke = p
        return new Promise<string>(resolve => (finish = resolve))
      },
      { timeoutMs: 5000 },
    )

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(4000)
      poke()
    }
    finish('done')

    await expect(guarded).resolves.toBe('done')
  })

  it('does not count time the page spends hidden (the codecs are suspended with it)', async () => {
    const onStall = vi.fn()
    const guarded = guardAgainstStall(() => new Promise(() => {}), { timeoutMs: 5000, onStall })
    guarded.catch(() => undefined)

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onStall).not.toHaveBeenCalled()

    // Waking from a long suspension shows up as one late timer tick.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    vi.setSystemTime(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStall).not.toHaveBeenCalled()
  })
})
