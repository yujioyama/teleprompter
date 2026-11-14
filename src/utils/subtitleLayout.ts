import { SubtitleCue } from './subtitleCues'
import { emphasisRuns, parseEmphasis, type Run } from './subtitleEmphasis'

/**
 * Burned-in subtitle geometry, in pixels of the 1080px-wide output video.
 * The DOM preview (SubtitleOverlayPreview) scales the same numbers by the
 * preview's own width so it matches what gets burned in.
 */
export const SUBTITLE_REFERENCE_WIDTH = 1080
/** Room kept clear on either side of the text. */
export const SUBTITLE_MARGIN_X = 90
/** Room above and below the text for its outline and shadow. */
export const SUBTITLE_PADDING_Y = 20
export const SUBTITLE_BLOCK_GAP = 14
export const SUBTITLE_TEXT_WIDTH = SUBTITLE_REFERENCE_WIDTH - SUBTITLE_MARGIN_X * 2

/**
 * Native, current faces on the iPhone that burns and previews them (SF Pro
 * and Hiragino Sans), with nothing to download. Shared by the canvas and
 * the preview's CSS, so both measure alike.
 */
export const SUBTITLE_FONT_FAMILY = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'

/**
 * No box: white text with a crisp black outline (`OUTLINE_WIDTH_RATIO` of
 * the font size, centered on the glyph edge, under the fill) and a soft
 * diffuse shadow for depth, readable over any picture without covering it.
 */
export const OUTLINE_WIDTH_RATIO = 0.12
export const SUBTITLE_SHADOW = { color: 'rgba(0,0,0,0.35)', blurRatio: 0.15, offsetYRatio: 0.04 }

export function outlineWidth(fontPx: number): number {
  return Math.round(fontPx * OUTLINE_WIDTH_RATIO)
}

export interface TextStyle {
  weight: string
  maxPx: number
  minPx: number
  /** Shrink (down to minPx) only while the text needs more lines than this. */
  maxLines: number
  lineHeight: number
}

// Heavy rather than bold, and bold Japanese: a thin weight smudges under an outline.
export const EN_STYLE: TextStyle = { weight: '800', maxPx: 60, minPx: 44, maxLines: 3, lineHeight: 1.25 }
export const JA_STYLE: TextStyle = { weight: 'bold', maxPx: 50, minPx: 38, maxLines: 3, lineHeight: 1.4 }

/**
 * The first shot's cues are hook cues: drawn like any other, but at their
 * own position and from the first frame (see subtitleHook).
 */
export type CueVariant = 'normal' | 'hook'

/** Width in px of `text` rendered in the CSS `font` shorthand. */
export type MeasureText = (text: string, font: string) => number

export function fontFor(style: TextStyle, px: number): string {
  return `${style.weight} ${px}px ${SUBTITLE_FONT_FAMILY}`
}

export interface TextBlockLayout {
  fontPx: number
  lines: string[]
  /** `lines` split into plain and emphasized (`*…*`, `{…}`) runs, markers removed. */
  runs: Run[][]
  lineHeightPx: number
  /** Each line's measured width, in reference px. */
  widths: number[]
}

/**
 * 相手のセリフ: the other person's lines sit in a speech bubble, with their
 * icon (bigger than the text, on a white disc) above its top-left corner and
 * the bubble's tail pointing up at it. Everything is in reference px and the
 * text is wrapped narrower by the bubble's padding, so bubble and icon always
 * fit inside SUBTITLE_TEXT_WIDTH, as plain subtitles do.
 */
export const BUBBLE_PAD_X = 34
export const BUBBLE_PAD_Y = 14
export const BUBBLE_RADIUS = 34
export const BUBBLE_BORDER = 5
export const BUBBLE_FILL = 'rgba(6, 22, 38, 0.6)'
export const SPEAKER_ICON_RADIUS = 52
export const SPEAKER_ICON_EMOJI_PX = 66
/** The 📞 on the icon of someone on the phone: a small white disc at the icon's lower right. */
export const PHONE_BADGE_RADIUS = 24
export const PHONE_BADGE_EMOJI_PX = 30
/** Where the badge's centre sits from the icon's, in icon radii. */
export const PHONE_BADGE_OFFSET = 0.72
/** How far the icon sits in from the bubble's left edge (to its center), and the gap under it. */
export const SPEAKER_ICON_INSET = 18
export const SPEAKER_ICON_GAP = 24
export const SPEAKER_TAIL_HALF_WIDTH = 20
/** The text width inside a bubble: the bubble, border and all, is as wide as plain text at most. */
export const SPEAKER_TEXT_WIDTH = SUBTITLE_TEXT_WIDTH - 2 * (BUBBLE_PAD_X + BUBBLE_BORDER)

export interface SpeakerBubble {
  /** The bubble's outer box (border included), in the cue image's px. */
  left: number
  top: number
  width: number
  height: number
  /** The icon's center. */
  iconX: number
  iconY: number
  /** Where the text's first line starts (its top). */
  textTop: number
}

export interface CueLayout {
  en: TextBlockLayout
  ja: TextBlockLayout | null
  /** Height of the rendered image: the lines plus outline room (and a 相手のセリフ's bubble and icon). */
  height: number
  /** A 相手のセリフ cue's bubble and icon. */
  bubble?: SpeakerBubble
}

/** A breakable unit of text; `spaceBefore` is true when whitespace separated it from the previous token. */
export interface Token {
  text: string
  spaceBefore: boolean
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/
const HIRAGANA = /^[\u3041-\u3096]/
// Characters that must not begin a line (Japanese kinsoku + Latin closing punctuation).
const NO_LINE_START = /^[、。，．・：；？！ー」』）】〕〉》”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥々〜～!?,.:;)\]}%]/
// Characters that must not end a line.
const NO_LINE_END = /[「『（【〔〈《“‘([{]$/
// After these, a new phrase may start even with hiragana (e.g. "だけど、でもね").
const CLAUSE_END = /[、。，．！？!?…]$/
const ALNUM_END = /[A-Za-z0-9]$/
const ALNUM_START = /^[A-Za-z0-9]/

let jaSegmenter: Intl.Segmenter | null | undefined
function segmentJapanese(chunk: string): string[] {
  if (jaSegmenter === undefined) {
    jaSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter('ja', { granularity: 'word' })
      : null
  }
  if (!jaSegmenter) return Array.from(chunk)
  return Array.from(jaSegmenter.segment(chunk), s => s.segment)
}

/**
 * Split text into the units a line may break between. Whitespace-separated
 * words are units; runs of Japanese are cut into word segments and then
 * glued back into phrase-like units (a content word plus the hiragana
 * particles/endings and punctuation that follow it), so lines break
 * between phrases rather than mid-word or before a "。".
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const chunks = text.trim().split(/\s+/).filter(Boolean)
  chunks.forEach((chunk, chunkIndex) => {
    const spaceBefore = chunkIndex > 0
    if (!CJK.test(chunk)) {
      tokens.push({ text: chunk, spaceBefore })
      return
    }
    const phrases: string[] = []
    for (const seg of segmentJapanese(chunk)) {
      const prev = phrases[phrases.length - 1]
      const attach = prev !== undefined && (
        NO_LINE_START.test(seg)
        || NO_LINE_END.test(prev)
        || (HIRAGANA.test(seg) && !CLAUSE_END.test(prev))
        || (ALNUM_END.test(prev) && ALNUM_START.test(seg))
      )
      if (attach) phrases[phrases.length - 1] = prev + seg
      else phrases.push(seg)
    }
    phrases.forEach((p, i) => tokens.push({ text: p, spaceBefore: i === 0 && spaceBefore }))
  })
  return tokens
}

/** Cut any token wider than `maxWidth` into character runs that fit. */
function splitOversized(tokens: Token[], maxWidth: number, width: (s: string) => number): Token[] {
  const out: Token[] = []
  for (const token of tokens) {
    if (width(token.text) <= maxWidth) {
      out.push(token)
      continue
    }
    let current = ''
    let first = true
    for (const ch of Array.from(token.text)) {
      // Keep line-start-forbidden characters on the previous run.
      if (current && width(current + ch) > maxWidth && !NO_LINE_START.test(ch)) {
        out.push({ text: current, spaceBefore: first && token.spaceBefore })
        first = false
        current = ch
      } else {
        current += ch
      }
    }
    if (current) out.push({ text: current, spaceBefore: first && token.spaceBefore })
  }
  return out
}

function breakBonus(lineEnd: string): number {
  if (/[.!?。！？…]$/.test(lineEnd)) return 0.2
  if (/[,;:、，]$/.test(lineEnd)) return 0.1
  return 0
}

/**
 * Wrap `text` into as few lines as fit `maxWidth`, then pick where to break
 * among those line counts so lines come out balanced and preferably end at
 * punctuation — instead of greedily filling the first line and leaving a
 * one-word widow.
 */
export function wrapText(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const tokens = splitOversized(tokenize(text), maxWidth, width)
  const n = tokens.length
  if (n === 0) return []

  const tokenWidths = tokens.map(t => width(t.text))
  const spaceWidth = width(' ')
  // lineWidth(i, j): width of tokens[i..j) laid out on one line.
  const lineWidth = (i: number, j: number) => {
    let w = 0
    for (let k = i; k < j; k++) w += tokenWidths[k] + (k > i && tokens[k].spaceBefore ? spaceWidth : 0)
    return w
  }
  const lineText = (i: number, j: number) =>
    tokens.slice(i, j).map((t, k) => (k > 0 && t.spaceBefore ? ' ' : '') + t.text).join('')

  // Greedy fill gives the minimum number of lines.
  let lineCount = 0
  for (let i = 0; i < n; lineCount++) {
    let j = i + 1
    while (j < n && lineWidth(i, j + 1) <= maxWidth) j++
    i = j
  }

  // cost[k][j]: best cost of laying tokens[0..j) out in exactly k lines.
  const INF = Number.POSITIVE_INFINITY
  const cost: number[][] = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(INF))
  const from: number[][] = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(-1))
  cost[0][0] = 0
  for (let k = 1; k <= lineCount; k++) {
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const w = lineWidth(i, j)
        if (w > maxWidth) break
        if (cost[k - 1][i] === INF) continue
        const slack = (maxWidth - w) / maxWidth
        const bonus = j < n ? breakBonus(tokens[j - 1].text) : 0
        const c = cost[k - 1][i] + slack * slack - bonus
        if (c < cost[k][j]) {
          cost[k][j] = c
          from[k][j] = i
        }
      }
    }
  }

  const lines: string[] = []
  for (let k = lineCount, j = n; k > 0; k--) {
    const i = from[k][j]
    lines.unshift(lineText(i, j))
    j = i
  }
  return lines
}

function layoutBlock(raw: string, style: TextStyle, measure: MeasureText, maxWidth: number): TextBlockLayout {
  const emphasis = parseEmphasis(raw)
  let px = style.maxPx
  let lines: string[] = []
  for (; px >= style.minPx; px -= 2) {
    const font = fontFor(style, px)
    lines = wrapText(emphasis.text, maxWidth, s => measure(s, font))
    if (lines.length <= style.maxLines) break
  }
  px = Math.max(px, style.minPx)
  const font = fontFor(style, px)
  return {
    fontPx: px,
    lines,
    runs: emphasisRuns(lines, emphasis),
    lineHeightPx: Math.round(px * style.lineHeight),
    widths: lines.map(line => measure(line, font)),
  }
}

/**
 * Lay out one cue's subtitle (English, plus Japanese once translated) at the
 * 1080px reference width. With `speaker` (相手のセリフ) it is wrapped to fit
 * a speech bubble, with room above for the icon.
 */
export function layoutCue(cue: Pick<SubtitleCue, 'en' | 'ja'>, measure: MeasureText, { speaker = false }: { speaker?: boolean } = {}): CueLayout {
  const maxWidth = speaker ? SPEAKER_TEXT_WIDTH : SUBTITLE_TEXT_WIDTH
  const en = layoutBlock(cue.en, EN_STYLE, measure, maxWidth)
  const ja = cue.ja ? layoutBlock(cue.ja, JA_STYLE, measure, maxWidth) : null
  let textHeight = en.lines.length * en.lineHeightPx
  if (ja) textHeight += SUBTITLE_BLOCK_GAP + ja.lines.length * ja.lineHeightPx
  if (!speaker) return { en, ja, height: SUBTITLE_PADDING_Y * 2 + textHeight }

  const textWidth = Math.min(maxWidth, Math.max(...en.widths, ...(ja?.widths ?? [])))
  const width = textWidth + 2 * (BUBBLE_PAD_X + BUBBLE_BORDER)
  const left = (SUBTITLE_REFERENCE_WIDTH - width) / 2
  const iconY = SUBTITLE_PADDING_Y + SPEAKER_ICON_RADIUS
  const top = iconY + SPEAKER_ICON_RADIUS + SPEAKER_ICON_GAP
  const textTop = top + BUBBLE_BORDER + BUBBLE_PAD_Y
  const height = textHeight + 2 * (BUBBLE_BORDER + BUBBLE_PAD_Y)
  const bubble: SpeakerBubble = {
    left,
    top,
    width,
    height,
    iconX: left + SPEAKER_ICON_INSET + SPEAKER_ICON_RADIUS,
    iconY,
    textTop,
  }
  return { en, ja, height: top + height + SUBTITLE_PADDING_Y, bubble }
}

/**
 * The bubble's outline with its tail, as an SVG path (the burn draws it as
 * a canvas Path2D, the preview as an SVG, so both are the same shape): a
 * rounded box, and from its top edge a short tail rising into the icon's
 * disc, which is drawn over its tip. `inset` pulls it in (for a stroke
 * centered on the edge). In the cue image's px.
 */
export function bubblePath(bubble: SpeakerBubble, inset = 0): string {
  const l = bubble.left + inset
  const t = bubble.top + inset
  const r = bubble.left + bubble.width - inset
  const b = bubble.top + bubble.height - inset
  const k = Math.max(0, Math.min(BUBBLE_RADIUS - inset, (b - t) / 2))
  const tailX = bubble.iconX
  const tailTip = bubble.iconY + SPEAKER_ICON_RADIUS * 0.4
  const n = (v: number) => Math.round(v * 10) / 10
  return [
    `M${n(l + k)} ${n(t)}`,
    `L${n(tailX - SPEAKER_TAIL_HALF_WIDTH)} ${n(t)}`,
    `L${n(tailX)} ${n(tailTip)}`,
    `L${n(tailX + SPEAKER_TAIL_HALF_WIDTH)} ${n(t)}`,
    `L${n(r - k)} ${n(t)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(r)} ${n(t + k)}`,
    `L${n(r)} ${n(b - k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(r - k)} ${n(b)}`,
    `L${n(l + k)} ${n(b)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(l)} ${n(b - k)}`,
    `L${n(l)} ${n(t + k)}`,
    `A${n(k)} ${n(k)} 0 0 1 ${n(l + k)} ${n(t)}`,
    'Z',
  ].join(' ')
}

/**
 * Text measurement backed by a 2D canvas, falling back to a rough per-char
 * estimate where no canvas is available (e.g. jsdom in tests).
 */
export function createCanvasMeasure(): MeasureText {
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
  try {
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(1, 1).getContext('2d')
    else if (!/jsdom/.test(navigator.userAgent)) ctx = document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  if (ctx) {
    const c = ctx
    return (text, font) => {
      c.font = font
      return c.measureText(text).width
    }
  }
  return (text, font) => {
    const px = Number(/(\d+)px/.exec(font)?.[1] ?? 16)
    return Array.from(text).reduce((w, ch) => w + (CJK.test(ch) ? px : px * 0.55), 0)
  }
}
