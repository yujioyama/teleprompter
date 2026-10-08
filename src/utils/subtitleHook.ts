import type { AppSettings } from '../hooks/useSettings'
import type { SubtitleCue } from './subtitleCues'
import { SUBTITLE_BLOCK_GAP, type CueVariant } from './subtitleLayout'
import { clampedSubtitleY, type SubtitlePosition } from './subtitlePosition'

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
  /** Shown above the hook subtitle during the first shot; '' = none. */
  headline: string
  /** Zoom the first shot's picture in (see punchInScale). */
  punchIn: boolean
}

export type HookSettings = Pick<
  AppSettings,
  'hookStyleEnabled' | 'hookPosition' | 'hookHeadlineEnabled' | 'punchInEnabled'
>

/** The hook as burned: settings plus this video's headline text. */
export function hookOptionsOf(settings: HookSettings, headline = ''): HookOptions {
  return {
    style: settings.hookStyleEnabled,
    position: settings.hookPosition,
    headline: settings.hookHeadlineEnabled ? headline.trim() : '',
    punchIn: settings.punchInEnabled,
  }
}

// A cue starting where the second shot does is not in the first one.
const EPSILON = 1e-6

export function startsInFirstShot(start: number, firstShotDuration: number): boolean {
  return start < firstShotDuration - EPSILON
}

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
    hookStyle && firstShotDuration !== null && startsInFirstShot(c.start, firstShotDuration)
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

export const PUNCH_IN_ZOOM = 0.08

/**
 * How far the first shot's picture is zoomed at `t` seconds into it: a slow
 * push from 1x to 1 + PUNCH_IN_ZOOM over its `duration`, and 1x after it.
 */
export function punchInScale(t: number, duration: number): number {
  if (!(duration > 0) || t >= duration) return 1
  return 1 + (PUNCH_IN_ZOOM * Math.max(t, 0)) / duration
}

/**
 * Until when a video is zoomed in, or null: only a video starting with the
 * first shot (`firstShotDuration` set) gets the punch-in.
 */
export function punchInUntil(hook: HookOptions, firstShotDuration: number | null): number | null {
  return hook.punchIn ? firstShotDuration : null
}

/** Whether a video starting with the first shot needs an encode even without subtitles. */
export function hasFirstShotExtras(hook: HookOptions, firstShotDuration: number | null): boolean {
  return firstShotDuration !== null && (hook.headline !== '' || hook.punchIn)
}

/** Space between the headline and the subtitle box under it, in output px. */
export const HEADLINE_GAP = SUBTITLE_BLOCK_GAP * 2

/**
 * Top of the headline: just above the topmost of the first shot's subtitle
 * boxes (`boxTops`), so it stays put while they change, or centered at the
 * hook position when there is none. Never above the frame.
 */
export function headlineY(boxTops: number[], headlineHeight: number, hookPosition: SubtitlePosition): number {
  const y = boxTops.length > 0
    ? Math.min(...boxTops) - HEADLINE_GAP - headlineHeight
    : clampedSubtitleY(hookPosition, headlineHeight)
  return Math.max(0, y)
}
