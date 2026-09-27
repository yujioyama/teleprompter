import type { Shot } from '../types'
import type { AppSettings } from '../hooks/useSettings'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
}

/** A shot's own auto-trim override, falling back to the global settings. */
export function resolveShotTrimSettings(shot: Shot | undefined, global: AppSettings): ShotTrimSettings {
  return {
    trimEnabled: shot?.trimEnabled ?? global.trimEnabled,
    trimPaddingStart: shot?.trimPaddingStart ?? global.trimPaddingStart,
    trimPaddingEnd: shot?.trimPaddingEnd ?? global.trimPaddingEnd,
  }
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
