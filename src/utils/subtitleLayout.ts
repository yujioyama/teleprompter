import { SubtitleCue } from './subtitleCues'
import { emphasisRuns, parseEmphasis, type Run } from './subtitleEmphasis'

/**
 * Burned-in subtitle geometry, in pixels of the 1080px-wide output video.
 * The DOM preview (SubtitleOverlayPreview) scales the same numbers by the
 * preview's own width so it matches what gets burned in.
 */
export const SUBTITLE_REFERENCE_WIDTH = 1080
export const SUBTITLE_BOX_MARGIN_X = 90
export const SUBTITLE_BOX_PADDING_X = 40
export const SUBTITLE_BOX_PADDING_Y = 28
export const SUBTITLE_BOX_RADIUS = 24
export const SUBTITLE_BLOCK_GAP = 14
export const SUBTITLE_TEXT_WIDTH =
  SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2 - SUBTITLE_BOX_PADDING_X * 2

export interface TextStyle {
  weight: string
  maxPx: number
  minPx: number
  /** Shrink (down to minPx) only while the text needs more lines than this. */
  maxLines: number
  lineHeight: number
}

export const EN_STYLE: TextStyle = { weight: 'bold', maxPx: 60, minPx: 44, maxLines: 3, lineHeight: 1.25 }
export const JA_STYLE: TextStyle = { weight: 'normal', maxPx: 50, minPx: 38, maxLines: 3, lineHeight: 1.4 }

/**
 * The first shot's cues, drawn to stop the scroll: about 1.6x the English
 * and 1.5x the Japanese, on a darker band (see subtitleHook).
 */
export type CueVariant = 'normal' | 'hook'
export const HOOK_EN_STYLE: TextStyle = { weight: 'bold', maxPx: 100, minPx: 72, maxLines: 3, lineHeight: 1.2 }
export const HOOK_JA_STYLE: TextStyle = { weight: 'normal', maxPx: 75, minPx: 57, maxLines: 3, lineHeight: 1.4 }
/** Opacity of the black band behind a cue. */
export const SUBTITLE_BOX_OPACITY: Record<CueVariant, number> = { normal: 0.55, hook: 0.8 }

export function textStylesFor(variant: CueVariant): { en: TextStyle; ja: TextStyle } {
  return variant === 'hook' ? { en: HOOK_EN_STYLE, ja: HOOK_JA_STYLE } : { en: EN_STYLE, ja: JA_STYLE }
}

/** Width in px of `text` rendered in the CSS `font` shorthand. */
export type MeasureText = (text: string, font: string) => number

export function fontFor(style: TextStyle, px: number): string {
  return `${style.weight} ${px}px sans-serif`
}

export interface TextBlockLayout {
  fontPx: number
  lines: string[]
  /** `lines` split into plain and emphasized (`*…*`) runs, markers removed. */
  runs: Run[][]
  lineHeightPx: number
}

export interface CueLayout {
  en: TextBlockLayout
  ja: TextBlockLayout | null
  /** Height of the background box, which is also the rendered image height. */
  height: number
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

function layoutBlock(raw: string, style: TextStyle, measure: MeasureText): TextBlockLayout {
  const emphasis = parseEmphasis(raw)
  let px = style.maxPx
  let lines: string[] = []
  for (; px >= style.minPx; px -= 2) {
    const font = fontFor(style, px)
    lines = wrapText(emphasis.text, SUBTITLE_TEXT_WIDTH, s => measure(s, font))
    if (lines.length <= style.maxLines) break
  }
  px = Math.max(px, style.minPx)
  return { fontPx: px, lines, runs: emphasisRuns(lines, emphasis), lineHeightPx: Math.round(px * style.lineHeight) }
}

/** Lay out one cue's bilingual subtitle box at the 1080px reference width. */
export function layoutCue(
  cue: Pick<SubtitleCue, 'en' | 'ja'>,
  measure: MeasureText,
  variant: CueVariant = 'normal',
): CueLayout {
  const styles = textStylesFor(variant)
  const en = layoutBlock(cue.en, styles.en, measure)
  const ja = cue.ja ? layoutBlock(cue.ja, styles.ja, measure) : null
  let height = SUBTITLE_BOX_PADDING_Y * 2 + en.lines.length * en.lineHeightPx
  if (ja) height += SUBTITLE_BLOCK_GAP + ja.lines.length * ja.lineHeightPx
  return { en, ja, height }
}

/**
 * The first shot's headline: short on-screen-only text above the hook
 * subtitle. Bold white on a dark band as wide as its text, so it reads as
 * a title rather than one more subtitle.
 */
export const HEADLINE_STYLE: TextStyle = { weight: 'bold', maxPx: 72, minPx: 56, maxLines: 2, lineHeight: 1.2 }
export const HEADLINE_BOX_OPACITY = 0.8

export interface HeadlineLayout {
  block: TextBlockLayout
  /** Width of its band: the widest line plus padding, at most a subtitle band's. */
  width: number
  height: number
}

export function layoutHeadline(text: string, measure: MeasureText): HeadlineLayout {
  const block = layoutBlock(text, HEADLINE_STYLE, measure)
  const font = fontFor(HEADLINE_STYLE, block.fontPx)
  const widest = Math.max(0, ...block.lines.map(line => measure(line, font)))
  return {
    block,
    width: Math.min(widest + SUBTITLE_BOX_PADDING_X * 2, SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
    height: SUBTITLE_BOX_PADDING_Y * 2 + block.lines.length * block.lineHeightPx,
  }
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
