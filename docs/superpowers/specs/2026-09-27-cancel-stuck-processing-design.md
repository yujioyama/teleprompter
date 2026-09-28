# Cancelling a Stuck 結合 / 焼き込み

**Date:** 2026-09-27
**Status:** Approved (brainstorming)
**Issue:** #34 — 結合や焼き込み中でフリーズした際にアプリを閉じるしか再開する方法がない

## Problem

When 結合 (combine) or 焼き込み (subtitle burn-in) stops making progress, the
only way out is to kill the app. The page itself stays responsive (the user
could still edit subtitles during a stuck burn), but:

1. **The UI locks itself in.** During a burn, 次へ, the wizard indicator and
   ‹ 戻る are all disabled (`subtitleProcessing`) until the burn settles —
   which a hung encode never does. During 結合 the button is disabled the
   same way.
2. **A hung encode blocks every later one.** `ShotEncodeCache` runs encodes
   strictly one at a time by chaining each onto the previous one. A job
   that never settles leaves the chain waiting forever, so merely unlocking
   the UI would not help: the retry would queue behind the hung job.
3. **Killing the app loses work.** Trim edits, generated/edited subtitles,
   the pasted Japanese translation and the subtitle position live only in
   memory.

Only one stage has an automatic way out today: the WebCodecs per-shot
normalize encode is wrapped in `guardAgainstStall` (issue #31). The
ffmpeg.wasm fallbacks, the whole-video burn and the join have none.

## Goal

A user-facing **中断する** button during 結合 and 焼き込み that always
returns the page to its pre-run state (edits intact) immediately, actually
stops the underlying work as far as possible, and leaves the encode queue
usable for a retry. A hint suggests cancelling when progress has stopped.

## Non-goals

- Persisting trims/subtitles across an app restart (separate issue if still
  wanted once cancelling exists).
- Cancelling BGM mixing (`MusicMixer`) or export-step loudness
  normalization — not reported as freezing; can follow the same pattern
  later.
- Forcing ffmpeg.wasm on a retry after a cancel. On iPhone ffmpeg.wasm is
  the slow path that looks stuck near 0% (#33); a retry simply starts over
  with a fresh encoder. A genuine WebCodecs breakdown already falls back to
  ffmpeg via the existing stall guard.
- Automatic stall timeouts for the stages that lack them (could be added
  later on top of the same cancellation plumbing).

## Design

### 1. Cancellation primitive

A small module (e.g. `src/utils/cancellation.ts`) provides:

- `CancelledError extends Error` — the one error type meaning "the user
  cancelled"; never shown as a failure.
- `isCancelled(err)` — true for `CancelledError` (and a DOM `AbortError`
  raised by an aborted signal, normalized to `CancelledError`).
- `raceAbort<T>(promise, signal): Promise<T>` — settles with `promise`, or
  rejects with `CancelledError` the moment `signal` aborts (immediately if
  already aborted). This is what guarantees the UI recovers even if the
  underlying work never settles.
- `throwIfCancelled(signal)` — for checks between steps.

`handleCombine` and the burn each create an `AbortController`; 中断する
calls `abort()`.

### 2. Stopping the underlying work (best effort)

Each backend accepts an optional `signal` and stops itself on abort:

| Work | On abort |
| --- | --- |
| `normalizeShotWebCodecs` (normalize + per-shot burn) | `conversion.cancel()` |
| `burnSubtitlesWebCodecs` (whole-video burn fallback) | `conversion.cancel()` |
| `concatClipsWebCodecs` (join) | stop between packets, `output.cancel()` |
| any ffmpeg.wasm path (`trimAndNormalizeShotFFmpeg`, `concatVideosFFmpeg`, `burnSubtitlesFFmpeg`) | `releaseFFmpeg()` — terminates the worker and frees its heap; the next `getFFmpeg()` starts fresh |

Each of these also wraps its own await in `raceAbort`, so it rejects with
`CancelledError` promptly whatever the backend does.

### 3. `ShotEncodeCache`

- `EncodeJob` becomes `(onProgress, signal) => Promise<Blob>`; the request
  builders in `shotEncoding.ts` pass `signal` through.
- The cache owns one `AbortController` per run. The chain link for a job is
  `raceAbort(run(...), signal)`, so aborting releases the chain at once
  even if `run` never settles.
- New `cancel()`:
  - aborts the running job;
  - drops every queued-but-not-started job (they reject with
    `CancelledError` when they reach the head of the queue instead of
    running), and removes their entries from `results`/`demanded`;
  - keeps completed results — a retry reuses every shot already encoded.
- Jobs requested after `cancel()` run normally.
- Cancelled jobs are not cached (same as failures today).

`encodeAll` needs no change beyond passing through; its `settled` guard
already stops late progress reports.

### 4. Fallbacks must not treat a cancel as a failure

Several catches today fall back to another backend and/or disable WebCodecs
for the session:

- `trimAndNormalizeShot` (WebCodecs → ffmpeg, `disableWebCodecs`)
- `unifyNormalizeBackends` (WebCodecs retry → ffmpeg)
- `concatVideos` (packet copy → ffmpeg)
- `burnSubtitlesByShot` (per-shot → whole-video burn, `disableWebCodecs`)

Each rethrows when `isCancelled(err)` (or the signal is aborted) instead of
falling back, and never calls `disableWebCodecs` for a cancel.

### 5. FinalizePage — 結合

- `handleCombine` creates the controller (kept in a ref) and threads the
  signal through `encodeAll` → `unifyNormalizeBackends` → `concatVideos`.
- 中断する (secondary style, below the 結合 button, only while
  `combineState === 'combining'`) calls `controller.abort()` and
  `getEncodeCache().cancel()`.
- On `CancelledError`: `combineState` returns to `'idle'`, a note
  「中断しました」 is shown, trims are untouched. Any other error keeps
  today's error handling.
- Background prefetch resumes normally afterwards (its effect already
  re-runs when `combineState` leaves `'combining'`).

### 6. SubtitleWorkflow — 焼き込み

- The `burn` prop gains a `signal` argument; FinalizePage passes it to
  `burnSubtitlesByShot`, which threads it through `encodeAll`,
  `concatClipsWebCodecs` and the `burnSubtitles` fallback.
- SubtitleWorkflow creates the controller in `handleBurnIn`. 中断する is
  shown below 次へ while `stage === 'burning'`; it aborts the controller.
  FinalizePage's `burn` implementation also calls
  `getEncodeCache().cancel()` when the signal aborts.
- On `CancelledError`: `stage` returns to `'reviewing'` with cues,
  translation and position intact, and 「中断しました」 is shown instead of
  「エラーが発生しました」.
- ‹ 戻る and the wizard indicator stay disabled during the burn (unchanged);
  cancelling is the one way out, and it unlocks them.
- If SubtitleWorkflow unmounts mid-burn, the controller is aborted.

### 7. Stall hint

A hook `useStallHint(active: boolean, progress: number, phase?: string)`
returns `true` once `progress` (or `phase`) hasn't changed for 30 s of
**visible** page time while `active` — same visibility rule as
`guardAgainstStall`, so a backgrounded page waking up isn't a stall. The
start of each phase (including 結合's join phase, which has no percentage)
counts as a change.

When it returns true, 「処理が止まっているようです。中断してやり直してください」
appears next to 中断する. It never cancels anything by itself.

## Testing

- `cancellation`: `raceAbort` resolves normally, rejects on abort, rejects
  immediately for an already-aborted signal.
- `ShotEncodeCache.cancel()`: a never-settling job no longer blocks the
  next `get()`; completed results survive; queued jobs are dropped and
  never run; the running job's signal is aborted.
- Fallbacks: a cancel from the first backend does not reach the fallback
  and does not call `disableWebCodecs` (`trimAndNormalizeShot`,
  `concatVideos`, `burnSubtitlesByShot`, `unifyNormalizeBackends`).
- FinalizePage: 中断する shows during 結合; cancelling returns to the idle
  button with 「中断しました」 and trims kept.
- SubtitleWorkflow: 中断する shows during burning; cancelling returns to
  reviewing with cues kept and back navigation re-enabled.
- `useStallHint` (fake timers): appears after 30 s without progress, resets
  on progress/phase change, doesn't count hidden time.

Stopping the real WebCodecs/ffmpeg work can't be exercised in jsdom; verify
on device (see issue #12 notes — the simulator doesn't reproduce these).
