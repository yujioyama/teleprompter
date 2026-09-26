import { describe, it, expect, vi } from 'vitest'
import { NormalizedShotCache, type NormalizeFn } from './normalizedShotCache'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('NormalizedShotCache', () => {
  it('reuses a prefetched result instead of encoding again', async () => {
    const out = new Blob(['out'])
    const normalize = vi.fn<NormalizeFn>(async () => out)
    const cache = new NormalizedShotCache(normalize)
    const src = new Blob(['src'])

    cache.prefetch('s1', src, 0, 2)
    const result = await cache.get('s1', src, 0, 2)

    expect(result).toBe(out)
    expect(normalize).toHaveBeenCalledTimes(1)
  })

  it('re-encodes when the trim range or source blob changes', async () => {
    const normalize = vi.fn<NormalizeFn>(async () => new Blob(['out']))
    const cache = new NormalizedShotCache(normalize)
    const src = new Blob(['src'])

    await cache.get('s1', src, 0, 2)
    await cache.get('s1', src, 0.5, 2)
    await cache.get('s1', new Blob(['src']), 0.5, 2)

    expect(normalize).toHaveBeenCalledTimes(3)
  })

  it('runs encodes one at a time, in request order', async () => {
    const first = deferred<Blob>()
    const calls: string[] = []
    const blobA = new Blob(['a'])
    const blobB = new Blob(['b'])
    const normalize = vi.fn<NormalizeFn>(async blob => {
      const name = blob === blobA ? 'a' : 'b'
      calls.push(name)
      if (name === 'a') return first.promise
      return new Blob([name])
    })
    const cache = new NormalizedShotCache(normalize)

    const a = cache.get('s1', blobA, 0, 1)
    const b = cache.get('s2', blobB, 0, 1)
    await flush()
    expect(calls).toEqual(['a'])

    first.resolve(new Blob(['A']))
    await Promise.all([a, b])
    expect(calls).toEqual(['a', 'b'])
  })

  it('skips a queued prefetch that a newer trim of the same shot superseded', async () => {
    const gate = deferred<Blob>()
    const starts: number[] = []
    const normalize = vi.fn<NormalizeFn>(async (_blob, start) => {
      starts.push(start)
      if (starts.length === 1) return gate.promise
      return new Blob(['out'])
    })
    const cache = new NormalizedShotCache(normalize)
    const busy = new Blob(['busy'])
    const src = new Blob(['src'])

    cache.prefetch('other', busy, 0, 1) // occupies the queue
    cache.prefetch('s1', src, 0, 2) // queued, then superseded below
    cache.prefetch('s1', src, 1, 2)
    gate.resolve(new Blob(['done']))
    await cache.get('s1', src, 1, 2)

    expect(starts).toEqual([0, 1])
  })

  it('drops a failed result so the next request retries it', async () => {
    const normalize = vi
      .fn<NormalizeFn>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(new Blob(['ok']))
    const cache = new NormalizedShotCache(normalize)
    const src = new Blob(['src'])

    cache.prefetch('s1', src, 0, 2)
    await flush()
    await flush()
    await expect(cache.get('s1', src, 0, 2)).resolves.toBeInstanceOf(Blob)
    expect(normalize).toHaveBeenCalledTimes(2)
  })

  it('reports encode progress keyed by the request it belongs to', async () => {
    const normalize = vi.fn<NormalizeFn>(async (_b, _s, _e, onProgress) => {
      onProgress(0.5)
      return new Blob(['out'])
    })
    const cache = new NormalizedShotCache(normalize)
    const src = new Blob(['src'])
    const seen: [string, number][] = []
    cache.onProgress = (key, ratio) => seen.push([key, ratio])

    await cache.get('s1', src, 0, 2)

    expect(seen).toEqual([[cache.keyFor('s1', src, 0, 2), 0.5]])
  })

  it('does not start queued work after dispose', async () => {
    const gate = deferred<Blob>()
    const normalize = vi.fn<NormalizeFn>(async () => gate.promise)
    const cache = new NormalizedShotCache(normalize)

    cache.prefetch('s1', new Blob(['a']), 0, 1)
    cache.prefetch('s2', new Blob(['b']), 0, 1)
    await flush()
    cache.dispose()
    gate.resolve(new Blob(['A']))
    await flush()
    await flush()

    expect(normalize).toHaveBeenCalledTimes(1)
  })
})
