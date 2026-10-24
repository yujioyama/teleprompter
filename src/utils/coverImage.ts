import { SUBTITLE_FONT_FAMILY, OUTLINE_WIDTH_RATIO, SUBTITLE_SHADOW } from './subtitleLayout'
import { EMPHASIS_COLOR, WORD_COLOR } from './subtitleEmphasis'
import { STICKER_PLACEMENTS, STICKER_SHADOW, findSticker, type StickerPlacement } from './subtitleSticker'
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

/** The largest size from maxPx down to minPx at which `text` fits COVER_TEXT_WIDTH (minPx if none does). */
export function fitFontPx(text: string, maxPx: number, minPx: number, measure: MeasureWidth, weight = '800'): number {
  for (let px = maxPx; px > minPx; px -= 4) {
    if (measure(text, coverFont(px, weight)) <= COVER_TEXT_WIDTH) return px
  }
  return minPx
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
/** Room kept between the words and the grid window's edges. */
const GRID_MARGIN = 40
/** 0-100, where the block sits by default: in the lower half of the grid window, under the face. */
export const COVER_TEXT_POSITION_DEFAULT = 68

/**
 * The lines, centered at `position` (0 = the top of the grid window, 100 =
 * its bottom) but kept inside the window so neither line gets cropped.
 */
export function coverLines(words: CoverWords, measure: MeasureWidth, position = COVER_TEXT_POSITION_DEFAULT): CoverLine[] {
  const parts: { text: string; color: string; px: number }[] = []
  if (words.en.trim()) {
    const text = words.en.trim()
    parts.push({ text, color: EMPHASIS_COLOR, px: fitFontPx(text, EN_MAX_PX, EN_MIN_PX, measure) })
  }
  if (words.ja.trim()) {
    const text = words.ja.trim()
    parts.push({ text, color: WORD_COLOR, px: fitFontPx(text, JA_MAX_PX, JA_MIN_PX, measure) })
  }
  const height = parts.reduce((h, p) => h + p.px, 0) + LINE_GAP * Math.max(0, parts.length - 1)
  const center = GRID_TOP + ((GRID_BOTTOM - GRID_TOP) * position) / 100
  const minTop = GRID_TOP + GRID_MARGIN
  const maxTop = GRID_BOTTOM - GRID_MARGIN - height
  let top = Math.max(minTop, Math.min(maxTop, center - height / 2))
  return parts.map(p => {
    // Cap height is close to 0.75em; put the baseline there so the block centers on the glyphs.
    const line = { ...p, y: Math.round(top + p.px * 0.85) }
    top += p.px + LINE_GAP
    return line
  })
}

/** Draw `source` filling the cover (cropping what overflows), then the sticker and the words. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  words: CoverWords,
  position = COVER_TEXT_POSITION_DEFAULT,
  stickerPlacement: StickerPlacement = 'right',
): void {
  ctx.clearRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  if (sourceWidth > 0 && sourceHeight > 0) {
    const scale = Math.max(COVER_WIDTH / sourceWidth, COVER_HEIGHT / sourceHeight)
    const w = sourceWidth * scale
    const h = sourceHeight * scale
    ctx.drawImage(source, (COVER_WIDTH - w) / 2, (COVER_HEIGHT - h) / 2, w, h)
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
  if (words.sticker.trim()) drawSticker(ctx, words.sticker.trim(), stickerPlacement)

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

/**
 * The sticker as the first frame has it: the die-cut emoji, tilted, with a
 * soft shadow. With the video's sticker turned off it goes beside the face.
 */
function drawSticker(ctx: CanvasRenderingContext2D, emoji: string, placement: StickerPlacement): void {
  const at = STICKER_PLACEMENTS[placement === 'off' ? 'right' : placement]
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
