import { SUBTITLE_FONT_FAMILY, OUTLINE_WIDTH_RATIO, SUBTITLE_SHADOW } from './subtitleLayout'
import { EMPHASIS_COLOR, WORD_COLOR } from './subtitleEmphasis'
import { STICKER_EMOJI_PX, STICKER_PLACEMENTS, STICKER_SHADOW, findSticker, type StickerPlacement } from './subtitleSticker'
import { dieCutSticker } from './stickerCanvas'

/**
 * A cover image for the profile grid: a frame of the video with the
 * episode's English phrase (yellow, the `*…*` one) and its Japanese word
 * (mint, the `{…}` one) drawn large, so the grid reads like a word list,
 * and the first shot's sticker where the video's first frame has it.
 */

export const COVER_WIDTH = 1080
export const COVER_HEIGHT = 1920
/** The profile grid shows about a 3:4 window around the middle of the 9:16 frame. */
export const GRID_TOP = (COVER_HEIGHT - (COVER_WIDTH * 4) / 3) / 2
export const GRID_BOTTOM = COVER_HEIGHT - GRID_TOP
/** Room kept clear on either side of the words. */
export const COVER_TEXT_WIDTH = 900

export interface CoverWords {
  /** The English phrase, from the first `*…*` in the script. */
  en: string
  /** The Japanese word in romaji, from the first `{…}` in the script, with its kana from the Japanese subtitles when there is one. */
  ja: string
  /** The first line's emoji, the one the first shot shows as a sticker. */
  sticker: string
}

const STAR = /\*([^\s*](?:[^*\n]*[^\s*])?)\*/
const BRACE = /\{([^\s{}](?:[^{}\n]*[^\s{}])?)\}/

function firstMatch(texts: (string | null | undefined)[], pattern: RegExp): string | null {
  for (const text of texts) {
    const m = text ? pattern.exec(text) : null
    if (m) return m[1]
  }
  return null
}

/**
 * The words for the cover, taken from the shots' text and (for the kana)
 * the Japanese subtitle lines, where the translator marks the same word in
 * `{…}`. Either is an empty string when the script has no such marker, and
 * the sticker is one when the first line has no emoji.
 */
export function coverWordsOf(shotTexts: string[], jaLines: (string | null)[] = []): CoverWords {
  const en = firstMatch(shotTexts, STAR) ?? ''
  const romaji = firstMatch(shotTexts, BRACE) ?? ''
  const kana = firstMatch(jaLines, BRACE) ?? ''
  // Show the kana only when it adds something: not when the translator
  // left the romaji as it was.
  const ja = kana && kana.toLowerCase() !== romaji.toLowerCase() ? [romaji, kana].filter(Boolean).join(' ') : romaji
  const sticker = findSticker(shotTexts[0] ?? '') ?? ''
  return { en, ja, sticker }
}

export type MeasureWidth = (text: string, font: string) => number

export function coverFont(px: number, weight = '800'): string {
  return `${weight} ${px}px ${SUBTITLE_FONT_FAMILY}`
}

/** The largest size from maxPx down to minPx at which every row fits COVER_TEXT_WIDTH, or null if none does. */
function fitRowsPx(rows: string[], maxPx: number, minPx: number, measure: MeasureWidth, weight = '800'): number | null {
  const fit = (px: number) => rows.every(row => measure(row, coverFont(px, weight)) <= COVER_TEXT_WIDTH)
  for (let px = maxPx; px > minPx; px -= 4) {
    if (fit(px)) return px
  }
  return fit(minPx) ? minPx : null
}

/** The largest size from maxPx down to minPx at which `text` fits COVER_TEXT_WIDTH (minPx if none does). */
export function fitFontPx(text: string, maxPx: number, minPx: number, measure: MeasureWidth, weight = '800'): number {
  return fitRowsPx([text], maxPx, minPx, measure, weight) ?? minPx
}

const isAscii = (ch: string) => ch.charCodeAt(0) < 0x80

/**
 * `text` broken in two at a space: where the romaji meets the kana when
 * there is such a space, else where the halves come out most even. Null
 * for a single word.
 */
function splitInTwo(text: string, measure: MeasureWidth, font: string): [string, string] | null {
  const words = text.split(/\s+/)
  const splits: [string, string][] = []
  const atScript: [string, string][] = []
  for (let i = 1; i < words.length; i++) {
    const split: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    splits.push(split)
    if (isAscii(words[i - 1].slice(-1)) !== isAscii(words[i][0])) atScript.push(split)
  }
  const candidates = atScript.length > 0 ? atScript : splits
  const widest = ([a, b]: [string, string]) => Math.max(measure(a, font), measure(b, font))
  return candidates.reduce<[string, string] | null>((best, s) => (best && widest(best) <= widest(s) ? best : s), null)
}

/**
 * `text` as rows of one size: one row while it fits at minPx or more, else
 * two, and smaller than minPx only when even two don't fit.
 */
function wrapText(text: string, maxPx: number, minPx: number, measure: MeasureWidth): { rows: string[]; px: number } {
  const one = fitRowsPx([text], maxPx, minPx, measure)
  if (one !== null) return { rows: [text], px: one }
  const rows = splitInTwo(text, measure, coverFont(minPx)) ?? [text]
  const px = fitRowsPx(rows, maxPx, minPx, measure)
  if (px !== null) return { rows, px }
  // Width grows about in step with the size, so scale minPx down by how far
  // the widest row overflows, then go on down the last pixels a real font's
  // rounding can leave over.
  const widest = Math.max(...rows.map(row => measure(row, coverFont(minPx))))
  const scaled = Math.floor((minPx * COVER_TEXT_WIDTH) / widest)
  return { rows, px: fitRowsPx(rows, scaled, 1, measure) ?? 1 }
}

export interface CoverLine {
  text: string
  color: string
  px: number
  /** Baseline, in cover pixels. */
  y: number
}

const EN_MAX_PX = 200
const EN_MIN_PX = 72
const JA_MAX_PX = 150
const JA_MIN_PX = 60
const LINE_GAP = 40
/** Between the two rows of a wrapped phrase, as a fraction of its size: enough that the outlines don't touch. */
const WRAP_GAP_RATIO = 0.2
/** Room kept between the words and the grid window's edges. */
const GRID_MARGIN = 40
/** 0-100, where the block sits by default: in the lower half of the grid window, under the face. */
export const COVER_TEXT_POSITION_DEFAULT = 68

/**
 * The lines, centered at `position` (0 = the top of the grid window, 100 =
 * its bottom) but kept inside the window so no line gets cropped. A phrase
 * too long for one line takes two.
 */
export function coverLines(words: CoverWords, measure: MeasureWidth, position = COVER_TEXT_POSITION_DEFAULT): CoverLine[] {
  const rows: { text: string; color: string; px: number; gapAfter: number }[] = []
  const add = (text: string, color: string, maxPx: number, minPx: number) => {
    if (rows.length > 0) rows[rows.length - 1].gapAfter = LINE_GAP
    const wrapped = wrapText(text, maxPx, minPx, measure)
    const wrapGap = Math.round(wrapped.px * WRAP_GAP_RATIO)
    for (const row of wrapped.rows) rows.push({ text: row, color, px: wrapped.px, gapAfter: wrapGap })
  }
  if (words.en.trim()) add(words.en.trim(), EMPHASIS_COLOR, EN_MAX_PX, EN_MIN_PX)
  if (words.ja.trim()) add(words.ja.trim(), WORD_COLOR, JA_MAX_PX, JA_MIN_PX)
  const height = rows.reduce((h, r, i) => h + r.px + (i < rows.length - 1 ? r.gapAfter : 0), 0)
  const center = GRID_TOP + ((GRID_BOTTOM - GRID_TOP) * position) / 100
  const minTop = GRID_TOP + GRID_MARGIN
  const maxTop = GRID_BOTTOM - GRID_MARGIN - height
  let top = Math.max(minTop, Math.min(maxTop, center - height / 2))
  return rows.map(({ gapAfter, ...r }) => {
    // Cap height is close to 0.75em; put the baseline there so the block centers on the glyphs.
    const line = { ...r, y: Math.round(top + r.px * 0.85) }
    top += r.px + gapAfter
    return line
  })
}

/** Where the sticker's center is: x as a fraction of the width, y as a percent of the height, like STICKER_PLACEMENTS. */
export interface CoverStickerSpot {
  x: number
  y: number
}

/** A spot with the sticker's tilt, in degrees. */
export type PlacedSticker = CoverStickerSpot & { rotation: number }

/** The sticker's grab area on the cover, in cover pixels: about the emoji itself. */
export const COVER_STICKER_SIZE = STICKER_EMOJI_PX * 1.3

/** `spot` with the sticker's center kept on the cover, so it can't be dragged away for good. */
export function clampStickerSpot(spot: CoverStickerSpot): CoverStickerSpot {
  return { x: Math.min(1, Math.max(0, spot.x)), y: Math.min(100, Math.max(0, spot.y)) }
}

/**
 * Where the cover's sticker goes and its tilt: where it was dragged to, or
 * else where the video's first frame has it (beside the face when the
 * video's sticker is off).
 */
export function coverStickerSpot(placement: StickerPlacement, moved: CoverStickerSpot | null): PlacedSticker {
  const home = STICKER_PLACEMENTS[placement === 'off' ? 'right' : placement]
  return { ...(moved ? clampStickerSpot(moved) : home), rotation: home.rotation }
}

/**
 * Where in the video a cover starts: a little in, since the very first
 * frame is often mid-blink or mid-movement.
 */
export function coverStartTime(duration: number): number {
  return Math.min(0.5, duration / 2)
}

/**
 * Where to draw a `sourceWidth`x`sourceHeight` picture so it fills a
 * `width`x`height` frame without distortion: scaled to cover it, centered,
 * with what overflows left outside the frame.
 */
export function coverFitRect(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const w = sourceWidth * scale
  const h = sourceHeight * scale
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
}

/** Draw `source` filling the cover (cropping what overflows), then the sticker and the words. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  words: CoverWords,
  position = COVER_TEXT_POSITION_DEFAULT,
  sticker: PlacedSticker = coverStickerSpot('right', null),
): void {
  ctx.clearRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  if (sourceWidth > 0 && sourceHeight > 0) {
    const { x, y, width, height } = coverFitRect(sourceWidth, sourceHeight, COVER_WIDTH, COVER_HEIGHT)
    ctx.drawImage(source, x, y, width, height)
  }

  const measure: MeasureWidth = (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
  const lines = coverLines(words, measure, position)
  if (lines.length > 0) {
    // A soft dark band behind the words, so they read over any picture.
    const first = lines[0]
    const last = lines[lines.length - 1]
    const bandTop = first.y - first.px * 1.3
    const bandBottom = last.y + last.px * 0.8
    const gradient = ctx.createLinearGradient(0, bandTop, 0, bandBottom)
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(0.3, 'rgba(0,0,0,0.45)')
    gradient.addColorStop(0.7, 'rgba(0,0,0,0.45)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, bandTop, COVER_WIDTH, bandBottom - bandTop)
  }
  // Over the band, under the words.
  if (words.sticker.trim()) drawSticker(ctx, words.sticker.trim(), sticker)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  for (const line of lines) {
    ctx.font = coverFont(line.px)
    // Outline under the fill, like the burned-in subtitles, with their shadow.
    ctx.save()
    ctx.shadowColor = SUBTITLE_SHADOW.color
    ctx.shadowBlur = line.px * SUBTITLE_SHADOW.blurRatio
    ctx.shadowOffsetY = line.px * SUBTITLE_SHADOW.offsetYRatio
    ctx.strokeStyle = '#000'
    ctx.lineWidth = Math.round(line.px * OUTLINE_WIDTH_RATIO) * 2
    ctx.strokeText(line.text, COVER_WIDTH / 2, line.y)
    ctx.restore()
    ctx.fillStyle = line.color
    ctx.fillText(line.text, COVER_WIDTH / 2, line.y)
  }
}

/** The sticker as the first frame has it: the die-cut emoji, tilted, with a soft shadow. */
function drawSticker(ctx: CanvasRenderingContext2D, emoji: string, at: PlacedSticker): void {
  const sticker = dieCutSticker(emoji, 1)
  const center = sticker.width / 2
  ctx.save()
  ctx.translate(COVER_WIDTH * at.x, (COVER_HEIGHT * at.y) / 100)
  ctx.rotate((at.rotation * Math.PI) / 180)
  ctx.shadowColor = STICKER_SHADOW.color
  ctx.shadowBlur = STICKER_SHADOW.blur
  ctx.shadowOffsetY = STICKER_SHADOW.offsetY
  ctx.drawImage(sticker, -center, -center)
  ctx.restore()
  sticker.width = 0
  sticker.height = 0
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('カバー画像を作れませんでした'))), 'image/png')
  })
}
