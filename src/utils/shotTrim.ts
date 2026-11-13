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
/**
 * In a conversation (a script with 相手のセリフ), the least silence kept on
 * each side of a line, so a reply comes after a breath rather than cutting
 * in: about 0.6s between two lines.
 */
export const CONVERSATION_PADDING = 0.3
/** The finale fairy needs the last shot to last this long (see finaleTiming). */
export const LAST_SHOT_MIN_LENGTH = 1.2

/**
 * A shot's own auto-trim override, falling back to the global settings.
 * The first shot opens the video, where viewers decide within a second
 * whether to stay, so it has a lead-in of its own (almost none). The last
 * shot ends right after the speech so the video loops straight back.
 * In a `conversation` (see isConversation) the lines in between keep at
 * least CONVERSATION_PADDING on each side; a shot's own override still wins.
 */
export function resolveShotTrimSettings(
  shot: Shot | undefined,
  global: AppSettings,
  isFirstShot = false,
  isLastShot = false,
  conversation = false,
): ShotTrimSettings {
  const between = (padding: number) => (conversation ? Math.max(padding, CONVERSATION_PADDING) : padding)
  return {
    trimEnabled: shot?.trimEnabled ?? global.trimEnabled,
    trimPaddingStart: shot?.trimPaddingStart ?? (isFirstShot ? global.firstShotPaddingStart : between(global.trimPaddingStart)),
    trimPaddingEnd: shot?.keepPause
      ? Math.max(PAUSE_PADDING_END, between(0))
      : (shot?.trimPaddingEnd ?? (isLastShot ? global.lastShotPaddingEnd : between(global.trimPaddingEnd))),
    minLength: isLastShot ? LAST_SHOT_MIN_LENGTH : 0,
  }
}

/** A script re-enacting a conversation: filmed line by line, with some lines the other person's. */
export function isConversation(script: { oneTake?: boolean; shots: Shot[] } | null | undefined): boolean {
  return Boolean(script && !script.oneTake && script.shots.some(shot => shot.heard))
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
