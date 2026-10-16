import type { Shot } from '../types'
import type { AppSettings } from '../hooks/useSettings'
import { speechBoundsFor, type SpeechBounds, type SpeechRegion } from './detectSpeechBounds'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  /** Seconds the auto-trimmed shot lasts at least (0 = no minimum). */
  minLength: number
}

/** The silence kept after a shot marked 間を残す, e.g. before a punchline. */
export const PAUSE_PADDING_END = 0.4
/** The finale fairy needs the last shot to last this long (see finaleTiming). */
export const LAST_SHOT_MIN_LENGTH = 1.2

/**
 * A shot's own auto-trim override, falling back to the global settings.
 * The first shot opens the video, where viewers decide within a second
 * whether to stay, so it has a lead-in of its own (almost none). The last
 * shot ends right after the speech so the video loops straight back.
 */
export function resolveShotTrimSettings(
  shot: Shot | undefined,
  global: AppSettings,
  isFirstShot = false,
  isLastShot = false,
): ShotTrimSettings {
  return {
    trimEnabled: shot?.trimEnabled ?? global.trimEnabled,
    trimPaddingStart: shot?.trimPaddingStart ?? (isFirstShot ? global.firstShotPaddingStart : global.trimPaddingStart),
    trimPaddingEnd: shot?.keepPause
      ? PAUSE_PADDING_END
      : (shot?.trimPaddingEnd ?? (isLastShot ? global.lastShotPaddingEnd : global.trimPaddingEnd)),
    minLength: isLastShot ? LAST_SHOT_MIN_LENGTH : 0,
  }
}

/**
 * The detected cut for `trim`, lengthened to its minimum, but never into
 * the sound after the speech (the stop tap). Null: keep the whole shot.
 */
export function autoTrimOf(region: SpeechRegion, trim: ShotTrimSettings): SpeechBounds | null {
  const bounds = speechBoundsFor(region, trim.trimPaddingStart, trim.trimPaddingEnd)
  if (!bounds) return null
  const end = Math.max(bounds.end, Math.min(bounds.start + trim.minLength, region.ceiling))
  return { start: bounds.start, end }
}

/**
 * Clamp a [start, end] trim range to a clip of the given duration, enforcing
 * a minimum clip length. Used by the trim-handle UI so a drag can never
 * produce an invalid or zero-length range.
 */
export function clampTrimRange(
  start: number,
  end: number,
  duration: number,
  minLength = 0.3,
): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, duration))
  let e = Math.max(0, Math.min(end, duration))

  if (e - s < minLength) {
    e = s + minLength
    if (e > duration) {
      e = duration
      s = Math.max(0, e - minLength)
    }
  }

  return { start: s, end: e }
}
