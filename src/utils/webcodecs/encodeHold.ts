/**
 * Lets the on-screen preview hold back the encodes running ahead of time
 * (2026-11-06). They share the main thread and an iPhone's hardware codecs with
 * the <video>, so a preview playing over them drops frames until the picture
 * no longer matches the voice. A held encode only waits on its next frame, so
 * it picks up where it was and nothing already encoded is lost.
 */

let holds = 0
const waiting = new Set<() => void>()

/** Hold the encodes back; call what it returns to let them go. */
export function holdEncodes(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    if (holds === 0) [...waiting].forEach(resume => resume())
  }
}

export function encodesHeld(): boolean {
  return holds > 0
}

function nextRelease(signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const resume = () => {
      waiting.delete(resume)
      signal?.removeEventListener('abort', resume)
      resolve()
    }
    waiting.add(resume)
    signal?.addEventListener('abort', resume)
  })
}

/**
 * `process`, waiting first while the encodes are held. Without a hold it runs
 * as it would have, not a promise later. `signal` lets a cancelled encode go,
 * since cancelling one waits for the frame it's on.
 */
export function whenNotHeld<A, R>(process: (arg: A) => R, signal?: AbortSignal): (arg: A) => R | Promise<R> {
  return arg => {
    if (!encodesHeld() || signal?.aborted) return process(arg)
    return (async () => {
      // Held again before this frame got to run, when the preview plays on.
      while (encodesHeld() && !signal?.aborted) await nextRelease(signal)
      return process(arg)
    })()
  }
}
