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

/** How far the first shot snaps in. */
export type PunchInZoom = 1.15 | 1.25 | 1.35
export const PUNCH_IN_ZOOMS: PunchInZoom[] = [1.15, 1.25, 1.35]
export type ImpactStrength = 'weak' | 'medium' | 'strong'

export interface PunchIn {
  zoom: PunchInZoom
  /** Seconds into the first shot when the snap starts. */
  at: number
  /** The impact effect riding on the snap; null = off. */
  impact: ImpactStrength | null
}

export interface HookOptions {
  /** Hook style for the first shot's cues, the first one from 0 s. */
  style: boolean
  /** 0-100, where hook cues are centered. */
  position: SubtitlePosition
  /** The first shot's snap zoom; null = off. */
  punchIn: PunchIn | null
}

export type HookSettings = Pick<
  AppSettings,
  'hookStyleEnabled' | 'hookPosition' | 'punchInEnabled' | 'punchInZoom' | 'punchInAt' | 'impactEnabled' | 'impactStrength'
>

export function hookOptionsOf(settings: HookSettings): HookOptions {
  return {
    style: settings.hookStyleEnabled,
    position: settings.hookPosition,
    punchIn: settings.punchInEnabled
      ? {
          zoom: settings.punchInZoom,
          at: settings.punchInAt,
          impact: settings.impactEnabled ? settings.impactStrength : null,
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

/** Seconds the snap takes to land. */
export const SNAP_DURATION = 0.12
/** The zoom is about (50%, 40%) of the frame: roughly where the face is. */
export const ZOOM_ANCHOR_Y = 0.4

// Fast, then settling smoothly: reads as a camera move, not a ramp.
const easeOutQuint = (p: number) => 1 - (1 - p) ** 5

/**
 * How far the picture is zoomed at `t` seconds: 1x until `at`, then a
 * SNAP_DURATION ease-out to `zoom`, held until `until` (the end of the
 * first shot), where the cut drops it back to 1x.
 */
export function snapZoomScale(t: number, punchIn: Pick<PunchIn, 'zoom' | 'at'>, until: number): number {
  if (t < punchIn.at || t >= until) return 1
  const p = Math.min((t - punchIn.at) / SNAP_DURATION, 1)
  return 1 + (punchIn.zoom - 1) * easeOutQuint(p)
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
