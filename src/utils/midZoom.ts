import { shotTextsOf } from './subtitleCues'
import { easeZoom, type HookOptions } from './subtitleHook'
import { findSticker } from './subtitleSticker'

/**
 * After the first shot the picture only moves at the key lines, picked
 * from the script with no setting per video: a peak (a middle line with an
 * emoji, the same lines the fairies fly through) drifts in over its shot,
 * and the punchline (the last shot) is zoomed in from its cut, so it reads
 * as an edit, not as the camera being at the wrong distance.
 */

/** How far a peak has drifted in by the end of its shot. */
export const PEAK_ZOOM = 1.12
/** The punchline's zoom, from its cut to the end. */
export const PUNCHLINE_ZOOM = 1.18

/** Seconds, on the video's timeline (or a shot's own, after midZoomForShot). */
export interface MidZoomSegment {
  start: number
  end: number
  kind: 'drift' | 'punch'
}

/**
 * The segments of a joined video whose shots last `durations`, read from
 * its English subtitles (`cues`, joined timeline): the middle shots whose
 * text has an emoji drift in, and the last shot punches in.
 */
export function planMidZoom(
  cues: { start: number; en: string }[],
  durations: number[],
  hook: Pick<HookOptions, 'midZoom'>,
): MidZoomSegment[] {
  if (hook.midZoom === false || durations.length < 2) return []
  const texts = shotTextsOf(cues, durations)
  const plan: MidZoomSegment[] = []
  let start = 0
  durations.forEach((duration, i) => {
    const end = start + duration
    if (i === durations.length - 1) plan.push({ start, end, kind: 'punch' })
    else if (i > 0 && findSticker(texts[i])) plan.push({ start, end, kind: 'drift' })
    start = end
  })
  return plan
}

/** The segments inside one shot, moved into the shot's own timeline. */
export function midZoomForShot(plan: MidZoomSegment[], shotStart: number, shotDuration: number): MidZoomSegment[] {
  return plan
    .filter(s => s.start >= shotStart - 1e-6 && s.end <= shotStart + shotDuration + 1e-6)
    .map(s => ({ ...s, start: s.start - shotStart, end: s.end - shotStart }))
}

/** How far the picture is zoomed at `t`: 1x outside every segment. */
export function midZoomScale(t: number, segments: MidZoomSegment[]): number {
  const segment = segments.find(s => t >= s.start && t < s.end)
  if (!segment) return 1
  if (segment.kind === 'punch') return PUNCHLINE_ZOOM
  const progress = Math.min(1, Math.max(0, (t - segment.start) / (segment.end - segment.start)))
  return 1 + (PEAK_ZOOM - 1) * easeZoom(progress)
}
