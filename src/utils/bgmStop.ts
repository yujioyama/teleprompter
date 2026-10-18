/**
 * The BGM drops out just before the punchline (the last shot, as in
 * midZoom), so the last line lands in silence. No setting per video: the
 * stop point is read from the shot lengths.
 */

/** Seconds the BGM takes to fade out at the end of a video. */
export const END_FADE_SECONDS = 1
/** Seconds the BGM takes to drop out before the punchline: quick, but not a click. */
export const STOP_FADE_SECONDS = 0.5
/** Seconds of silence between the BGM being gone and the punchline's cut. */
export const STOP_GAP_SECONDS = 0.15

/**
 * Where the punchline starts on the joined video's timeline (the sum of
 * every shot but the last), or null when there's no BGM stop: switched off,
 * or a single shot, which would have no music at all.
 */
export function punchlineStart(durations: number[], enabled: boolean): number | null {
  if (!enabled || durations.length < 2) return null
  return durations.slice(0, -1).reduce((sum, d) => sum + d, 0)
}

/**
 * When the BGM's fade-out starts and how long it takes, on a video of
 * `duration` seconds. With `stopAt` (the punchline's start) it fades
 * quickly and is gone a moment before that cut, then stays silent;
 * otherwise, or when the stop would leave almost no music, it fades over
 * the last second as before.
 */
export function bgmFadeOut(duration: number, stopAt: number | null = null): { start: number; length: number } {
  const usualStart = Math.max(0, duration - END_FADE_SECONDS)
  if (stopAt !== null) {
    const start = stopAt - STOP_GAP_SECONDS - STOP_FADE_SECONDS
    // Past the fade in, and before where the usual fade would begin.
    if (start >= END_FADE_SECONDS && start < usualStart) return { start, length: STOP_FADE_SECONDS }
  }
  return { start: usualStart, length: END_FADE_SECONDS }
}
