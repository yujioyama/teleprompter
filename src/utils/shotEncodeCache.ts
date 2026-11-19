import { raceAbort, throwIfCancelled } from './cancellation'
import { recordEncode } from './finalizeTimings'
import { heldMsSoFar } from './webcodecs/encodeHold'

export type EncodeJob = (onProgress: (ratio: number) => void, signal: AbortSignal) => Promise<Blob>

/**
 * One encode the cache can run or reuse.
 *
 * `key` identifies the exact output (same key → same clip, reused). `slot`
 * is what a newer request replaces: only the latest key per slot is kept,
 * and a queued background run for an older key in the slot is skipped.
 */
export interface EncodeRequest {
  slot: string
  key: string
  run: EncodeJob
  /** The clip's length in seconds, for the timings (see finalizeTimings). */
  seconds?: number
}

class SkippedError extends Error {}

let nextBlobId = 1
const blobIds = new WeakMap<Blob, number>()

/** A stable per-session id for a Blob, for building cache keys. */
export function blobId(blob: Blob): number {
  let id = blobIds.get(blob)
  if (id === undefined) {
    id = nextBlobId++
    blobIds.set(blob, id)
  }
  return id
}

/**
 * Caches each shot's encoded clips (trimmed+normalized, or with subtitles
 * burned in) so re-combining or re-burning after changing one shot only
 * re-encodes that one shot, and so FinalizePage can encode ahead in the
 * background while the user is still trimming or reviewing subtitles.
 *
 * Encodes run strictly one at a time, whatever their kind: a phone has few
 * hardware encoder sessions and little memory to spare next to the on-screen
 * <video> (issue #12). A queued background prefetch is skipped when it
 * reaches the head of the queue if its slot has since moved on (e.g. the
 * shot was re-trimmed), so dragging a trim handle doesn't pile up stale full
 * encodes — or if `canRunInBackground` says no (e.g. WebCodecs broke down
 * and encoding fell back to ffmpeg.wasm, whose memory use made iOS drop every
 * preview player). Requests someone is waiting on with get() always run.
 */
export class ShotEncodeCache {
  /** Progress of whichever encode is currently running, by its cache key. */
  onProgress: ((key: string, ratio: number) => void) | null = null

  private results = new Map<string, Promise<Blob>>()
  private latestKeyBySlot = new Map<string, string>()
  private demanded = new Set<string>()
  private chain: Promise<unknown> = Promise.resolve()
  private disposed = false
  // Aborted by cancel(); jobs queued under it are dropped when they come up.
  private controller = new AbortController()
  // Keys whose job hasn't settled yet, so cancel() can forget them.
  private unfinished = new Set<string>()

  constructor(private canRunInBackground: () => boolean | Promise<boolean> = () => true) {}

  /** Start encoding in the background if not already cached/queued. Never rejects. */
  prefetch(request: EncodeRequest): void {
    this.lookup(request).catch(() => undefined)
  }

  /** The clip for this request, encoding it if needed. */
  get(request: EncodeRequest): Promise<Blob> {
    this.demanded.add(request.key)
    return this.lookup(request)
  }

  /**
   * Stop the running encode and drop every queued one (中断する, issue #34).
   * The queue moves on at once even if the running encode never settles;
   * finished clips stay cached, and later requests run as usual.
   */
  cancel(): void {
    this.controller.abort()
    this.controller = new AbortController()
    for (const key of this.unfinished) {
      this.results.delete(key)
      // Otherwise a later prefetch for the same key skips canRunInBackground
      // (it looks like something the caller is still waiting on) and the
      // encode the user just cancelled restarts in the background.
      this.demanded.delete(key)
    }
    this.unfinished.clear()
  }

  /**
   * Let go of a slot's finished clip, so its memory can be freed: for clips
   * nothing ahead needs, on a phone short of memory. A later request for it
   * encodes again. A clip still being made (or waited on) is left alone.
   */
  release(slot: string): void {
    const key = this.latestKeyBySlot.get(slot)
    if (key === undefined || this.unfinished.has(key)) return
    this.results.delete(key)
    this.demanded.delete(key)
    this.latestKeyBySlot.delete(slot)
  }

  /** Stop the running encode and never start the queued ones. */
  dispose(): void {
    this.disposed = true
    this.controller.abort()
    this.results.clear()
  }

  /** Whether this request's clip is already made (not just queued or running). */
  isDone(key: string): boolean {
    return this.results.has(key) && !this.unfinished.has(key)
  }

  private lookup({ slot, key, run, seconds }: EncodeRequest): Promise<Blob> {
    const previousKey = this.latestKeyBySlot.get(slot)
    if (previousKey !== undefined && previousKey !== key) {
      // Only the latest request per slot is worth holding onto.
      this.results.delete(previousKey)
      this.demanded.delete(previousKey)
    }
    this.latestKeyBySlot.set(slot, key)

    const existing = this.results.get(key)
    if (existing) return existing

    const { signal } = this.controller
    const job = this.chain.then(async () => {
      throwIfCancelled(signal)
      if (this.disposed) throw new Error('ShotEncodeCache disposed')
      if (!this.demanded.has(key)) {
        if (this.latestKeyBySlot.get(slot) !== key) throw new SkippedError('superseded by a newer request')
        const allowed = await this.canRunInBackground()
        if (this.disposed) throw new Error('ShotEncodeCache disposed')
        // get() may have been called for this key while that was pending.
        if (!allowed && !this.demanded.has(key)) {
          throw new SkippedError('background encoding not allowed now')
        }
      }
      throwIfCancelled(signal)
      const background = !this.demanded.has(key)
      const start = performance.now()
      const heldAtStart = heldMsSoFar()
      let ok = false
      try {
        // Raced so a hung encode can't hold up the queue once cancelled.
        const blob = await raceAbort(run(ratio => this.onProgress?.(key, ratio), signal), signal)
        ok = true
        return blob
      } finally {
        recordEncode({
          kind: key.split('|')[0],
          shotId: slot.slice(slot.indexOf(':') + 1),
          background,
          ms: performance.now() - start,
          heldMs: heldMsSoFar() - heldAtStart,
          seconds: seconds ?? null,
          ok,
        })
      }
    })
    this.chain = job.catch(() => undefined)
    this.results.set(key, job)
    this.unfinished.add(key)
    job.then(
      () => {
        if (this.results.get(key) === job) this.unfinished.delete(key)
      },
      () => {
        // Don't cache failures (or skips) — the next request should retry.
        if (this.results.get(key) === job) {
          this.results.delete(key)
          this.unfinished.delete(key)
        }
      },
    )
    return job
  }
}
