/**
 * The user stopped a long-running job with 中断する (issue #34). Not a
 * failure: never shown as an error, and never a reason to fall back to
 * another encoder or to turn WebCodecs off.
 */
export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

/** Throw CancelledError if `signal` has aborted. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError()
}

/**
 * Run `stop` when `signal` aborts (right away if it already has). Returns a
 * function that unregisters it, for when the work finished on its own.
 */
export function onAbort(signal: AbortSignal | undefined, stop: () => void): () => void {
  if (!signal) return () => undefined
  if (signal.aborted) {
    stop()
    return () => undefined
  }
  signal.addEventListener('abort', stop, { once: true })
  return () => signal.removeEventListener('abort', stop)
}

/**
 * Settle with `promise`, or reject with CancelledError as soon as `signal`
 * aborts, whether or not `promise` ever settles. A hung encode can't be
 * trusted to notice it was stopped, so this is what lets the page and the
 * encode queue move on regardless.
 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  // The abandoned promise may still reject later (e.g. once ffmpeg is
  // terminated); nobody is waiting on it any more.
  promise.catch(() => undefined)
  return new Promise<T>((resolve, reject) => {
    const unregister = onAbort(signal, () => reject(new CancelledError()))
    promise.then(
      value => {
        unregister()
        resolve(value)
      },
      err => {
        unregister()
        reject(err)
      },
    )
  })
}

// How to drop each session-wide setup step still running (see forgetOnCancel).
const unfinishedSetup = new Set<() => void>()

/**
 * Note a setup step that runs once and is kept for the rest of the session
 * (the WebCodecs support check, the AAC delay measurement, loading
 * ffmpeg.wasm). One that never settles would make every later attempt wait
 * on it too, so 中断する and trying again stopped at the same place, at 0%.
 * If forgetUnfinishedSetup() comes before `promise` settles, `forget` drops
 * it so the next attempt starts afresh.
 */
export function forgetOnCancel<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  unfinishedSetup.add(forget)
  const settled = () => unfinishedSetup.delete(forget)
  promise.then(settled, settled)
  return promise
}

/** 中断する: drop every setup step still running (see forgetOnCancel). */
export function forgetUnfinishedSetup(): void {
  const forgets = [...unfinishedSetup]
  unfinishedSetup.clear()
  for (const forget of forgets) forget()
}
