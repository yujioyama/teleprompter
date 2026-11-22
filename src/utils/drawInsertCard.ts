import {
  CARD_BACKGROUND_COLORS,
  FOG_ALPHA,
  FOG_COLOR,
  FOG_PUFFS,
  cardLinesOf,
  flickerAt,
  fogPuffAt,
  isSpookyCard,
  letterCutsOf,
  letterScale,
  letterShiver,
  letterTilt,
  type CardBackground,
  type CardBackgroundLook,
  type LetterCut,
  type Wobble,
} from './insertCard'
import { hash, random } from './seededRandom'

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

/** The Japanese under a card: plain, bold and small, so the English stays the star. */
export const CARD_JA_FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif'
export const cardJaFont = (px: number) => `700 ${px}px ${CARD_JA_FONT_FAMILY}`
/** The Japanese's size, as a share of the card's width. */
const JA_SIZE_SHARE = 0.06
/** From the middle of the English's last line to the top of the Japanese, as a share of the English's size. */
const JA_GAP = 0.72

/** Where each letter of a card goes, and its Japanese line when it has one. */
export interface CardLetterLayout {
  fontPx: number
  /** Every letter of every line, in order (no space between the lines). */
  letters: { ch: string; x: number; y: number; width: number; cut: LetterCut }[]
  /** The Japanese, centered at (width / 2, y). */
  ja?: { text: string; fontPx: number; y: number }
}

/**
 * The English laid out as before, and `ja` (when there is any) on one small
 * line under it. The English doesn't move for it, so a card without one looks
 * just as it did.
 */
export function layoutCardText(
  text: string,
  width: number,
  measure: (text: string, font: string) => number,
  height = (width * 16) / 9,
  ja?: string,
): CardLetterLayout {
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
  const jaText = ja?.trim()
  if (!jaText) return { fontPx, letters }
  let jaPx = Math.round(width * JA_SIZE_SHARE)
  const jaWidth = measure(jaText, cardJaFont(jaPx))
  if (jaWidth > room) jaPx = Math.floor((jaPx * room) / jaWidth)
  const lowest = Math.max(height / 2, ...letters.map(l => l.y))
  return { fontPx, letters, ja: { text: jaText, fontPx: jaPx, y: lowest + fontPx * JA_GAP + jaPx / 2 } }
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

/** The drop under each letter on a dark card, as if cut out and laid on. */
export function letterShadow(ctx: Ctx, fontPx: number) {
  ctx.shadowColor = 'rgba(10, 0, 20, 0.7)'
  ctx.shadowBlur = fontPx * 0.12
  ctx.shadowOffsetY = fontPx * 0.06
}

/**
 * The Japanese on a dark card: drawn twice, under a wide soft shadow and a
 * close one, so it reads over fog and specks without an outline.
 */
export function fillJaWithShadow(ctx: Ctx, text: string, x: number, y: number, fontPx: number) {
  ctx.shadowColor = 'rgba(10, 0, 20, 0.9)'
  ctx.shadowBlur = fontPx * 0.55
  ctx.shadowOffsetY = fontPx * 0.15
  ctx.fillText(text, x, y)
  ctx.shadowBlur = fontPx * 0.23
  ctx.shadowOffsetY = fontPx * 0.08
  ctx.fillText(text, x, y)
}

/** The spooky card's fog, `t` seconds in: pale purple puffs drifting across and up, behind the letters. */
function drawFog(ctx: Ctx, width: number, height: number, t: number) {
  for (const puff of FOG_PUFFS) {
    const { x, y, r } = fogPuffAt(puff, t, width, height)
    if (y + r < 0) continue
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, `rgba(${FOG_COLOR}, ${FOG_ALPHA})`)
    blob.addColorStop(1, `rgba(${FOG_COLOR}, 0)`)
    ctx.fillStyle = blob
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** Over the spooky card, `t` seconds in: edges darkening and easing like breath, and the flicker's dip. */
function drawSpookyLight(ctx: Ctx, width: number, height: number, t: number) {
  const breath = 0.08 + 0.08 * Math.sin(t * 2.4)
  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.3, width / 2, height / 2, height * 0.75)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, `rgba(0, 0, 0, ${breath.toFixed(3)})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
  const dip = flickerAt(t)
  if (dip > 0) {
    ctx.fillStyle = `rgba(8, 2, 14, ${dip})`
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * One frame of the card, `t` seconds after it came up: the background, and
 * each letter popped in and tilted on its own (see letterScale, letterTilt).
 * Only the letters move; the card itself stays still. A spooky card
 * (isSpookyCard) has its fog behind the letters, which shiver instead, and
 * its light flickering over all of it.
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
  const spooky = isSpookyCard(background)
  if (spooky) drawFog(ctx, width, height, t)
  ctx.font = cardFont(layout.fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = cardTextColor(background)
  const dark = background.kind === 'image' || CARD_BACKGROUND_COLORS[background.name].texture === 'mottled'
  layout.letters.forEach((letter, i) => {
    const pop = letterScale(i, t)
    if (pop <= 0 || !letter.ch.trim()) return
    const { cut } = letter
    const shiver = spooky ? letterShiver(i, t) : { dx: 0, dy: 0, rotate: letterTilt(wobbles, i, t) }
    ctx.save()
    ctx.translate(letter.x + letter.width / 2 + shiver.dx * layout.fontPx, letter.y + (cut.dy + shiver.dy) * layout.fontPx)
    ctx.rotate(((cut.rotate + shiver.rotate) * Math.PI) / 180)
    ctx.scale(pop * cut.scaleX, pop * cut.scaleY)
    if (dark) letterShadow(ctx, layout.fontPx)
    ctx.fillText(letter.ch, 0, 0)
    ctx.restore()
  })
  if (layout.ja) {
    // Comes in with the English's last letter, and stays still.
    const shown = Math.min(1, Math.max(0, letterScale(layout.letters.length - 1, t)))
    if (shown > 0) {
      ctx.save()
      ctx.globalAlpha = shown
      ctx.font = cardJaFont(layout.ja.fontPx)
      if (dark) fillJaWithShadow(ctx, layout.ja.text, width / 2, layout.ja.y, layout.ja.fontPx)
      else ctx.fillText(layout.ja.text, width / 2, layout.ja.y)
      ctx.restore()
    }
  }
  if (spooky) drawSpookyLight(ctx, width, height, t)
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

/**
 * The spooky card's sound (2026-11-22), under the pop: a quiet hush of air,
 * low and soft (no gusts), with a far voice in it that rises a little and
 * sinks, all in a small reverb so it hangs like mist. Made here, `seconds`
 * long, mono, at `sampleRate`; it fades in, and out by the card's end.
 */
export const MIST_HUSH_LEVEL = 0.14
export const MIST_VOICE_LEVEL = 0.03
/** The hush's low-pass, in Hz: it glides up by MIST_HUSH_GLIDE and back over the card. */
const MIST_HUSH_HZ = 380
const MIST_HUSH_GLIDE = 1.3
/** The shape the sound was tuned on; a card of another length stretches it. */
const MIST_TUNED_S = 2.5

export function cardMistSamples(sampleRate: number, seconds: number): Float32Array {
  const length = Math.max(0, Math.round(seconds * sampleRate))
  const dry = new Float32Array(length)
  const k = seconds / MIST_TUNED_S
  const next = random(hash('mist'))
  // Two one-pole low-passes in a row, over white noise.
  let a = 0
  let b = 0
  let phase = 0
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const u = t / k
    const hz = MIST_HUSH_HZ * (1 + (MIST_HUSH_GLIDE - 1) * Math.sin(Math.PI * Math.min(1, u / 2.4)))
    const alpha = 1 - Math.exp((-2 * Math.PI * hz) / sampleRate)
    a += (next() * 2 - 1 - a) * alpha
    b += (a - b) * alpha
    const hush = MIST_HUSH_LEVEL * envelope(u, [[0, 0], [0.6, 1], [1.9, 0.85], [2.5, 0]])
    // The voice: from 0.3 (tuned time), 440 Hz up to 500 and down to 400, with a slow vibrato.
    const v = u - 0.3
    const pitch = v < 0.9 ? 440 + (60 * Math.max(0, v)) / 0.9 : 500 - (100 * Math.min(1.2, v - 0.9)) / 1.2
    phase += (2 * Math.PI * (pitch + 8 * Math.sin(2 * Math.PI * 4.5 * t))) / sampleRate
    const voice = MIST_VOICE_LEVEL * envelope(v, [[0, 0], [0.7, 1], [1.6, 0.8], [2.2, 0]])
    dry[i] = hush * b + voice * Math.sin(phase)
  }
  const out = withReverb(dry, sampleRate)
  // Gone by the card's end, reverb and all.
  const fade = Math.round(0.15 * sampleRate)
  for (let i = Math.max(0, length - fade); i < length; i++) out[i] *= (length - i) / fade
  return out
}

/** `points` ([time, level], in order) joined by straight lines; 0 outside them. */
function envelope(t: number, points: [number, number][]): number {
  if (t <= points[0][0] || t >= points[points.length - 1][0]) return 0
  for (let i = 1; i < points.length; i++) {
    const [t1, l1] = points[i]
    const [t0, l0] = points[i - 1]
    if (t <= t1) return l0 + ((l1 - l0) * (t - t0)) / (t1 - t0)
  }
  return 0
}

/** A small Schroeder reverb (four combs, two all-passes), mixed with the dry sound. */
function withReverb(dry: Float32Array, sampleRate: number): Float32Array {
  const wet = new Float32Array(dry.length)
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round((ms / 1000) * sampleRate)
    const line = new Float32Array(dry.length)
    for (let i = 0; i < dry.length; i++) {
      line[i] = dry[i] + (i >= d ? 0.77 * line[i - d] : 0)
      wet[i] += line[i] / 4
    }
  }
  let signal = wet
  for (const ms of [5, 1.7]) {
    const d = Math.round((ms / 1000) * sampleRate)
    const out = new Float32Array(signal.length)
    for (let i = 0; i < signal.length; i++) {
      const delayed = i >= d ? out[i - d] : 0
      const input = i >= d ? signal[i - d] : 0
      out[i] = -0.7 * signal[i] + input + 0.7 * delayed
    }
    signal = out
  }
  const mixed = new Float32Array(dry.length)
  for (let i = 0; i < dry.length; i++) mixed[i] = 0.65 * dry[i] + 0.7 * signal[i]
  return mixed
}
