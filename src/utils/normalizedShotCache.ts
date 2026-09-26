export type NormalizeFn = (
  blob: Blob,
  start: number,
  end: number,
  onProgress: (ratio: number) => void,
) => Promise<Blob>

class SupersededError extends Error {}

let nextBlobId = 1
const blobIds = new WeakMap<Blob, number>()

function blobId(blob: Blob): number {
  let id = blobIds.get(blob)
  if (id === undefined) {
    id = nextBlobId++
    blobIds.set(blob, id)
  }
  return id
}

/**
 * Caches each shot's trimmed+normalized clip so the finalize screen can
 * encode shots in the background while the user is still adjusting trims,
 * leaving only the fast `-c copy` concat for the "結合" button — and so a
 * re-combine after tweaking one shot only re-encodes that one shot.
 *
 * Encodes run strictly one at a time (the app shares one single-threaded
 * ffmpeg.wasm instance). A queued background prefetch whose shot has since
 * been re-trimmed is skipped when it reaches the head of the queue, so
 * dragging a trim handle doesn't pile up stale full encodes.
 */
export class NormalizedShotCache {
  /** Progress of whichever encode is currently running, by its cache key. */
  onProgress: ((key: string, ratio: number) => void) | null = null

  private results = new Map<string, Promise<Blob>>()
  private latestKeyByShot = new Map<string, string>()
  private demanded = new Set<string>()
  private chain: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private normalize: NormalizeFn) {}

  keyFor(shotId: string, blob: Blob, start: number, end: number): string {
    return `${shotId}|${blobId(blob)}|${start.toFixed(3)}|${end.toFixed(3)}`
  }

  /** Start encoding in the background if not already cached/queued. Never rejects. */
  prefetch(shotId: string, blob: Blob, start: number, end: number): void {
    this.lookup(shotId, blob, start, end).catch(() => undefined)
  }

  /** The normalized clip for this exact shot/source/trim, encoding it if needed. */
  get(shotId: string, blob: Blob, start: number, end: number): Promise<Blob> {
    this.demanded.add(this.keyFor(shotId, blob, start, end))
    return this.lookup(shotId, blob, start, end)
  }

  /** Stop starting queued encodes (an in-flight one can't be interrupted). */
  dispose(): void {
    this.disposed = true
    this.results.clear()
  }

  private lookup(shotId: string, blob: Blob, start: number, end: number): Promise<Blob> {
    const key = this.keyFor(shotId, blob, start, end)
    const previousKey = this.latestKeyByShot.get(shotId)
    if (previousKey !== undefined && previousKey !== key) {
      // Only the latest trim per shot is worth holding onto.
      this.results.delete(previousKey)
      this.demanded.delete(previousKey)
    }
    this.latestKeyByShot.set(shotId, key)

    const existing = this.results.get(key)
    if (existing) return existing

    const job = this.chain.then(() => {
      if (this.disposed) throw new Error('NormalizedShotCache disposed')
      if (this.latestKeyByShot.get(shotId) !== key && !this.demanded.has(key)) {
        throw new SupersededError('superseded by a newer trim')
      }
      return this.normalize(blob, start, end, ratio => this.onProgress?.(key, ratio))
    })
    this.chain = job.catch(() => undefined)
    this.results.set(key, job)
    job.catch(() => {
      // Don't cache failures — the next request should retry the encode.
      if (this.results.get(key) === job) this.results.delete(key)
    })
    return job
  }
}
