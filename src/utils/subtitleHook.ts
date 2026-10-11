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

/** How far the first shot has zoomed in by its end. */
export type PunchInZoom = 1.15 | 1.25 | 1.35
export const PUNCH_IN_ZOOMS: PunchInZoom[] = [1.15, 1.25, 1.35]
/**
 * 'in': starts at 1x and pushes in. 'out': the first frame is already
 * zoomed in, so the feed's first frame is a close-up, and it pulls back.
 */
export type ZoomDirection = 'in' | 'out'

export interface PunchIn {
  zoom: PunchInZoom
  direction: ZoomDirection
  /** Seconds into the first shot when the zoom starts. */
  at: number
}

export interface HookOptions {
  /** Hook style for the first shot's cues, the first one from 0 s. */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
  /** The first shot's zoom in; null = off. */
  punchIn: PunchIn | null
}

export type HookSettings = Pick<
  AppSettings,
  | 'hookStyleEnabled'
  | 'hookPosition'
  | 'punchInEnabled'
  | 'punchInZoom'
  | 'punchInDirection'
  | 'punchInAt'
>

export function hookOptionsOf(settings: HookSettings): HookOptions {
  return {
    style: settings.hookStyleEnabled,
    position: settings.hookPosition,
    punchIn: settings.punchInEnabled
      ? {
          zoom: settings.punchInZoom,
          direction: settings.punchInDirection,
          at: settings.punchInAt,
        }
      : null,
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

/** The zoom is about (50%, 40%) of the frame: roughly where the face is. */
export const ZOOM_ANCHOR_Y = 0.4

/**
 * How far the picture is zoomed at `t` seconds during the first shot (which
 * ends at `until`; from there on it is 1x).
 * - 'in': 1x until `at`, then a slow, steady push in that reaches `zoom` as
 *   the first shot ends, where the cut drops it back to 1x.
 * - 'out': `zoom` from the first frame until `at`, then a slow, steady pull
 *   back that reaches 1x as the first shot ends, so the cut changes nothing.
 */
export function punchInScale(
  t: number,
  punchIn: Pick<PunchIn, 'zoom' | 'at'> & { direction?: ZoomDirection },
  until: number,
): number {
  if (t >= until) return 1
  const out = punchIn.direction === 'out'
  if (t < punchIn.at) return out ? punchIn.zoom : 1
  const progress = (t - punchIn.at) / (until - punchIn.at)
  return out ? punchIn.zoom - (punchIn.zoom - 1) * progress : 1 + (punchIn.zoom - 1) * progress
}

/** Seconds past the first shot's end that frame-accurate time still matters, so the cut back to 1x lands. */
const FRAME_FOLLOW_TAIL = 0.1

/**
 * Whether the preview needs frame-accurate time at `t`: only while the
 * zoom in is on and the playhead is in (or just past) the first shot. Elsewhere
 * the normal timeupdate rate is enough, so per-frame re-renders are skipped.
 */
export function followsFrames(t: number, punchIn: PunchIn | null, firstShotDuration: number | null): boolean {
  return punchIn !== null && firstShotDuration !== null && t < firstShotDuration + FRAME_FOLLOW_TAIL
}

/** The punch-in a video gets and until when (the first shot's end). */
export interface PunchInPlan {
  punchIn: PunchIn
  until: number
}

/** Only a video starting with the first shot (`firstShotDuration` set) gets the punch-in. */
export function punchInPlan(hook: HookOptions, firstShotDuration: number | null): PunchInPlan | null {
  return hook.punchIn && firstShotDuration !== null ? { punchIn: hook.punchIn, until: firstShotDuration } : null
}

/** Whether a video starting with the first shot needs an encode even without subtitles. */
export function hasFirstShotExtras(hook: HookOptions, firstShotDuration: number | null): boolean {
  return punchInPlan(hook, firstShotDuration) !== null
}
