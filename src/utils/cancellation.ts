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
