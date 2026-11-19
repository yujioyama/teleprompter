import { CARD_BACKGROUND_COLORS, cardLinesOf, letterCutsOf, letterScale, letterTilt, type CardBackground, type CardBackgroundLook, type LetterCut, type Wobble } from './insertCard'
import { random } from './seededRandom'

/**
 * The card's lettering: heavy, narrow capitals, each cut a little
 * differently (see letterCutsOf), for a hand-made comic look. Avenir Next
 * Condensed is on every iPhone and Mac; the rest are stand-ins.
 */
export const CARD_FONT_FAMILY = '"Avenir Next Condensed", Impact, "Arial Narrow", "Helvetica Neue", system-ui, sans-serif'
export const cardFont = (px: number) => `900 ${px}px ${CARD_FONT_FAMILY}`
/** The widest line fills at most this share of the width. */
const TEXT_WIDTH_SHARE = 0.84
/** The largest the letters get, as a share of the card's width. */
const TEXT_SIZE_SHARE = 0.21
/** Between letters, as a share of the font size. */
const LETTER_GAP = 0.03
/** From one line's middle to the next, as a share of the font size. */
const LINE_STEP = 1.32

/** Where each letter of a card goes. */
export interface CardLetterLayout {
  fontPx: number
  /** Every letter of every line, in order (no space between the lines). */
  letters: { ch: string; x: number; y: number; width: number; cut: LetterCut }[]
}

export function layoutCardText(text: string, width: number, measure: (text: string, font: string) => number, height = (width * 16) / 9): CardLetterLayout {
  const lines = cardLinesOf(text)
  const cuts = letterCutsOf(lines.join(''))
  const lineWidth = (line: string, px: number, from: number) =>
    [...line].reduce((sum, ch, i) => sum + measure(ch, cardFont(px)) * cuts[from + i].scaleX + px * LETTER_GAP, 0) - px * LETTER_GAP
  let fontPx = Math.round(width * TEXT_SIZE_SHARE)
  const starts = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + [...l].length, 0))
  const widest = Math.max(...lines.map((line, i) => lineWidth(line, fontPx, starts[i])))
  const room = width * TEXT_WIDTH_SHARE
  if (widest > room) fontPx = Math.floor((fontPx * room) / widest)
  const letters: CardLetterLayout['letters'] = []
  lines.forEach((line, row) => {
    const from = starts[row]
    let x = (width - lineWidth(line, fontPx, from)) / 2
    const y = height / 2 + (row - (lines.length - 1) / 2) * fontPx * LINE_STEP
    ;[...line].forEach((ch, i) => {
      const cut = cuts[from + i]
      const w = measure(ch, cardFont(fontPx)) * cut.scaleX
      letters.push({ ch, x, y, width: w, cut })
      x += w + fontPx * LETTER_GAP
    })
  })
  return { fontPx, letters }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// The painted backgrounds by look and size, drawn once: blotches and specks
// for every frame of a card would be thousands of shapes each time.
const painted = new Map<string, OffscreenCanvas | HTMLCanvasElement>()

function scratchCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** A named background, painted: its gradient, then its blotches and specks or grain. */
export function paintCardBackground(ctx: Ctx, width: number, height: number, look: CardBackgroundLook, seed = 7) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, look.top)
  gradient.addColorStop(1, look.bottom)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  const next = random(seed)
  if (look.texture === 'grain') {
    ctx.fillStyle = 'rgba(90, 70, 40, 0.06)'
    for (let i = 0; i < 1400; i++) {
      const r = (1 + next() * 2) * (width / 1080)
      ctx.fillRect(next() * width, next() * height, r, r)
    }
    return
  }
  if (look.texture !== 'mottled') return
  // Soft blotches of color, like paint dabbed on with a sponge.
  const blotches = look.blotches ?? []
  for (let i = 0; i < 70; i++) {
    const x = next() * width
    const y = next() * height
    const r = width * (0.08 + next() * 0.22)
    const color = blotches[Math.floor(next() * blotches.length)]
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, color)
    blob.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = blob
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // A fine spray of specks.
  if (look.specks) {
    ctx.fillStyle = look.specks
    for (let i = 0; i < 2600; i++) {
      const r = (0.8 + next() ** 3 * 4) * (width / 1080)
      ctx.beginPath()
      ctx.arc(next() * width, next() * height, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Darker at the edges, so the eye goes to the words.
  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.3, width / 2, height / 2, height * 0.75)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

/** The background: a picture covering the card, or one of the app's. */
export function drawCardBackground(
  ctx: Ctx,
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
    // A veil, so the letters read on any picture.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.fillRect(0, 0, width, height)
    return
  }
  const name = background.kind === 'named' ? background.name : 'grape'
  const key = `${name}:${width}x${height}`
  let canvas = painted.get(key)
  if (!canvas) {
    canvas = scratchCanvas(width, height)
    const paint = canvas.getContext('2d') as Ctx | null
    if (!paint) {
      paintCardBackground(ctx, width, height, CARD_BACKGROUND_COLORS[name])
      return
    }
    paintCardBackground(paint, width, height, CARD_BACKGROUND_COLORS[name])
    painted.set(key, canvas)
  }
  ctx.drawImage(canvas, 0, 0, width, height)
}

/** The text's color on a background. */
export function cardTextColor(background: CardBackground): string {
  return background.kind === 'image' ? '#E6F5C8' : CARD_BACKGROUND_COLORS[background.name].text
}

/**
 * One frame of the card, `t` seconds after it came up: the background, and
 * each letter popped in and tilted on its own (see letterScale, letterTilt).
 * Only the letters move; the card itself stays still.
 */
export function drawCardFrame(
  ctx: Ctx,
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
  const dark = background.kind === 'image' || CARD_BACKGROUND_COLORS[background.name].texture === 'mottled'
  layout.letters.forEach((letter, i) => {
    const pop = letterScale(i, t)
    if (pop <= 0 || !letter.ch.trim()) return
    const { cut } = letter
    ctx.save()
    ctx.translate(letter.x + letter.width / 2, letter.y + cut.dy * layout.fontPx)
    ctx.rotate(((cut.rotate + letterTilt(wobbles, i, t)) * Math.PI) / 180)
    ctx.scale(pop * cut.scaleX, pop * cut.scaleY)
    // A soft drop under each letter on the dark ones, as if cut out and laid on.
    if (dark) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
      ctx.shadowBlur = layout.fontPx * 0.06
      ctx.shadowOffsetY = layout.fontPx * 0.04
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
