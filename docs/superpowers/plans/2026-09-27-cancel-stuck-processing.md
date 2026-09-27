# Cancelling a Stuck 結合 / 焼き込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 結合 and 焼き込み a 中断する button that always brings the finalize page back to its pre-run state (edits intact), stops the underlying encode, and frees the encode queue for a retry (issue #34).

**Architecture:** A tiny cancellation module (`CancelledError`, `raceAbort`, `onAbort`, `throwIfCancelled`) is threaded as an optional `AbortSignal` through every encode backend (WebCodecs via `conversion.cancel()` / `output.cancel()`, ffmpeg.wasm via `releaseFFmpeg()`). Every fallback `catch` rethrows a cancel instead of falling back. `ShotEncodeCache` gains `cancel()`, which races its running job against the abort so a never-settling encode can't block the queue. The UI races the whole job against the signal too, so it recovers even if a backend never notices.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest 2 + @testing-library/react 16 (jsdom), Mediabunny (WebCodecs), @ffmpeg/ffmpeg 0.12.

**Spec:** `docs/superpowers/specs/2026-09-27-cancel-stuck-processing-design.md`

## Global Constraints

- Work in this worktree (`.claude/worktrees/cancel-stuck-processing`, branch `fix/cancel-stuck-processing`). Never switch branches in the main checkout.
- Type-check with `npx tsc -b` (NOT `tsc --noEmit -p .`, which silently checks nothing in this repo).
- Run tests with `npx vitest run <path>`; full suite `npx vitest run`.
- UI copy (exact): button `中断する`; after cancelling `中断しました`; stall hint `処理が止まっているようです。中断してやり直してください`.
- Stall hint threshold: 30 s of *visible* page time without progress (hidden time doesn't count). It never cancels by itself.
- A cancel must never call `disableWebCodecs` and never fall back to another backend.
- Out of scope: persisting edits across app restarts, cancelling BGM mix / loudness normalization, forcing ffmpeg on retry.
- Comment style: match the surrounding code — short "why" comments, issue numbers in parentheses (e.g. `(issue #34)`).
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/cancellation.ts` (new) | `CancelledError`, `throwIfCancelled`, `onAbort`, `raceAbort` |
| `src/utils/webcodecs/normalizeShot.ts` | cancel the Mediabunny conversion on abort |
| `src/utils/webcodecs/burnSubtitlesWebCodecs.ts` | cancel the Mediabunny conversion on abort |
| `src/utils/webcodecs/concatClips.ts` | stop the packet copy on abort |
| `src/utils/trimAndNormalizeShot.ts` | thread signal; ffmpeg path terminates on abort; no fallback on cancel |
| `src/utils/concatVideos.ts` | thread signal; ffmpeg path terminates on abort; no fallback on cancel |
| `src/utils/burnSubtitles.ts` | thread signal; ffmpeg path terminates on abort; no fallback on cancel |
| `src/utils/shotEncodeCache.ts` | `EncodeJob` gets a signal; `cancel()`; `dispose()` aborts |
| `src/utils/shotEncoding.ts` | request builders pass signal; `encodeAll`/`burnSubtitlesByShot` take a signal |
| `src/hooks/useStallHint.ts` (new) | 30 s-without-progress detector |
| `src/components/CancelProcessing.tsx` + `.module.css` (new) | 中断する button + stall hint |
| `src/pages/FinalizePage.tsx` | cancel 結合; pass signal to the burn |
| `src/components/SubtitleWorkflow.tsx` + `.module.css` | cancel 焼き込み |

---

### Task 1: Cancellation primitive

**Files:**
- Create: `src/utils/cancellation.ts`
- Test: `src/utils/cancellation.test.ts`

**Interfaces:**
- Produces:
  - `class CancelledError extends Error` (message `'cancelled'`, name `'CancelledError'`)
  - `throwIfCancelled(signal?: AbortSignal): void`
  - `onAbort(signal: AbortSignal | undefined, stop: () => void): () => void` — returns an unregister function
  - `raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `src/utils/cancellation.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/cancellation.test.ts`
Expected: FAIL — `Failed to resolve import "./cancellation"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/cancellation.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/cancellation.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/cancellation.ts src/utils/cancellation.test.ts
git commit -m "feat: add a cancellation primitive for long-running encodes (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: WebCodecs backends stop on abort

**Files:**
- Modify: `src/utils/webcodecs/normalizeShot.ts` (function `normalizeShotWebCodecs`, lines ~43–110)
- Modify: `src/utils/webcodecs/burnSubtitlesWebCodecs.ts` (function `burnSubtitlesWebCodecs`)
- Modify: `src/utils/webcodecs/concatClips.ts` (function `concatClipsWebCodecs`, from line ~131)
- Test: `src/utils/webcodecs/normalizeShot.test.ts` (new), `src/utils/webcodecs/burnSubtitlesWebCodecs.test.ts` (new), `src/utils/webcodecs/concatClips.test.ts` (append)

**Interfaces:**
- Consumes: `throwIfCancelled`, `onAbort` from `src/utils/cancellation.ts` (Task 1).
- Produces (new trailing optional param on each):
  - `normalizeShotWebCodecs(blob: Blob, start: number, end: number, onProgress?: (ratio: number) => void, overlays: SubtitleOverlay[] = [], signal?: AbortSignal): Promise<Blob>`
  - `burnSubtitlesWebCodecs(videoBlob: Blob, overlays: SubtitleOverlay[], onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<Blob>`
  - `concatClipsWebCodecs(blobs: Blob[], signal?: AbortSignal): Promise<Blob>`

Real Mediabunny/WebCodecs work can't run in jsdom, so the unit tests only pin the "already cancelled → reject before doing anything" behaviour; the mid-encode cancel is verified on device.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/webcodecs/normalizeShot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeShotWebCodecs } from './normalizeShot'
import { CancelledError } from '../cancellation'

describe('normalizeShotWebCodecs', () => {
  it('rejects a cancelled encode before starting it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      normalizeShotWebCodecs(new Blob(['x']), 0, 1, undefined, [], controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
```

Create `src/utils/webcodecs/burnSubtitlesWebCodecs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { burnSubtitlesWebCodecs } from './burnSubtitlesWebCodecs'
import { CancelledError } from '../cancellation'

describe('burnSubtitlesWebCodecs', () => {
  it('rejects a cancelled burn before starting it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      burnSubtitlesWebCodecs(new Blob(['x']), [], undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
```

Append to `src/utils/webcodecs/concatClips.test.ts` (and add `concatClipsWebCodecs` to its import from `./concatClips`, plus `import { CancelledError } from '../cancellation'`):

```ts
describe('concatClipsWebCodecs', () => {
  it('rejects a cancelled join before reading any clip', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(concatClipsWebCodecs([new Blob(['x'])], controller.signal)).rejects.toBeInstanceOf(CancelledError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/webcodecs`
Expected: the three new tests FAIL (they reject with some other error or a TypeScript-irrelevant runtime error, not `CancelledError`).

- [ ] **Step 3: Implement `normalizeShotWebCodecs`**

In `src/utils/webcodecs/normalizeShot.ts`, add the import:

```ts
import { onAbort, throwIfCancelled } from '../cancellation'
```

Change the signature and add the early check as the first statement:

```ts
export async function normalizeShotWebCodecs(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  overlays: SubtitleOverlay[] = [],
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const audioDelay = await aacEncoderDelay()
```

Replace the block from `assertUsable(conversion)` through the end of the `guardAgainstStall(...)` call with:

```ts
    assertUsable(conversion)
    const cancel = () => void conversion.cancel().catch(() => undefined)
    // 中断する stops the encoder too, not just the wait for it (issue #34).
    const unregister = onAbort(signal, cancel)
    try {
      // If the encoder stops dead, give up so the caller can fall back to
      // ffmpeg instead of waiting forever (issue #31).
      await guardAgainstStall(
        poke => {
          conversion.onProgress = progress => {
            poke()
            onProgress?.(Math.min(Math.max(progress, 0), 1))
          }
          return conversion.execute()
        },
        { onStall: cancel },
      )
    } finally {
      unregister()
    }
```

Also add one sentence to the function's doc comment: `` `signal` cancels the conversion (中断する, issue #34). ``

- [ ] **Step 4: Implement `burnSubtitlesWebCodecs`**

In `src/utils/webcodecs/burnSubtitlesWebCodecs.ts`, add `import { onAbort, throwIfCancelled } from '../cancellation'`, then:

```ts
export async function burnSubtitlesWebCodecs(
  videoBlob: Blob,
  overlays: SubtitleOverlay[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const overlay = await createOverlayProcess(overlays)
```

Replace these two lines:

```ts
    if (onProgress) conversion.onProgress = progress => onProgress(Math.min(Math.max(progress, 0), 1))
    await conversion.execute()
```

with:

```ts
    if (onProgress) conversion.onProgress = progress => onProgress(Math.min(Math.max(progress, 0), 1))
    const unregister = onAbort(signal, () => void conversion.cancel().catch(() => undefined))
    try {
      await conversion.execute()
    } finally {
      unregister()
    }
```

- [ ] **Step 5: Implement `concatClipsWebCodecs`**

In `src/utils/webcodecs/concatClips.ts`, add `import { throwIfCancelled } from '../cancellation'`, then:

```ts
export async function concatClipsWebCodecs(blobs: Blob[], signal?: AbortSignal): Promise<Blob> {
  throwIfCancelled(signal)
  if (blobs.length === 0) throw new Error('concatClipsWebCodecs: no clips')
```

Inside the `for (let i = 0; i < blobs.length; i++)` loop, make the first statement:

```ts
      throwIfCancelled(signal)
```

and add `throwIfCancelled(signal)` as the first statement inside **both** `for await (const packet of new EncodedPacketSink(...).packets())` loops (video and audio). The existing outer `catch` already calls `output.cancel()` and rethrows, so a cancel propagates as `CancelledError`.

- [ ] **Step 6: Run tests and type-check**

Run: `npx vitest run src/utils/webcodecs && npx tsc -b`
Expected: all PASS; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/utils/webcodecs
git commit -m "feat: let WebCodecs encodes and joins be cancelled (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ffmpeg paths and fallbacks honour cancellation

**Files:**
- Modify: `src/utils/trimAndNormalizeShot.ts` (`trimAndNormalizeShot`, `unifyNormalizeBackends`, `trimAndNormalizeShotFFmpeg`)
- Modify: `src/utils/concatVideos.ts` (`concatVideos`, `concatVideosFFmpeg`)
- Modify: `src/utils/burnSubtitles.ts` (`burnSubtitles`, `burnShotSubtitles`, `burnSubtitlesFFmpeg`)
- Test: `src/utils/trimAndNormalizeShot.dispatch.test.ts` (append + mock tweak), `src/utils/concatVideos.dispatch.test.ts` (new), `src/utils/burnSubtitles.test.ts` (append)

**Interfaces:**
- Consumes: `throwIfCancelled`, `onAbort`, `CancelledError` (Task 1); the Task 2 signatures of `normalizeShotWebCodecs`, `burnSubtitlesWebCodecs`, `concatClipsWebCodecs`; `releaseFFmpeg()` from `src/utils/ffmpegClient.ts` (existing).
- Produces (new trailing optional param):
  - `trimAndNormalizeShot(blob, start, end, onProgress?, signal?: AbortSignal): Promise<Blob>`
  - `trimAndNormalizeShotFFmpeg(blob, start, end, onProgress?, signal?: AbortSignal): Promise<Blob>`
  - `unifyNormalizeBackends(clips, normalized, onProgress?, signal?: AbortSignal): Promise<Blob[]>`
  - `concatVideos(blobs: Blob[], signal?: AbortSignal): Promise<Blob>`
  - `burnSubtitles(videoBlob, cues, position, onProgress?, signal?: AbortSignal): Promise<Blob>`
  - `burnShotSubtitles(blob, start, end, cues, position, onProgress?, signal?: AbortSignal): Promise<Blob>`

Rule for every fallback `catch` below: call `throwIfCancelled(signal)` **first**, so a cancel rethrows as `CancelledError` instead of reaching `disableWebCodecs` / the fallback / the error-wrapping. On the ffmpeg paths, register `onAbort(signal, releaseFFmpeg)` for the duration of the work — terminating the worker is the only way to stop an `exec()` midway.

- [ ] **Step 1: Write the failing tests — trimAndNormalizeShot**

In `src/utils/trimAndNormalizeShot.dispatch.test.ts`:

1. Change the `./ffmpegClient` mock to also provide `releaseFFmpeg`:

```ts
vi.mock('./ffmpegClient', () => ({
  getFFmpeg: vi.fn(),
  releaseFFmpeg: vi.fn(),
}))
```

2. Update the imports:

```ts
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { execFFmpeg } from './execFFmpeg'
import { CancelledError } from './cancellation'
```

3. Append inside `describe('trimAndNormalizeShot backend selection', ...)`:

```ts
  it('neither falls back to ffmpeg nor disables WebCodecs when cancelled mid-encode (issue #34)', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeShotWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new Error('conversion canceled')
    })

    await expect(trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('passes the signal on to the hardware encode', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeShotWebCodecs).mockResolvedValue(new Blob(['wc'], { type: 'video/mp4' }))

    await trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)

    expect(vi.mocked(normalizeShotWebCodecs).mock.calls[0][5]).toBe(controller.signal)
  })

  it('terminates ffmpeg when cancelled during an ffmpeg encode', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    vi.mocked(execFFmpeg).mockImplementationOnce(async () => {
      controller.abort()
      throw 'called FFmpeg.terminate()'
    })

    await expect(trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)).rejects.toBeInstanceOf(CancelledError)

    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })
```

4. Append inside `describe('unifyNormalizeBackends', ...)`:

```ts
  it('does not fall back to ffmpeg when cancelled during the hardware re-encode (issue #34)', async () => {
    const normalized = [await webcodecsClip(), await ffmpegClip(), await webcodecsClip()]
    vi.clearAllMocks()
    const controller = new AbortController()
    vi.mocked(normalizeShotWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new Error('conversion canceled')
    })

    await expect(unifyNormalizeBackends(clips, normalized, undefined, controller.signal)).rejects.toBeInstanceOf(
      CancelledError,
    )
    expect(getFFmpeg).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Write the failing tests — concatVideos**

Create `src/utils/concatVideos.dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { concatVideos } from './concatVideos'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { execFFmpeg } from './execFFmpeg'
import { CancelledError } from './cancellation'

vi.mock('./webcodecs/concatClips', () => ({
  concatClipsWebCodecs: vi.fn(),
}))
vi.mock('./ffmpegClient', () => ({
  getFFmpeg: vi.fn(),
  releaseFFmpeg: vi.fn(),
}))
vi.mock('./execFFmpeg', () => ({
  execFFmpeg: vi.fn(async () => undefined),
}))

const fakeFFmpeg = {
  on: vi.fn(),
  off: vi.fn(),
  writeFile: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array(5000)),
  deleteFile: vi.fn(async () => true),
}

const clips = [new Blob(['a']), new Blob(['b'])]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
})

describe('concatVideos', () => {
  it('falls back to ffmpeg when the packet-copy join fails', async () => {
    vi.mocked(concatClipsWebCodecs).mockRejectedValue(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await concatVideos(clips)
    warn.mockRestore()

    expect(getFFmpeg).toHaveBeenCalled()
  })

  it('does not fall back to ffmpeg when cancelled during the packet-copy join (issue #34)', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new CancelledError()
    })

    await expect(concatVideos(clips, controller.signal)).rejects.toBeInstanceOf(CancelledError)
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('passes the signal on to the packet-copy join', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockResolvedValue(new Blob(['joined']))

    await concatVideos(clips, controller.signal)

    expect(concatClipsWebCodecs).toHaveBeenCalledWith(clips, controller.signal)
  })

  it('terminates ffmpeg when cancelled during the ffmpeg join', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockRejectedValue(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(execFFmpeg).mockImplementationOnce(async () => {
      controller.abort()
      throw 'called FFmpeg.terminate()'
    })

    await expect(concatVideos(clips, controller.signal)).rejects.toBeInstanceOf(CancelledError)
    warn.mockRestore()
    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Write the failing test — burnSubtitles**

Append to `src/utils/burnSubtitles.test.ts` (add `burnSubtitles` to the existing import from `./burnSubtitles`, and `import { CancelledError } from './cancellation'`):

```ts
describe('burnSubtitles', () => {
  it('rejects a cancelled burn before doing any work (issue #34)', async () => {
    const controller = new AbortController()
    controller.abort()
    const cues = [{ id: 'c0', start: 0, end: 1, en: 'Hi', ja: 'やあ' }]
    await expect(
      burnSubtitles(new Blob(['x']), cues, 50, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/utils/trimAndNormalizeShot.dispatch.test.ts src/utils/concatVideos.dispatch.test.ts src/utils/burnSubtitles.test.ts`
Expected: the new cancel tests FAIL (the current code falls back / calls `disableWebCodecs` / never calls `releaseFFmpeg`). The pre-existing tests and the plain "falls back to ffmpeg" concatVideos test PASS.

- [ ] **Step 5: Implement in `trimAndNormalizeShot.ts`**

Update imports:

```ts
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { onAbort, throwIfCancelled } from './cancellation'
```

`trimAndNormalizeShot`:

```ts
export async function trimAndNormalizeShot(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (await canUseWebCodecs()) {
    try {
      const out = await normalizeShotWebCodecs(blob, start, end, onProgress, [], signal)
      backends.set(out, 'webcodecs')
      return out
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
      onProgress?.(0)
    }
  }
  return trimAndNormalizeShotFFmpeg(blob, start, end, onProgress, signal)
}
```

`unifyNormalizeBackends` — add `signal?: AbortSignal` as the 4th parameter, and replace its tail with:

```ts
  try {
    return await reencode('webcodecs', (clip, p) =>
      normalizeShotWebCodecs(clip.blob, clip.start, clip.end, p, [], signal),
    )
  } catch (err) {
    throwIfCancelled(signal)
    console.warn('[unifyNormalizeBackends] hardware re-encode failed, re-encoding with ffmpeg instead:', err)
  }
  onProgress?.(0)
  return reencode('ffmpeg', (clip, p) => trimAndNormalizeShotFFmpeg(clip.blob, clip.start, clip.end, p, signal))
```

`trimAndNormalizeShotFFmpeg` — add `signal?: AbortSignal` as the 5th parameter; make `throwIfCancelled(signal)` its first statement; register the terminate hook right after `if (handleProgress) ff.on('progress', handleProgress)`:

```ts
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
```

At the top of its `catch (err)` block add `throwIfCancelled(signal)` (before the `const msg = ...` line), and at the top of its `finally` block add `unregister()`.

- [ ] **Step 6: Implement in `concatVideos.ts`**

```ts
import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { onAbort, throwIfCancelled } from './cancellation'
```

```ts
export async function concatVideos(blobs: Blob[], signal?: AbortSignal): Promise<Blob> {
  try {
    return await concatClipsWebCodecs(blobs, signal)
  } catch (err) {
    throwIfCancelled(signal)
    console.warn('[concatVideos] packet-copy concat failed, falling back to ffmpeg:', err)
  }
  return concatVideosFFmpeg(blobs, signal)
}

async function concatVideosFFmpeg(blobs: Blob[], signal?: AbortSignal): Promise<Blob> {
  throwIfCancelled(signal)
  const ff = await getFFmpeg()
```

After `ff.on('log', handleLog)` add:

```ts
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
```

At the top of its `catch (err)` add `throwIfCancelled(signal)`; at the top of its `finally` add `unregister()`.

- [ ] **Step 7: Implement in `burnSubtitles.ts`**

Imports:

```ts
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { onAbort, throwIfCancelled } from './cancellation'
```

`burnSubtitles` — add `signal?: AbortSignal` as the 5th parameter:

```ts
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const translated = cues.filter(c => c.ja !== null)
  if (translated.length === 0) {
    // Nothing to burn in — return the video unchanged.
    return videoBlob
  }
  const overlays = await renderSubtitleOverlays(translated, position)

  if (await canUseWebCodecs()) {
    try {
      return await burnSubtitlesWebCodecs(videoBlob, overlays, onProgress, signal)
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
      onProgress?.(0)
    }
  }
  return burnSubtitlesFFmpeg(
    videoBlob,
    translated,
    overlays.map(o => o.image),
    overlays.map(o => o.y),
    onProgress,
    signal,
  )
}
```

`burnShotSubtitles` — add `signal?: AbortSignal` as the 7th parameter and pass it on:

```ts
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (!(await canUseWebCodecs())) throw new Error('WebCodecs unavailable for per-shot burn-in')
  const overlays = await renderSubtitleOverlays(cues, position)
  return normalizeShotWebCodecs(blob, start, end, onProgress, overlays, signal)
}
```

`burnSubtitlesFFmpeg` — add `signal?: AbortSignal` as the 6th parameter, and wrap everything from `const ff = await getFFmpeg()` to the final `return` so the worker is terminated on abort:

```ts
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const duration = onProgress ? await containerDuration(videoBlob) : 0
  const ff = await getFFmpeg()
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
  try {
    // ... the existing body, unchanged, from `await ff.writeFile('in.mp4', ...)`
    //     through `return new Blob([data as Uint8Array], { type: 'video/mp4' })`
  } catch (err) {
    throwIfCancelled(signal)
    throw err
  } finally {
    unregister()
  }
}
```

(Move the existing statements into the `try` block verbatim — only the indentation changes.)

- [ ] **Step 8: Run tests and type-check**

Run: `npx vitest run src/utils && npx tsc -b`
Expected: all PASS; tsc exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/utils/trimAndNormalizeShot.ts src/utils/concatVideos.ts src/utils/burnSubtitles.ts \
  src/utils/trimAndNormalizeShot.dispatch.test.ts src/utils/concatVideos.dispatch.test.ts src/utils/burnSubtitles.test.ts
git commit -m "feat: stop ffmpeg on cancel and never treat a cancel as a failure (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ShotEncodeCache.cancel()` and signal plumbing in `shotEncoding`

**Files:**
- Modify: `src/utils/shotEncodeCache.ts`
- Modify: `src/utils/shotEncoding.ts`
- Test: `src/utils/shotEncodeCache.test.ts` (append), `src/utils/shotEncoding.test.ts` (append + update 3 assertions), `src/pages/FinalizePage.test.tsx` (update 1 assertion)

**Interfaces:**
- Consumes: `CancelledError`, `raceAbort`, `onAbort`, `throwIfCancelled` (Task 1); Task 3 signatures of `trimAndNormalizeShot`, `burnShotSubtitles`, `burnSubtitles`; Task 2 signature of `concatClipsWebCodecs`.
- Produces:
  - `type EncodeJob = (onProgress: (ratio: number) => void, signal: AbortSignal) => Promise<Blob>`
  - `ShotEncodeCache.cancel(): void`
  - `ShotEncodeCache.dispose()` now also aborts the running job
  - `encodeAll(cache, requests, onProgress?, signal?: AbortSignal): Promise<Blob[]>` — aborting `signal` calls `cache.cancel()`
  - `burnSubtitlesByShot(cache, clips, combinedBlob, cues, position, onProgress?, signal?: AbortSignal): Promise<Blob>`

- [ ] **Step 1: Write the failing tests — cache**

Append inside `describe('ShotEncodeCache', ...)` in `src/utils/shotEncodeCache.test.ts` (add `import { CancelledError } from './cancellation'`):

```ts
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
```

- [ ] **Step 2: Write the failing tests — shotEncoding**

In `src/utils/shotEncoding.test.ts`:

1. Add to imports: `import { encodeAll } from './shotEncoding'` (merge into the existing `./shotEncoding` import) and `import { CancelledError } from './cancellation'`.

2. Update these existing assertions (the functions now pass a trailing `signal`, `undefined` here):
   - `expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, 50, undefined)` → `expect(burnModule.burnSubtitles).toHaveBeenCalledWith(JOINED, cues, 50, undefined, undefined)` (three occurrences)
   - `expect(concatClipsWebCodecs).toHaveBeenCalledWith(burned)` → `expect(concatClipsWebCodecs).toHaveBeenCalledWith(burned, undefined)`

3. Append a new describe block:

```ts
describe('cancelling (issue #34)', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 1)]
  const cues = translate(cuesFromShotEntries([
    { text: 'first', duration: 2 },
    { text: 'second', duration: 1 },
  ]))

  it('encodeAll cancels the cache, so a hung encode stops blocking it', async () => {
    const cache = new ShotEncodeCache()
    const controller = new AbortController()
    const all = encodeAll(cache, [{ slot: 's1', key: 'k1', run: () => new Promise<Blob>(() => {}) }], undefined, controller.signal)

    controller.abort()

    await expect(all).rejects.toBeInstanceOf(CancelledError)
    await expect(cache.get({ slot: 's2', key: 'k2', run: async () => new Blob(['ok']) })).resolves.toBeInstanceOf(Blob)
  })

  it('encodeAll rejects at once for an already-cancelled signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async () => new Blob(['x']))

    await expect(encodeAll(new ShotEncodeCache(), [{ slot: 's', key: 'k', run }], undefined, controller.signal))
      .rejects.toBeInstanceOf(CancelledError)
    expect(run).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot neither disables WebCodecs nor burns the whole video when cancelled', async () => {
    const controller = new AbortController()
    vi.mocked(burnModule.burnShotSubtitles).mockImplementationOnce(() => {
      controller.abort()
      return new Promise<Blob>(() => {})
    })

    await expect(
      burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, undefined, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(burnModule.burnSubtitles).not.toHaveBeenCalled()
  })

  it('burnSubtitlesByShot passes the signal to each shot\'s burn', async () => {
    const controller = new AbortController()
    await burnSubtitlesByShot(new ShotEncodeCache(), clips, JOINED, cues, 50, undefined, controller.signal)

    const signals = vi.mocked(burnModule.burnShotSubtitles).mock.calls.map(c => c[6])
    expect(signals.every(s => s instanceof AbortSignal)).toBe(true)
  })
})
```

(The shots' burns receive the *cache's* signal, not the caller's; cancelling the caller's cancels the cache via `encodeAll`, hence `instanceof AbortSignal` rather than `toBe(controller.signal)`.)

4. In `src/pages/FinalizePage.test.tsx`, test `'burns subtitles shot by shot in the background, and 次へ just joins them'`, replace:

```ts
    expect(concatClipsWebCodecs).toHaveBeenCalledWith([burnedShot])
```

with:

```ts
    expect(vi.mocked(concatClipsWebCodecs).mock.calls[0][0]).toEqual([burnedShot])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/utils/shotEncodeCache.test.ts src/utils/shotEncoding.test.ts`
Expected: the new cancel tests FAIL (`cache.cancel is not a function`, hung promises never reject → test timeout after 5 s, etc.).

- [ ] **Step 4: Implement `ShotEncodeCache`**

In `src/utils/shotEncodeCache.ts`:

```ts
import { raceAbort, throwIfCancelled } from './cancellation'

export type EncodeJob = (onProgress: (ratio: number) => void, signal: AbortSignal) => Promise<Blob>
```

Add fields next to the existing private fields:

```ts
  // Aborted by cancel(); jobs queued under it are dropped when they come up.
  private controller = new AbortController()
  // Keys whose job hasn't settled yet, so cancel() can forget them.
  private unfinished = new Set<string>()
```

Add `cancel()` and update `dispose()`:

```ts
  /**
   * Stop the running encode and drop every queued one (中断する, issue #34).
   * The queue moves on at once even if the running encode never settles;
   * finished clips stay cached, and later requests run as usual.
   */
  cancel(): void {
    this.controller.abort()
    this.controller = new AbortController()
    for (const key of this.unfinished) this.results.delete(key)
    this.unfinished.clear()
  }

  /** Stop the running encode and never start the queued ones. */
  dispose(): void {
    this.disposed = true
    this.controller.abort()
    this.results.clear()
  }
```

In `lookup`, capture the signal before building the job and change the job body and bookkeeping:

```ts
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
      // Raced so a hung encode can't hold up the queue once cancelled.
      return raceAbort(run(ratio => this.onProgress?.(key, ratio), signal), signal)
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
```

(This replaces the existing `job.catch(() => { if (this.results.get(key) === job) this.results.delete(key) })`.)

Also update the class doc comment's last paragraph: drop "(an in-flight one can't be interrupted)" wording if present in `dispose`'s old comment (it was: `/** Stop starting queued encodes (an in-flight one can't be interrupted). */` — replaced above).

- [ ] **Step 5: Implement `shotEncoding.ts`**

Imports:

```ts
import { onAbort, throwIfCancelled } from './cancellation'
```

Request builders:

```ts
    run: (onProgress, signal) => trimAndNormalizeShot(clip.blob, clip.start, clip.end, onProgress, signal),
```

```ts
    run: (onProgress, signal) =>
      burnShotSubtitles(clip.blob, clip.start, clip.end, translated, position, onProgress, signal),
```

`encodeAll`:

```ts
export async function encodeAll(
  cache: ShotEncodeCache,
  requests: EncodeRequest[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob[]> {
  throwIfCancelled(signal)
  const ratios = new Map(requests.map(r => [r.key, 0]))
  // ... (unchanged: settled, report, cache.onProgress)
  // Cancelling stops the cache's running encode and drops the queued ones.
  const unregister = onAbort(signal, () => cache.cancel())
  try {
    return await Promise.all(/* unchanged */)
  } finally {
    settled = true
    cache.onProgress = null
    unregister()
  }
}
```

`burnSubtitlesByShot` — add `signal?: AbortSignal` as the 7th parameter:

```ts
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!cues.some(c => c.ja !== null)) return combinedBlob
  if (clips.length > 0 && (await canUseWebCodecs())) {
    let burned: Blob[] | null = null
    try {
      burned = await encodeAll(cache, shotBurnRequests(clips, cues, position), onProgress, signal)
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
    }
    if (burned) {
      try {
        return await concatClipsWebCodecs(burned, signal)
      } catch (err) {
        throwIfCancelled(signal)
        console.warn('[burnSubtitlesByShot] joining burned shots failed, burning the joined video instead:', err)
      }
    }
    onProgress?.(0)
  }
  return burnSubtitles(combinedBlob, cues, position, onProgress, signal)
}
```

- [ ] **Step 6: Run tests and type-check**

Run: `npx vitest run src/utils src/pages/FinalizePage.test.tsx && npx tsc -b`
Expected: all PASS; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/utils/shotEncodeCache.ts src/utils/shotEncodeCache.test.ts src/utils/shotEncoding.ts \
  src/utils/shotEncoding.test.ts src/pages/FinalizePage.test.tsx
git commit -m "feat: let the shot encode queue be cancelled past a hung encode (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stall hint hook and the 中断する control

**Files:**
- Create: `src/hooks/useStallHint.ts`, `src/hooks/useStallHint.test.ts`
- Create: `src/components/CancelProcessing.tsx`, `src/components/CancelProcessing.module.css`, `src/components/CancelProcessing.test.tsx`

**Interfaces:**
- Produces:
  - `STALL_HINT_MS = 30_000`
  - `useStallHint(signature: unknown): boolean` — true once `signature` has stayed the same for `STALL_HINT_MS` of visible time; resets whenever `signature` changes.
  - `<CancelProcessing progress={unknown} onCancel={() => void} />` — rendered only while a job runs; shows the stall hint (via `useStallHint(progress)`) and a `中断する` button.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useStallHint.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { STALL_HINT_MS, useStallHint } from './useStallHint'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

describe('useStallHint', () => {
  it('turns on after the signature stays the same for 30 s', () => {
    const { result } = renderHook(() => useStallHint(0.4))
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(true)
  })

  it('starts over whenever the signature changes', () => {
    const { result, rerender } = renderHook(({ progress }) => useStallHint(progress), {
      initialProps: { progress: 0.1 },
    })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    rerender({ progress: 0.2 })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1000))
    expect(result.current).toBe(false)
  })

  it('turns back off once progress resumes', () => {
    const { result, rerender } = renderHook(({ progress }) => useStallHint(progress), {
      initialProps: { progress: 0.1 },
    })
    act(() => vi.advanceTimersByTime(STALL_HINT_MS))
    expect(result.current).toBe(true)
    rerender({ progress: 0.2 })
    expect(result.current).toBe(false)
  })

  it('does not count time while the page is hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const { result } = renderHook(() => useStallHint(0.4))
    act(() => vi.advanceTimersByTime(STALL_HINT_MS * 2))
    expect(result.current).toBe(false)
  })
})
```

Create `src/components/CancelProcessing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import CancelProcessing from './CancelProcessing'
import { STALL_HINT_MS } from '../hooks/useStallHint'

const HINT = '処理が止まっているようです。中断してやり直してください'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CancelProcessing', () => {
  it('calls onCancel when 中断する is tapped', () => {
    const onCancel = vi.fn()
    render(<CancelProcessing progress={0} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('中断する'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('suggests cancelling only after progress has stopped for 30 s', () => {
    render(<CancelProcessing progress={0.3} onCancel={() => undefined} />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(STALL_HINT_MS))
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useStallHint.test.ts src/components/CancelProcessing.test.tsx`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useStallHint.ts`:

```ts
import { useEffect, useState } from 'react'

/** How long progress may stand still before 中断する is suggested (issue #34). */
export const STALL_HINT_MS = 30_000

const TICK_MS = 1000

/**
 * Whether `signature` (a job's progress, or anything that changes when it
 * moves on) has stayed the same for STALL_HINT_MS. Only time the page is
 * visible counts, like guardAgainstStall: a backgrounded page is suspended
 * with its codecs, and waking up from that is not a stall.
 */
export function useStallHint(signature: unknown): boolean {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    setStalled(false)
    let idle = 0
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      // A long gap between ticks means the page was asleep; count it as at
      // most a couple of ticks.
      if (!document.hidden) idle += Math.min(now - last, TICK_MS * 2)
      last = now
      if (idle < STALL_HINT_MS) return
      clearInterval(timer)
      setStalled(true)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [signature])

  return stalled
}
```

- [ ] **Step 4: Implement the component**

Create `src/components/CancelProcessing.module.css`:

```css
.wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
}

.cancelBtn {
  background: var(--surface2);
  color: var(--text);
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 0.9rem;
}
```

Create `src/components/CancelProcessing.tsx`:

```tsx
import { useStallHint } from '../hooks/useStallHint'
import styles from './CancelProcessing.module.css'

interface CancelProcessingProps {
  /** The running job's progress; the stall hint appears once it stops changing. */
  progress: unknown
  onCancel: () => void
}

/**
 * The way out of a 結合 or 焼き込み that has stopped making progress, short
 * of closing the app (issue #34). Rendered only while the job runs.
 */
export default function CancelProcessing({ progress, onCancel }: CancelProcessingProps) {
  const stalled = useStallHint(progress)
  return (
    <div className={styles.wrapper}>
      {stalled && <p className={styles.hint}>処理が止まっているようです。中断してやり直してください</p>}
      <button type="button" className={styles.cancelBtn} onClick={onCancel}>
        中断する
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run src/hooks/useStallHint.test.ts src/components/CancelProcessing.test.tsx && npx tsc -b`
Expected: PASS (6 tests); tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useStallHint.ts src/hooks/useStallHint.test.ts src/components/CancelProcessing.tsx \
  src/components/CancelProcessing.module.css src/components/CancelProcessing.test.tsx
git commit -m "feat: add a 中断する control that suggests itself when progress stops (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cancel 結合 in FinalizePage

**Files:**
- Modify: `src/pages/FinalizePage.tsx`
- Test: `src/pages/FinalizePage.test.tsx` (append)

**Interfaces:**
- Consumes: `raceAbort` (Task 1); `encodeAll(..., signal)` (Task 4); `unifyNormalizeBackends(..., signal)`, `concatVideos(blobs, signal)` (Task 3); `ShotEncodeCache.dispose()` aborting (Task 4); `<CancelProcessing progress onCancel />` (Task 5).
- Produces: `CombineState` gains `'cancelled'`.

- [ ] **Step 1: Write the failing tests**

In `src/pages/FinalizePage.test.tsx`, find the existing helper `loadShot` used by the issue #31 tests (it loads the single shot and reports its duration) and add these tests right after `'says it is finishing up while the shots are joined (issue #31)'`:

```tsx
  it('lets a stuck 結合 be cancelled and retried with the same trims (issue #34)', async () => {
    vi.mocked(trimAndNormalizeShot).mockImplementationOnce(() => new Promise<Blob>(() => {}))
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText(/^結合中\.\.\./)
    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.queryByText('中断する')).not.toBeInTheDocument()
    const combineBtn = screen.getByText('結合する')
    expect(combineBtn).not.toBeDisabled()

    fireEvent.click(combineBtn)
    await screen.findByText('次へ')
    const [first, retry] = vi.mocked(trimAndNormalizeShot).mock.calls
    expect(retry.slice(1, 3)).toEqual(first.slice(1, 3))
  })

  it('lets 結合 be cancelled while the shots are being joined (issue #34)', async () => {
    vi.mocked(concatVideos).mockReturnValueOnce(new Promise<Blob>(() => {}))
    renderFinalizePage('script-1')
    await loadShot()

    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('仕上げ中...')
    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(vi.mocked(concatVideos).mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(vi.mocked(concatVideos).mock.calls[0][1]?.aborted).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/FinalizePage.test.tsx -t "issue #34"`
Expected: FAIL — `Unable to find an element with the text: 中断する`.

- [ ] **Step 3: Implement**

In `src/pages/FinalizePage.tsx`:

1. Imports:

```ts
import { raceAbort } from '../utils/cancellation'
import CancelProcessing from '../components/CancelProcessing'
```

2. Types:

```ts
type CombineState = 'idle' | 'combining' | 'done' | 'error' | 'cancelled'
```

3. Next to `encodeCacheRef`, add:

```ts
  // Aborted by 中断する (issue #34) or when the page goes away mid-combine.
  const combineAbortRef = useRef<AbortController | null>(null)
```

4. In the existing unmount effect that disposes the cache, also abort a running combine:

```ts
  useEffect(() => {
    return () => {
      combineAbortRef.current?.abort()
      encodeCacheRef.current?.dispose()
      encodeCacheRef.current = null
    }
  }, [])
```

5. Replace `handleCombine` with:

```ts
  async function handleCombine() {
    const controller = new AbortController()
    combineAbortRef.current = controller
    const { signal } = controller
    // A cancelled run may still report in late; it must not touch the page.
    const whileLive = <T,>(update: (value: T) => void) => (value: T) => {
      if (!signal.aborted) update(value)
    }
    setCombineState('combining')
    setCombineError(null)
    setCombinePhase('encoding')
    setCombineProgress(0)
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixedBlob(null)
    // A re-combined video invalidates any subtitle cues tied to the old one.
    setSubtitleState(INITIAL_SUBTITLE_STATE)
    try {
      const clips = availableEntries.map(clipOf)
      // Raced so 中断する frees the page even if an encode never settles.
      const combined = await raceAbort(
        (async () => {
          const encoded = await encodeAll(
            getEncodeCache(),
            clips.map(normalizeRequest),
            whileLive(setCombineProgress),
            signal,
          )
          // If WebCodecs broke down partway (see trimAndNormalizeShot), some
          // clips came from the hardware encoder and some from ffmpeg; their
          // H.264 headers differ and can't be joined by packet copy, so some
          // have to be re-encoded onto the other's profile.
          const normalized = await unifyNormalizeBackends(
            clips,
            encoded,
            whileLive((ratio: number) => {
              setCombinePhase('unifying')
              setCombineProgress(ratio)
            }),
            signal,
          )
          whileLive(setCombinePhase)('joining')
          return concatVideos(normalized, signal)
        })(),
        signal,
      )
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
      // Same clips, same order, same trim values used just above to build
      // `normalized` — keeps subtitle timing aligned with the actual
      // combined output by construction, not by keeping two formulas in sync.
      setCombinedClips(clips)
      setShotCueInputs(
        availableEntries.map((entry, i) => ({ text: entry.text, duration: clips[i].end - clips[i].start }))
      )
      setCombineState('done')
    } catch (err) {
      if (signal.aborted) {
        setCombineState('cancelled')
        return
      }
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    } finally {
      if (combineAbortRef.current === controller) combineAbortRef.current = null
    }
  }
```

6. In the trim step JSX, directly after the 結合 `<button className={styles.finalizeBtn} onClick={handleCombine} ...>...</button>`, add:

```tsx
              {combineState === 'combining' && (
                <CancelProcessing
                  progress={`${combinePhase}:${combineProgress}`}
                  onCancel={() => combineAbortRef.current?.abort()}
                />
              )}

              {combineState === 'cancelled' && <p className={styles.missing}>中断しました</p>}
```

- [ ] **Step 4: Run tests and type-check**

Run: `npx vitest run src/pages/FinalizePage.test.tsx && npx tsc -b`
Expected: all PASS (including the pre-existing issue #31 tests); tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx
git commit -m "feat: let a stuck 結合 be cancelled without losing trims (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cancel 焼き込み in SubtitleWorkflow

**Files:**
- Modify: `src/components/SubtitleWorkflow.tsx`, `src/components/SubtitleWorkflow.module.css`
- Modify: `src/pages/FinalizePage.tsx` (the `burn` prop only)
- Test: `src/components/SubtitleWorkflow.test.tsx` (append), `src/pages/FinalizePage.test.tsx` (append)

**Interfaces:**
- Consumes: `raceAbort` (Task 1); `burnSubtitlesByShot(..., onProgress, signal)` (Task 4); `<CancelProcessing progress onCancel />` (Task 5).
- Produces: `SubtitleWorkflowProps.burn` becomes
  `(cues: SubtitleCue[], position: SubtitlePosition, onProgress: (ratio: number) => void, signal: AbortSignal) => Promise<Blob>`

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe('SubtitleWorkflow position controls', ...)` in `src/components/SubtitleWorkflow.test.tsx`:

```tsx
  it('lets a stuck burn-in be cancelled, keeping the cues and position (issue #34)', async () => {
    let seen: AbortSignal | undefined
    function StuckWorkflow() {
      const [state, setState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
      return (
        <SubtitleWorkflow
          combinedBlob={BLOB}
          shotCueInputs={SHOT_CUE_INPUTS}
          state={state}
          onStateChange={setState}
          burn={(_cues, _position, _onProgress, signal) => {
            seen = signal
            return new Promise(() => {})
          }}
        />
      )
    }
    render(<StuckWorkflow />)

    fireEvent.click(screen.getByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('Hello')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('上部'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText('焼き込み中... 0%')

    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.queryByText(/エラーが発生しました/)).not.toBeInTheDocument()
    expect(seen?.aborted).toBe(true)
    expect(screen.getByText('次へ')).not.toBeDisabled()
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()
    expect(screen.getByText('上部')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('中断する')).not.toBeInTheDocument()
  })
```

Append after `'blocks wizard step navigation while a burn-in is in flight'` in `src/pages/FinalizePage.test.tsx`:

```tsx
  it('unlocks navigation when a stuck burn-in is cancelled (issue #34)', async () => {
    vi.mocked(burnModule.burnSubtitles).mockReturnValue(new Promise(() => {}))
    renderFinalizePage('script-1')

    await screen.findByText('ショット1')
    const shotVideo = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(shotVideo, 'duration', { value: 5, configurable: true })
    fireEvent(shotVideo, new Event('loadedmetadata'))
    fireEvent.click(screen.getByText('結合する'))
    await screen.findByText('次へ')
    fireEvent.click(screen.getByText('次へ'))

    fireEvent.click(await screen.findByText('📝 英語字幕を生成'))
    await screen.findByDisplayValue('ショット1')
    fireEvent.change(screen.getByPlaceholderText('Claudeからの返信をここに貼り付け'), {
      target: { value: '1. こんにちは' },
    })
    fireEvent.click(screen.getByText('日本語を反映'))
    fireEvent.click(screen.getByText('次へ'))
    await screen.findByText(/^焼き込み中\.\.\./)
    expect(screen.getByText('‹ 戻る')).toBeDisabled()

    fireEvent.click(screen.getByText('中断する'))

    expect(await screen.findByText('中断しました')).toBeInTheDocument()
    expect(screen.getByText('‹ 戻る')).not.toBeDisabled()
    expect(screen.getByText('トリミング').closest('button')).not.toBeDisabled()
    expect(screen.getByDisplayValue('こんにちは')).toBeInTheDocument()
    const burnCall = vi.mocked(burnModule.burnSubtitles).mock.calls[0]
    expect(burnCall[4]).toBeInstanceOf(AbortSignal)
    expect(burnCall[4]?.aborted).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SubtitleWorkflow.test.tsx src/pages/FinalizePage.test.tsx -t "issue #34"`
Expected: the two new burn tests FAIL — `Unable to find an element with the text: 中断する`. (Task 6's tests still PASS.)

- [ ] **Step 3: Implement SubtitleWorkflow**

In `src/components/SubtitleWorkflow.tsx`:

1. Imports:

```ts
import { raceAbort } from '../utils/cancellation'
import CancelProcessing from './CancelProcessing'
```

2. The `burn` prop type:

```ts
  /** Burn `cues` into the combined video, reporting progress 0–1; `signal` aborts it. */
  burn: (
    cues: SubtitleCue[],
    position: SubtitlePosition,
    onProgress: (ratio: number) => void,
    signal: AbortSignal,
  ) => Promise<Blob>
```

3. Local state/refs next to `errorMessage`:

```ts
  const [notice, setNotice] = useState<string | null>(null)
  // Aborted by 中断する (issue #34) or if this unmounts mid-burn.
  const burnAbortRef = useRef<AbortController | null>(null)
```

and an unmount effect (next to the preview URL effect):

```ts
  useEffect(() => {
    return () => burnAbortRef.current?.abort()
  }, [])
```

4. Replace `handleBurnIn` with:

```ts
  async function handleBurnIn() {
    // A playing preview holds the phone's hardware decoder while the burn
    // needs it too; on iOS that could fail the hardware encode over to the
    // far slower ffmpeg.wasm path, leaving the button near 0% (issue #33).
    previewRef.current?.pause()
    const controller = new AbortController()
    burnAbortRef.current = controller
    const { signal } = controller
    patch({ stage: 'burning' })
    setErrorMessage(null)
    setNotice(null)
    setBurnProgress(0)
    try {
      // Raced so 中断する frees the page even if the burn never settles.
      const burned = await raceAbort(
        burn(cues, position, ratio => {
          if (!signal.aborted) setBurnProgress(ratio)
        }, signal),
        signal,
      )
      // Reset to 'reviewing' on success too: this state is lifted to the
      // parent and survives unmount, so without this the stage would stay
      // stuck on 'burning' (disabled button, "焼き込み中...") if the user
      // ever navigates back to this step after completing it.
      patch({ stage: 'reviewing' })
      onBurned?.(burned)
    } catch (err) {
      if (signal.aborted) setNotice('中断しました')
      else setErrorMessage(err instanceof Error ? err.message : String(err))
      // Back to 'reviewing' (not a separate error stage) so the cues,
      // position controls and next button remain visible and usable —
      // the user can adjust position or just retry burning in.
      patch({ stage: 'reviewing' })
    } finally {
      if (burnAbortRef.current === controller) burnAbortRef.current = null
    }
  }
```

5. JSX — directly under the existing `{errorMessage && (...)}` block add:

```tsx
      {notice && <p className={styles.notice}>{notice}</p>}
```

and directly after the 次へ / `焼き込み中...` `<button className={styles.genBtn} onClick={handleBurnIn} ...>` add:

```tsx
              {stage === 'burning' && (
                <CancelProcessing progress={burnProgress} onCancel={() => burnAbortRef.current?.abort()} />
              )}
```

6. `src/components/SubtitleWorkflow.module.css` — append:

```css
.notice {
  color: var(--text-muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 4: Pass the signal from FinalizePage**

In `src/pages/FinalizePage.tsx`, change the `burn` prop on `<SubtitleWorkflow>`:

```tsx
                burn={(cues, position, onProgress, signal) =>
                  burnSubtitlesByShot(getEncodeCache(), combinedClips, combinedBlob, cues, position, onProgress, signal)
                }
```

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run src/components src/pages && npx tsc -b`
Expected: all PASS (the existing SubtitleWorkflow tests pass unchanged — their `burn` wrappers ignore the extra argument); tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/SubtitleWorkflow.tsx src/components/SubtitleWorkflow.module.css \
  src/components/SubtitleWorkflow.test.tsx src/pages/FinalizePage.tsx src/pages/FinalizePage.test.tsx
git commit -m "feat: let a stuck 焼き込み be cancelled without losing subtitles (#34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

**Files:** none (verification only; fix-ups get their own commit if needed)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: every test file passes.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc -b && npm run lint && npm run build`
Expected: all exit 0. `git diff main --stat` should list only files named in this plan.

- [ ] **Step 3: Browser check of the UI**

Register a temporary launch entry for this worktree in the **main** repo's `.claude/launch.json` (preview_start reads that file), e.g.:

```json
{ "name": "cancel-stuck-processing", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "/Users/yujioyama/Site/teleprompter/.claude/worktrees/cancel-stuck-processing", "run", "dev", "--", "--port", "5183"], "port": 5183 }
```

Start it with `preview_start`, open a script with recorded shots → 仕上げる, press 結合する, and confirm the 中断する button appears under it while running and that tapping it returns to 結合する with 中断しました. Check the console for errors. Remove the temporary launch entry afterwards.

- [ ] **Step 4: Note device verification**

A real hang (WebCodecs encoder stopping, ffmpeg.wasm on iPhone) can't be reproduced in jsdom or the simulator. Record in the PR description that 中断する during a real 結合/焼き込み should be checked on an iPhone.
