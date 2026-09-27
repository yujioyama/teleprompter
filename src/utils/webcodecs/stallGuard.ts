/**
 * How long an encode may go without progress before it's given up on. A
 * hardware encode reports progress every frame, so this is far beyond any
 * legitimate pause.
 */
export const STALL_TIMEOUT_MS = 30_000

const TICK_MS = 1000

export class StallError extends Error {}

/**
 * Run `task`, rejecting with StallError (after calling `onStall`, so the
 * caller can cancel it) if it goes `timeoutMs` without calling the `poke`
 * it's handed.
 *
 * A WebCodecs encode can stop dead without ever settling — e.g. Mediabunny
 * waits for the encoder's `dequeue` event, which may never come once the
 * encoder has broken down — leaving 結合 spinning forever (issue #31).
 * Giving up lets the caller fall back to ffmpeg.wasm.
 *
 * Only time the page is visible counts: a hidden page is suspended along
 * with its codecs, and waking up from that is not a stall.
 */
export function guardAgainstStall<T>(
  task: (poke: () => void) => Promise<T>,
  { timeoutMs = STALL_TIMEOUT_MS, onStall }: { timeoutMs?: number; onStall?: () => void } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let idle = 0
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      // A long gap between ticks means the page was asleep; count it as at
      // most a couple of ticks.
      if (!document.hidden) idle += Math.min(now - last, TICK_MS * 2)
      last = now
      if (idle < timeoutMs) return
      clearInterval(timer)
      onStall?.()
      reject(new StallError(`no progress for ${timeoutMs / 1000}s`))
    }, TICK_MS)
    const poke = () => {
      idle = 0
    }
    Promise.resolve()
      .then(() => task(poke))
      .then(
        value => {
          clearInterval(timer)
          resolve(value)
        },
        err => {
          clearInterval(timer)
          reject(err)
        },
      )
  })
}
