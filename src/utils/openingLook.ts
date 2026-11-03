import type { CinemaLook } from '../../shared/cinemaLook'
import type { VideoType } from '../types'
import type { SubtitleCue } from './subtitleCues'
import { createCanvasMeasure, layoutCue, type MeasureText } from './subtitleLayout'
import { SUBTITLE_VIDEO_HEIGHT, clampedSubtitleY, type SubtitlePosition } from './subtitlePosition'
import { stripStickers } from './subtitleSticker'

/**
 * The opening look a Type A/B script gets on its own (2026-11-02), in place
 * of the first shot's zoom: cinema bars, top and bottom, that hold through
 * line 1 and slide away as it ends, so a small daily thing opens like a film.
 * Both types get the same bars (2026-11-03; Type B's color pop is gone).
 * They're there from the first frame, with the face between them: a feed
 * viewer scrolls past an opening with nothing to see. They stay on for at
 * least about a second, as a feed viewer needs that long to see them at
 * all, and they frame the hook line, the part that decides whether they
 * keep watching.
 * The bars stop short of the subtitles shown meanwhile (2026-11-03): a cue
 * half on black and half on the picture reads as two backgrounds.
 * Only the picture gets them; subtitles and the sticker sit over them.
 * A picked film look (`grade`) is on the picture from the first frame and
 * fades away with the bars, over the same time and ease.
 */
export interface OpeningLook {
  /** Kept for the video record, which still knows Type B's old 'colorPop'. */
  kind: 'letterbox'
  /** Seconds into the video when the bars start to slide away. */
  at: number
  /** Each bar's height, as a fraction of the frame's (see letterboxBarHeight). */
  height: number
  /** The film look under the bars; null = the picture as shot. */
  grade: CinemaLook | null
}

export const LETTERBOX = {
  /** Each bar's height at most, as a fraction of the frame's. */
  height: 0.22,
  /** Output px kept between the top bar and a subtitle's overlay. */
  gap: 16,
  /** The bars slide away as line 1 ends, but hold at least this many seconds… */
  minHold: 1.2,
  /** …and never longer than this. */
  maxHold: 2.5,
  /** Seconds they take to slide away. */
  duration: 0.8,
} as const

export function hasOpening(type: VideoType | null | undefined): boolean {
  return type === 'A' || type === 'B'
}

/** Smoothstep, the same ease as the zoom's. */
function ease(p: number): number {
  const c = Math.min(1, Math.max(0, p))
  return c * c * (3 - 2 * c)
}

/** When line 1 ends, from `cues` as edited; null without cues. */
function firstLineEnd(cues: SubtitleCue[]): number | null {
  const first = [...cues].sort((a, b) => a.start - b.start)[0]
  return first ? first.end : null
}

function clampTime(t: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(t, min), max) * 1000) / 1000
}

/**
 * Each bar's height (fraction of the frame): LETTERBOX.height, or less, so
 * the top bar ends LETTERBOX.gap above the highest of `tops` (overlay tops
 * in output px); the bottom bar matches it.
 */
export function letterboxBarHeight(tops: number[]): number {
  const room = (Math.min(...tops) - LETTERBOX.gap) / SUBTITLE_VIDEO_HEIGHT
  return Math.round(Math.max(0, Math.min(LETTERBOX.height, room)) * 10000) / 10000
}

/**
 * The look timed and sized from `cues` (as edited): the bars slide away as
 * line 1 ends, and are kept clear of every cue starting before they're
 * gone, each laid out and centered on `position` as the burn places it.
 * `grade` is the film look picked for it.
 */
export function openingLookFor(
  cues: SubtitleCue[],
  position: SubtitlePosition,
  grade: CinemaLook | null = null,
  measure: MeasureText = createCanvasMeasure(),
): OpeningLook {
  const at = clampTime(firstLineEnd(cues) ?? 0, LETTERBOX.minHold, LETTERBOX.maxHold)
  const tops = cues
    .filter(c => c.start < at + LETTERBOX.duration)
    .map(c => clampedSubtitleY(position, layoutCue({ en: stripStickers(c.en), ja: c.ja }, measure).height))
  return { kind: 'letterbox', at, height: letterboxBarHeight(tops), grade }
}

/** When the bars are gone; from then on the picture is untouched. */
export function openingEnd(look: OpeningLook): number {
  return look.at + LETTERBOX.duration
}

/** Each bar's height (fraction of the frame) at `t`: look.height until `at`, then sliding away. */
export function letterboxHeight(t: number, look: OpeningLook): number {
  return look.height * (1 - ease((t - look.at) / LETTERBOX.duration))
}

/** How much of the film look shows at `t`: all of it until `at`, then fading away as the bars slide. */
export function lookOpacity(t: number, look: OpeningLook): number {
  return 1 - ease((t - look.at) / LETTERBOX.duration)
}

/** Whether the look changes the picture at `t`. */
export function openingActive(t: number, look: OpeningLook | null): look is OpeningLook {
  return look !== null && t < openingEnd(look)
}

/**
 * ffmpeg's version of the look, from `input` to `output` labels: the bars
 * as two half-frame black boxes slid by `overlay` (drawbox can't move over
 * time) so they show letterboxHeight of the frame each.
 * burnSubtitlesFFmpeg gives every overlay eof_action=pass, so the bars'
 * own end lets the picture through.
 * Returns filtergraph stages.
 */
export function openingFilterStages(look: OpeningLook, input: string, output: string, width: number, height: number): string[] {
  const at = look.at.toFixed(3)
  const half = Math.ceil(height / 2)
  const { duration } = LETTERBOX
  const p = `clip((t-${at})/${duration},0,1)`
  const shown = `${height}*${look.height}*(1-${p}*${p}*(3-2*${p}))`
  const life = (look.at + duration + 0.2).toFixed(3)
  return [
    `color=c=black:s=${width}x${half}:d=${life}[lbtop];color=c=black:s=${width}x${half}:d=${life}[lbbot]`,
    `${input}[lbtop]overlay=x=0:y='-${half}+${shown}':eval=frame[lbmid]`,
    `[lbmid][lbbot]overlay=x=0:y='H-(${shown})':eval=frame${output}`,
  ]
}
