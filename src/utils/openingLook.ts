import type { VideoType } from '../types'
import type { SubtitleCue } from './subtitleCues'
import { stripStickers } from './subtitleSticker'

/**
 * The opening look a Type A/B script gets on its own (2026-11-02), in place
 * of the first shot's zoom:
 * - 'letterbox' (Type A): cinema bars over the top and bottom that hold
 *   through line 1 and slide away as it ends, so a small daily thing opens
 *   like a film.
 * - 'colorPop' (Type B): the picture starts nearly gray and fills back in
 *   the moment line 1's *keyword* is said.
 * Both stay on for at least about a second (2026-11-02): a feed viewer
 * needs that long to see the look at all, and it frames the hook line, the
 * part that decides whether they keep watching.
 * Only the picture gets it; subtitles and the sticker keep their color and
 * sit over the bars.
 */
export type OpeningKind = 'letterbox' | 'colorPop'

export interface OpeningLook {
  kind: OpeningKind
  /** Seconds into the video when it starts to move. */
  at: number
}

export const LETTERBOX = {
  /** Each bar's height, as a fraction of the frame's. */
  height: 0.11,
  /** The bars open as line 1 ends, but hold at least this many seconds… */
  minHold: 1.2,
  /** …and never longer than this. */
  maxHold: 2.5,
  /** Seconds they take to slide away. */
  duration: 0.8,
} as const

export const COLOR_POP = {
  /** How much color is left before the keyword (1 = full color). */
  startSaturation: 0.1,
  /** Seconds the color takes to fill back in. */
  duration: 0.6,
  /** The gray holds at least this many seconds, even for an early keyword… */
  minAt: 1,
  /** …and never so long that it outstays the hook. */
  maxAt: 3,
} as const

export function openingKindFor(type: VideoType | null | undefined): OpeningKind | null {
  if (type === 'A') return 'letterbox'
  if (type === 'B') return 'colorPop'
  return null
}

/** Smoothstep, the same ease as the zoom's. */
function ease(p: number): number {
  const c = Math.min(1, Math.max(0, p))
  return c * c * (3 - 2 * c)
}

/**
 * About when line 1's *keyword* is said: the cue's speech spread evenly over
 * its letters. `cues` are as edited (not styled: a hook cue's start is moved
 * to 0 there, while the talking starts later). null without a keyword.
 */
export function keywordTime(cues: SubtitleCue[]): number | null {
  const first = [...cues].sort((a, b) => a.start - b.start)[0]
  if (!first) return null
  const text = stripStickers(first.en)
  const mark = text.indexOf('*')
  if (mark < 0) return null
  const plain = (s: string) => s.replace(/[*{}]/g, '')
  const before = plain(text.slice(0, mark)).length
  const total = plain(text).length
  if (total === 0) return null
  return first.start + (before / total) * Math.max(0, first.end - first.start)
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
 * The look for `kind`, timed from the cues: the bars open as line 1 ends,
 * the color pops at the keyword (or as line 1 ends without one).
 */
export function openingLookFor(kind: OpeningKind, cues: SubtitleCue[]): OpeningLook {
  const lineEnd = firstLineEnd(cues)
  if (kind === 'letterbox') return { kind, at: clampTime(lineEnd ?? 0, LETTERBOX.minHold, LETTERBOX.maxHold) }
  const at = keywordTime(cues) ?? lineEnd ?? 0
  return { kind, at: clampTime(at, COLOR_POP.minAt, COLOR_POP.maxAt) }
}

/** When the look has finished moving; from then on the picture is untouched. */
export function openingEnd(look: OpeningLook): number {
  return look.at + (look.kind === 'letterbox' ? LETTERBOX.duration : COLOR_POP.duration)
}

/** Each bar's height (fraction of the frame) at `t`; 0 once they've opened. */
export function letterboxHeight(t: number, look: OpeningLook): number {
  if (look.kind !== 'letterbox') return 0
  return LETTERBOX.height * (1 - ease((t - look.at) / LETTERBOX.duration))
}

/** The picture's saturation at `t` (1 = untouched). */
export function colorPopSaturation(t: number, look: OpeningLook): number {
  if (look.kind !== 'colorPop') return 1
  const s = COLOR_POP.startSaturation
  return s + (1 - s) * ease((t - look.at) / COLOR_POP.duration)
}

/** Whether the look changes the picture at `t`. */
export function openingActive(t: number, look: OpeningLook | null): look is OpeningLook {
  return look !== null && t < openingEnd(look)
}

/**
 * ffmpeg's version of the look, from `input` to `output` labels: the color
 * through `hue` (its saturation is a per-frame expression of t), the bars as
 * two black boxes slid off with `overlay` (drawbox can't move over time).
 * burnSubtitlesFFmpeg gives every overlay eof_action=pass, so the bars'
 * own end lets the picture through.
 * Returns filtergraph stages.
 */
export function openingFilterStages(look: OpeningLook, input: string, output: string, width: number, height: number): string[] {
  const at = look.at.toFixed(3)
  if (look.kind === 'colorPop') {
    const s = COLOR_POP.startSaturation
    const p = `clip((t-${at})/${COLOR_POP.duration},0,1)`
    return [`${input}hue=s='${s}+${(1 - s).toFixed(2)}*${p}*${p}*(3-2*${p})'${output}`]
  }
  const bar = Math.round(height * LETTERBOX.height)
  const p = `clip((t-${at})/${LETTERBOX.duration},0,1)`
  const shown = `(1-${p}*${p}*(3-2*${p}))`
  const life = (look.at + LETTERBOX.duration + 0.2).toFixed(3)
  return [
    `color=c=black:s=${width}x${bar}:d=${life}[lbtop];color=c=black:s=${width}x${bar}:d=${life}[lbbot]`,
    `${input}[lbtop]overlay=x=0:y='-${bar}+${bar}*${shown}':eval=frame[lbmid]`,
    `[lbmid][lbbot]overlay=x=0:y='H-${bar}*${shown}':eval=frame${output}`,
  ]
}
