import type { AppSettings } from '../hooks/useSettings'
import type { SubtitleCue } from './subtitleCues'
import type { CueVariant } from './subtitleLayout'
import type { SubtitlePosition } from './subtitlePosition'

/**
 * Most viewers decide within the first second or two whether to keep
 * watching, so the first shot gets a "hook" treatment. Which cues get it is
 * decided here, once, on the joined video's timeline, and the preview and
 * both burn paths (per shot, whole video) all go through it so they agree.
 */

export type StyledCue = SubtitleCue & { variant: CueVariant }

export interface HookOptions {
  /** Hook style for the first shot's cues, the first one from 0 s. */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
}

export type HookSettings = Pick<AppSettings, 'hookStyleEnabled' | 'hookPosition'>

export function hookOptionsOf(settings: HookSettings): HookOptions {
  return { style: settings.hookStyleEnabled, position: settings.hookPosition }
}

// A cue starting where the second shot does is not in the first one.
const EPSILON = 1e-6

/**
 * Mark the cues that start within the first shot (`firstShotDuration`
 * seconds, on the joined timeline) as hook cues, including one that runs on
 * into the next shot, so it doesn't change style midway once cut per shot.
 * The earliest hook cue is moved to start at 0: cues transcribed from the
 * audio begin when the talking does, and the feed's first frame (and the
 * cover) should already show the text.
 */
export function styleCues(
  cues: SubtitleCue[],
  firstShotDuration: number | null,
  hookStyle: boolean,
): StyledCue[] {
  const isHook = (c: SubtitleCue) =>
    hookStyle && firstShotDuration !== null && c.start < firstShotDuration - EPSILON
  // The earliest is picked among all cues, untranslated ones included; fine,
  // because every burn waits for all cues to be translated.
  let earliest = -1
  cues.forEach((c, i) => {
    if (isHook(c) && (earliest < 0 || c.start < cues[earliest].start)) earliest = i
  })
  return cues.map((c, i) => ({
    ...c,
    start: i === earliest ? 0 : c.start,
    variant: isHook(c) ? 'hook' : 'normal',
  }))
}
