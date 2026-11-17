import { CARD_BACKGROUND_COLORS, cardTextOf, letterScale, letterTilt, type CardBackground, type Wobble } from './insertCard'
import { random } from './seededRandom'

/** The card's font: heavy and round, so the wobbling letters read as playful. */
export const CARD_FONT_FAMILY = '"Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", system-ui, -apple-system, sans-serif'
export const cardFont = (px: number) => `800 ${px}px ${CARD_FONT_FAMILY}`
/** The text fills at most this share of the width. */
const TEXT_WIDTH_SHARE = 0.82
/** Its size before it's fitted to the width, as a share of the card's width. */
const TEXT_SIZE_SHARE = 0.13

/** Where each letter of a card goes, centered as one line. */
export interface CardLetterLayout {
  fontPx: number
  letters: { ch: string; x: number; width: number }[]
  /** The baseline's middle, as a share of the height. */
  y: number
}

export function layoutCardText(text: string, width: number, measure: (text: string, font: string) => number): CardLetterLayout {
  const shown = cardTextOf(text)
  let fontPx = Math.round(width * TEXT_SIZE_SHARE)
  const total = (px: number) => [...shown].reduce((sum, ch) => sum + measure(ch, cardFont(px)), 0)
  const room = width * TEXT_WIDTH_SHARE
  const natural = total(fontPx)
  if (natural > room) fontPx = Math.floor((fontPx * room) / natural)
  const widths = [...shown].map(ch => measure(ch, cardFont(fontPx)))
  const sum = widths.reduce((a, b) => a + b, 0)
  let x = (width - sum) / 2
  const letters = [...shown].map((ch, i) => {
    const letter = { ch, x, width: widths[i] }
    x += widths[i]
    return letter
  })
  return { fontPx, letters, y: 0.5 }
}

/** The background: a picture covering the card, or one of the app's. */
export function drawCardBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: CardBackground,
  image?: CanvasImageSource & { width: number; height: number },
) {
  if (background.kind === 'image' && image) {
    const scale = Math.max(width / image.width, height / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
    // A veil, so the white letters read on any picture.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
    ctx.fillRect(0, 0, width, height)
    return
  }
  const colors = CARD_BACKGROUND_COLORS[background.kind === 'named' ? background.name : 'paper']
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, colors.top)
  gradient.addColorStop(1, colors.bottom)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  if (colors.grain) {
    // Paper: faint specks, the same ones every frame so they don't shimmer.
    const next = random(7)
    ctx.fillStyle = 'rgba(90, 70, 40, 0.06)'
    for (let i = 0; i < 1400; i++) {
      const r = 1 + next() * 2
      ctx.fillRect(next() * width, next() * height, r, r)
    }
  }
}

/** The text's color on a background. */
export function cardTextColor(background: CardBackground): string {
  return background.kind === 'image' ? '#FFFFFF' : CARD_BACKGROUND_COLORS[background.name].text
}

/**
 * One frame of the card, `t` seconds after it came up: the background, and
 * each letter popped in and tilted on its own (see letterScale, letterTilt).
 * Only the letters move; the card itself stays still.
 */
export function drawCardFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  layout: CardLetterLayout,
  wobbles: Wobble[],
  t: number,
  background: CardBackground,
  image?: CanvasImageSource & { width: number; height: number },
) {
  drawCardBackground(ctx, width, height, background, image)
  ctx.font = cardFont(layout.fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = cardTextColor(background)
  const y = height * layout.y
  layout.letters.forEach((letter, i) => {
    const scale = letterScale(i, t)
    if (scale <= 0 || !letter.ch.trim()) return
    ctx.save()
    ctx.translate(letter.x + letter.width / 2, y)
    ctx.rotate((letterTilt(wobbles, i, t) * Math.PI) / 180)
    ctx.scale(scale, scale)
    if (background.kind === 'image') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
      ctx.shadowBlur = layout.fontPx * 0.12
    }
    ctx.fillText(letter.ch, 0, 0)
    ctx.restore()
  })
}

/** Seconds of the pop played as a card comes up. */
export const CARD_POP_SECONDS = 0.3

/**
 * The card's pop (ぽよん), made here rather than taken from a recording: a
 * round tone that drops in pitch and wobbles as it fades, like something
 * soft bouncing. Mono, at `sampleRate`.
 */
export function cardPopSamples(sampleRate: number): Float32Array {
  const length = Math.round(CARD_POP_SECONDS * sampleRate)
  const out = new Float32Array(length)
  let phase = 0
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const frequency = 480 * (1 + 0.7 * Math.exp(-t * 22)) * (1 + 0.07 * Math.sin(2 * Math.PI * 13 * t))
    phase += (2 * Math.PI * frequency) / sampleRate
    const attack = Math.min(1, t / 0.006)
    const decay = Math.exp(-t * 11)
    // A soft fade over the last 30 ms, so it ends without a click.
    const tail = Math.min(1, (CARD_POP_SECONDS - t) / 0.03)
    out[i] = 0.42 * attack * decay * tail * (Math.sin(phase) + 0.25 * Math.sin(2 * phase))
  }
  return out
}
