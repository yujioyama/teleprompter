import type { MusicGenre } from '../data/musicTracks'

/**
 * The BGM drops out just before the punchline (the last shot, as in
 * midZoom), so the last line lands in silence. No setting per video: the
 * stop point is read from the shot lengths.
 *
 * A quiet genre (warm piano, music box) isn't stopped: a sudden silence
 * after soft music sounds like the audio broke rather than a drop. It is
 * lowered under the punchline instead and fades out slowly at the end.
 */

/** Seconds the BGM takes to fade out at the end of a video. */
export const END_FADE_SECONDS = 1
/** Seconds a soft BGM takes to fade out at the end of a video. */
export const SOFT_END_FADE_SECONDS = 3
/** Seconds the BGM takes to drop out before the punchline: quick, but not a click. */
export const STOP_FADE_SECONDS = 0.5
/** Seconds of silence between the BGM being gone and the punchline's cut. */
export const STOP_GAP_SECONDS = 0.15
/** Seconds a soft BGM takes to come down to DUCK_LEVEL before the punchline. */
export const DUCK_FADE_SECONDS = 0.8
/** A soft BGM's level under the punchline, as a share of its usual level. */
export const DUCK_LEVEL = 0.35

const SOFT_GENRES: ReadonlySet<MusicGenre> = new Set<MusicGenre>(['warmpiano', 'musicbox'])

/** How the BGM ends on a video. */
export interface BgmEnding {
  /** Where the punchline starts; null when the BGM just plays to the end. */
  stopAt: number | null
  /** A quiet genre: lowered under the punchline rather than stopped, and faded out slowly. */
  soft: boolean
}

export const PLAYS_TO_END: BgmEnding = { stopAt: null, soft: false }

export function bgmEnding(genre: MusicGenre, stopAt: number | null): BgmEnding {
  return { stopAt, soft: SOFT_GENRES.has(genre) }
}

/** The BGM's level changes after its fade in, each multiplying the next. */
export interface BgmEnvelope {
  /** A soft BGM's ramp down to `level` before the punchline, then held; null when none. */
  duck: { start: number; length: number; level: number } | null
  /** The ramp down to silence, then held. */
  fadeOut: { start: number; length: number }
}

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
 * How the BGM ends on a video of `duration` seconds. With `stopAt` (the
 * punchline's start) it fades quickly and is gone a moment before that cut,
 * then stays silent; a soft one instead comes down to DUCK_LEVEL by then and
 * fades out slowly over the last seconds. Otherwise, or when the stop would
 * leave almost no music, it fades over the last second (seconds when soft).
 */
export function bgmEnvelope(duration: number, ending: BgmEnding = PLAYS_TO_END): BgmEnvelope {
  const endFade = ending.soft ? SOFT_END_FADE_SECONDS : END_FADE_SECONDS
  const usualStart = Math.max(0, duration - endFade)
  const usual: BgmEnvelope = { duck: null, fadeOut: { start: usualStart, length: endFade } }
  if (ending.stopAt === null) return usual
  const end = ending.stopAt - STOP_GAP_SECONDS
  if (ending.soft) {
    const start = end - DUCK_FADE_SECONDS
    // Past the fade in, and leaving at least the usual one second to fade out.
    if (start < END_FADE_SECONDS || duration - end < END_FADE_SECONDS) return usual
    const fadeStart = Math.max(usualStart, end)
    return {
      duck: { start, length: DUCK_FADE_SECONDS, level: DUCK_LEVEL },
      fadeOut: { start: fadeStart, length: duration - fadeStart },
    }
  }
  const start = end - STOP_FADE_SECONDS
  // Past the fade in, and before where the usual fade would begin.
  if (start >= END_FADE_SECONDS && start < usualStart) return { duck: null, fadeOut: { start, length: STOP_FADE_SECONDS } }
  return usual
}
