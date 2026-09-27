import { describe, it, expect, vi } from 'vitest'
import { ShotEncodeCache, blobId, type EncodeJob, type EncodeRequest } from './shotEncodeCache'
import { CancelledError } from './cancellation'

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

function request(slot: string, key: string, run: EncodeJob): EncodeRequest {
  return { slot, key, run }
}

describe('ShotEncodeCache', () => {
  it('reuses a prefetched result instead of encoding again', async () => {
    const out = new Blob(['out'])
    const run = vi.fn<EncodeJob>(async () => out)
    const cache = new ShotEncodeCache()

    cache.prefetch(request('s1', 'k1', run))
    const result = await cache.get(request('s1', 'k1', run))

    expect(result).toBe(out)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('encodes again when the key for a slot changes', async () => {
    const run = vi.fn<EncodeJob>(async () => new Blob(['out']))
    const cache = new ShotEncodeCache()

    await cache.get(request('s1', 'k1', run))
    await cache.get(request('s1', 'k2', run))
    await cache.get(request('s1', 'k1', run))

    expect(run).toHaveBeenCalledTimes(3)
  })

  it('keeps separate slots of the same shot cached side by side', async () => {
    const run = vi.fn<EncodeJob>(async () => new Blob(['out']))
    const cache = new ShotEncodeCache()

    await cache.get(request('norm:s1', 'n', run))
    await cache.get(request('burn:s1', 'b', run))
    await cache.get(request('norm:s1', 'n', run))

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs encodes one at a time, in request order', async () => {
    const first = deferred<Blob>()
    const calls: string[] = []
    const cache = new ShotEncodeCache()

    const a = cache.get(request('s1', 'a', async () => {
      calls.push('a')
      return first.promise
    }))
    const b = cache.get(request('s2', 'b', async () => {
      calls.push('b')
      return new Blob(['b'])
    }))
    await flush()
    expect(calls).toEqual(['a'])

    first.resolve(new Blob(['A']))
    await Promise.all([a, b])
    expect(calls).toEqual(['a', 'b'])
  })

  it('skips a queued prefetch that a newer request for the same slot superseded', async () => {
    const gate = deferred<Blob>()
    const ran: string[] = []
    const job = (name: string): EncodeJob => async () => {
      ran.push(name)
      return name === 'busy' ? gate.promise : new Blob([name])
    }
    const cache = new ShotEncodeCache()

    cache.prefetch(request('other', 'busy', job('busy'))) // occupies the queue
    cache.prefetch(request('s1', 'old', job('old'))) // queued, then superseded below
    cache.prefetch(request('s1', 'new', job('new')))
    gate.resolve(new Blob(['done']))
    await cache.get(request('s1', 'new', job('new')))

    expect(ran).toEqual(['busy', 'new'])
  })

  it('skips queued prefetches while background encoding is not allowed, but still serves get()', async () => {
    const run = vi.fn<EncodeJob>(async () => new Blob(['out']))
    const cache = new ShotEncodeCache(() => false)

    cache.prefetch(request('s1', 'k1', run))
    await flush()
    await flush()
    expect(run).not.toHaveBeenCalled()

    await expect(cache.get(request('s1', 'k1', run))).resolves.toBeInstanceOf(Blob)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs a prefetch that get() claimed while the background check was pending', async () => {
    const allowed = deferred<boolean>()
    const run = vi.fn<EncodeJob>(async () => new Blob(['out']))
    const cache = new ShotEncodeCache(() => allowed.promise)

    cache.prefetch(request('s1', 'k1', run))
    await flush()
    const result = cache.get(request('s1', 'k1', run))
    allowed.resolve(false)

    await expect(result).resolves.toBeInstanceOf(Blob)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops a failed result so the next request retries it', async () => {
    const run = vi
      .fn<EncodeJob>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(new Blob(['ok']))
    const cache = new ShotEncodeCache()

    cache.prefetch(request('s1', 'k1', run))
    await flush()
    await flush()
    await expect(cache.get(request('s1', 'k1', run))).resolves.toBeInstanceOf(Blob)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports encode progress keyed by the request it belongs to', async () => {
    const cache = new ShotEncodeCache()
    const seen: [string, number][] = []
    cache.onProgress = (key, ratio) => seen.push([key, ratio])

    await cache.get(request('s1', 'k1', async onProgress => {
      onProgress(0.5)
      return new Blob(['out'])
    }))

    expect(seen).toEqual([['k1', 0.5]])
  })

  it('does not start queued work after dispose', async () => {
    const gate = deferred<Blob>()
    const run = vi.fn<EncodeJob>(async () => gate.promise)
    const cache = new ShotEncodeCache()

    cache.prefetch(request('s1', 'a', run))
    cache.prefetch(request('s2', 'b', run))
    await flush()
    cache.dispose()
    gate.resolve(new Blob(['A']))
    await flush()
    await flush()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancel() rejects a hung encode and lets the next request run (issue #34)', async () => {
    const cache = new ShotEncodeCache()
    const hung = cache.get(request('s1', 'a', () => new Promise<Blob>(() => {})))
    await flush()

    cache.cancel()

    await expect(hung).rejects.toBeInstanceOf(CancelledError)
    await expect(cache.get(request('s2', 'b', async () => new Blob(['b'])))).resolves.toBeInstanceOf(Blob)
  })

  it('cancel() aborts the signal handed to the running encode', async () => {
    const cache = new ShotEncodeCache()
    let seen: AbortSignal | undefined
    const running = cache.get(request('s1', 'a', (_onProgress, signal) => {
      seen = signal
      return new Promise<Blob>(() => {})
    }))
    await flush()

    cache.cancel()

    await expect(running).rejects.toBeInstanceOf(CancelledError)
    expect(seen?.aborted).toBe(true)
  })

  it('cancel() drops queued encodes without running them', async () => {
    const cache = new ShotEncodeCache()
    const queuedRun = vi.fn<EncodeJob>(async () => new Blob(['q']))
    const running = cache.get(request('s1', 'a', () => new Promise<Blob>(() => {})))
    const queued = cache.get(request('s2', 'b', queuedRun))
    await flush()

    cache.cancel()

    await expect(running).rejects.toBeInstanceOf(CancelledError)
    await expect(queued).rejects.toBeInstanceOf(CancelledError)
    expect(queuedRun).not.toHaveBeenCalled()
  })

  it('cancel() keeps finished results', async () => {
    const cache = new ShotEncodeCache()
    const run = vi.fn<EncodeJob>(async () => new Blob(['done']))
    const first = await cache.get(request('s1', 'a', run))

    cache.cancel()

    await expect(cache.get(request('s1', 'a', run))).resolves.toBe(first)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs a request made after cancel() afresh instead of reusing the cancelled one', async () => {
    const cache = new ShotEncodeCache()
    const run = vi
      .fn<EncodeJob>()
      .mockImplementationOnce(() => new Promise<Blob>(() => {}))
      .mockResolvedValue(new Blob(['retry']))
    const first = cache.get(request('s1', 'a', run))
    await flush()

    cache.cancel()
    const retry = cache.get(request('s1', 'a', run))

    await expect(first).rejects.toBeInstanceOf(CancelledError)
    await expect(retry).resolves.toBeInstanceOf(Blob)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel() un-demands cancelled keys, so a later prefetch still respects canRunInBackground (issue #34)', async () => {
    const cache = new ShotEncodeCache(() => false)
    const hung = cache.get(request('s1', 'a', () => new Promise<Blob>(() => {})))
    await flush()

    cache.cancel()
    await expect(hung).rejects.toBeInstanceOf(CancelledError)
    await flush()

    const run = vi.fn<EncodeJob>(async () => new Blob(['out']))
    cache.prefetch(request('s1', 'a', run))
    await flush()
    await flush()

    expect(run).not.toHaveBeenCalled()
  })

  it('dispose() aborts the running encode', async () => {
    const cache = new ShotEncodeCache()
    let seen: AbortSignal | undefined
    const running = cache.get(request('s1', 'a', (_onProgress, signal) => {
      seen = signal
      return new Promise<Blob>(() => {})
    }))
    await flush()

    cache.dispose()

    await expect(running).rejects.toThrow()
    expect(seen?.aborted).toBe(true)
  })
})

describe('blobId', () => {
  it('is stable for a blob and distinct between blobs', () => {
    const a = new Blob(['x'])
    const b = new Blob(['x'])
    expect(blobId(a)).toBe(blobId(a))
    expect(blobId(a)).not.toBe(blobId(b))
  })
})
