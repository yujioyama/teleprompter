import { CARD_BACKGROUND_COLORS, letterCutsOf, letterTilt, popScaleAt, wobblesOf, type LetterCut, type Wobble } from './insertCard'
import { cardFont, cardJaFont, fillJaWithShadow, letterShadow, paintCardBackground } from './drawInsertCard'
import { OPENING_JA_FADE_S, drawOpeningCard, layoutJa, layoutOpening, wordSpansOf, type OpeningCardPlan, type OpeningTiming } from './openingCard'
import { hash, random } from './seededRandom'

/**
 * 冒頭カード in the night sky (2026-11-22): the 挿入カード's night, its blue
 * mottle calm under twinkling stars that drift slowly, with now and then a
 * shooting star; the sentence in the cards' hand-cut capitals, each letter
 * popping in as it's heard (the typing's times), wobbling a little once
 * all are in; the Japanese fading in under it. At `wipeAt` it cuts straight
 * to line 1. Same size as the 暖簾 (OPENING_WIDTH × OPENING_HEIGHT).
 */

/** The English fills at most this share of the width: TikTok cuts off the sides. */
const TEXT_WIDTH_SHARE = 0.8
/** Sizes, as shares of the width: as big as fits in MAX_LINES lines, down to the smallest. */
const FONT_MAX_SHARE = 0.115
const FONT_MIN_SHARE = 0.07
const MAX_LINES = 4
/** Between letters, and from one line's middle to the next, as shares of the font size (the cards'). */
const LETTER_GAP = 0.03
const LINE_STEP = 1.25
/** The English block's middle, as a share of the height: above the face, below the feed's top. */
const CENTER_SHARE = 0.4
/** From the middle of the English's last line to the Japanese's middle, as a share of the English size. */
const JA_GAP = 1.05

export const STARS_INK = CARD_BACKGROUND_COLORS.night.text

export interface StarsLetter {
  /** Its index in the sentence as written, for its time in charTimes. */
  src: number
  ch: string
  /** Its middle and baseline-middle. */
  x: number
  y: number
  cut: LetterCut
}

export interface StarsLayout {
  fontPx: number
  /** The sentence's letters (no spaces), in order. */
  letters: StarsLetter[]
  /** The sentence in capitals as the wobbles read it, index for index with the source. */
  shown: string
  ja?: { lines: string[]; fontPx: number; y: number; step: number }
}

/** The sentence laid out once, as it will end up, so each letter pops in in place. */
export function layoutStarsOpening(text: string, width: number, height: number, measure: (text: string, font: string) => number, ja?: string): StarsLayout {
  // Each character in capitals on its own, so indexes stay the source's.
  const chars = [...text].map(ch => ch.toUpperCase().slice(0, 1) || ch)
  const shown = chars.join('')
  const cuts = letterCutsOf(shown)
  const spans = wordSpansOf(text)
  const widthOf = (from: number, to: number, px: number) => {
    let w = 0
    for (let i = from; i < to; i++) w += (/\s/.test(chars[i]) ? measure(' ', cardFont(px)) : measure(chars[i], cardFont(px)) * cuts[i].scaleX) + px * LETTER_GAP
    return Math.max(0, w - px * LETTER_GAP)
  }
  const room = width * TEXT_WIDTH_SHARE
  /** The words' lines at `px`: [first span, last span] each. */
  const linesAt = (px: number) => {
    const lines: [number, number][] = []
    spans.forEach((span, i) => {
      const line = lines[lines.length - 1]
      if (line && widthOf(spans[line[0]].from, span.to, px) <= room) line[1] = i
      else lines.push([i, i])
    })
    return lines
  }
  let fontPx = Math.round(width * FONT_MAX_SHARE)
  const minPx = Math.round(width * FONT_MIN_SHARE)
  let lines = linesAt(fontPx)
  const tooWide = (px: number, ls: [number, number][]) => ls.some(([a, b]) => widthOf(spans[a].from, spans[b].to, px) > room)
  while (fontPx > minPx && (lines.length > MAX_LINES || tooWide(fontPx, lines))) {
    fontPx -= 2
    lines = linesAt(fontPx)
  }
  lines = lines.slice(0, MAX_LINES)
  // A single word wider than the room even at the smallest size: shrunk to fit.
  const widest = Math.max(0, ...lines.map(([a, b]) => widthOf(spans[a].from, spans[b].to, fontPx)))
  if (widest > room) fontPx = Math.floor((fontPx * room) / widest)
  const step = fontPx * LINE_STEP
  const top = height * CENTER_SHARE - (step * (lines.length - 1)) / 2
  const letters: StarsLetter[] = []
  lines.forEach(([a, b], row) => {
    const from = spans[a].from
    const to = spans[b].to
    let x = (width - widthOf(from, to, fontPx)) / 2
    const y = top + row * step
    for (let i = from; i < to; i++) {
      if (/\s/.test(chars[i])) {
        x += measure(' ', cardFont(fontPx)) + fontPx * LETTER_GAP
        continue
      }
      const w = measure(chars[i], cardFont(fontPx)) * cuts[i].scaleX
      letters.push({ src: i, ch: chars[i], x: x + w / 2, y, cut: cuts[i] })
      x += w + fontPx * LETTER_GAP
    }
  })
  const jaText = ja?.trim()
  if (!jaText) return { fontPx, letters, shown }
  // The opening's Japanese fitting; its font is the cards' (the same face and weight).
  const { lines: jaLines, fontPx: jaPx } = layoutJa(jaText, width, measure)
  return {
    fontPx,
    letters,
    shown,
    ja: { lines: jaLines, fontPx: jaPx, y: top + step * (lines.length - 1) + fontPx * JA_GAP, step: jaPx * 1.4 },
  }
}

// ---- The sky ----

/** A star: where (as shares of the width and height), how big (of the width), and how it twinkles. */
interface Star {
  x: number
  y: number
  r: number
  phase: number
  speed: number
  /** A big one catches the light in a cross when it's bright. */
  glint: boolean
}

const STAR_COUNT = 260
/** The sky drifts left this many widths a second. */
const DRIFT = 0.015

export const STARS: readonly Star[] = (() => {
  const next = random(hash('stars'))
  return Array.from({ length: STAR_COUNT }, () => {
    const big = next() ** 4
    return { x: next(), y: next(), r: (0.4 + big * 1.8) / 270, phase: next() * Math.PI * 2, speed: 1.5 + next() * 3, glint: big > 0.35 }
  })
})()

/** How bright star `star` is `t` seconds in, 0.25 to 0.85. */
export function starBrightness(star: Pick<Star, 'phase' | 'speed'>, t: number): number {
  return 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * star.speed + star.phase))
}

/** A shooting star: when it starts, and where (shares of the width and height). */
export interface ShootingStar {
  at: number
  x: number
  y: number
}

/** How long one takes to cross, and how far it goes (shares of the width and height). */
export const SHOOTING_SECONDS = 0.45
const SHOOT_DX = -0.63
const SHOOT_DY = 0.2
const SHOOT_TAIL = 0.22

/**
 * The shooting stars of a card that's up `until` seconds: the first 0.4 s in,
 * then one every 0.8 to 1.3 s, each starting high up (above the words) and
 * gone before the cut. The same for the same sentence, on every draw.
 */
export function shootingStarsOf(text: string, until: number): ShootingStar[] {
  const next = random(hash(`shoot:${text}`))
  const out: ShootingStar[] = []
  for (let at = 0.4; at + SHOOTING_SECONDS <= until; at += 0.8 + next() * 0.5) {
    out.push({ at, x: 0.45 + next() * 0.55, y: 0.03 + next() * 0.22 })
  }
  return out
}

let painted: { key: string; canvas: OffscreenCanvas | HTMLCanvasElement } | null = null

/** The night's mottle without its fixed specks (the stars move instead), painted once per size. */
function skyCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  const key = `${width}x${height}`
  if (painted?.key === key) return painted.canvas
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!ctx) return null
  paintCardBackground(ctx, width, height, { ...CARD_BACKGROUND_COLORS.night, specks: undefined })
  painted = { key, canvas }
  return canvas
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function drawSky(ctx: Ctx, width: number, height: number, t: number, shooting: ShootingStar[]) {
  const sky = skyCanvas(width, height)
  if (sky) ctx.drawImage(sky, 0, 0, width, height)
  else paintCardBackground(ctx, width, height, { ...CARD_BACKGROUND_COLORS.night, specks: undefined })
  for (const star of STARS) {
    const x = ((((star.x - t * DRIFT) % 1) + 1) % 1) * width
    const y = star.y * height
    const r = star.r * width
    const a = starBrightness(star, t)
    ctx.fillStyle = `rgba(240, 230, 180, ${a.toFixed(2)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (star.glint && a > 0.7) {
      ctx.strokeStyle = `rgba(255, 248, 210, ${((a - 0.7) * 2.5).toFixed(2)})`
      ctx.lineWidth = r * 0.4
      ctx.beginPath()
      ctx.moveTo(x - r * 4, y)
      ctx.lineTo(x + r * 4, y)
      ctx.moveTo(x, y - r * 4)
      ctx.lineTo(x, y + r * 4)
      ctx.stroke()
    }
  }
  for (const s of shooting) {
    const p = (t - s.at) / SHOOTING_SECONDS
    if (p < 0 || p > 1) continue
    const hx = (s.x + p * SHOOT_DX) * width
    const hy = (s.y + p * SHOOT_DY) * height
    // The tail trails back the way it came.
    const mx = SHOOT_DX * width
    const my = SHOOT_DY * height
    const back = (SHOOT_TAIL * width) / Math.hypot(mx, my)
    const tx = hx - mx * back
    const ty = hy - my * back
    const fade = (1 - p).toFixed(2)
    const tail = ctx.createLinearGradient(hx, hy, tx, ty)
    tail.addColorStop(0, `rgba(255, 250, 220, ${fade})`)
    tail.addColorStop(1, 'rgba(255, 250, 220, 0)')
    ctx.strokeStyle = tail
    ctx.lineWidth = width * 0.006
    ctx.beginPath()
    ctx.moveTo(hx, hy)
    ctx.lineTo(tx, ty)
    ctx.stroke()
    ctx.fillStyle = `rgba(255, 252, 235, ${fade})`
    ctx.beginPath()
    ctx.arc(hx, hy, width * 0.0067, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Everything a frame needs besides the time, worked out once per card. */
export interface StarsScene {
  layout: StarsLayout
  timing: OpeningTiming
  wobbles: Wobble[]
  shooting: ShootingStar[]
}

export function starsSceneOf(text: string, layout: StarsLayout, timing: OpeningTiming): StarsScene {
  return {
    layout,
    timing,
    // Once every letter is in, until the cut.
    wobbles: wobblesOf(layout.shown, Math.max(0, timing.wipeAt - timing.typedEnd)),
    shooting: shootingStarsOf(text, timing.wipeAt),
  }
}

/**
 * The card `t` seconds in, onto `ctx` at `width` × `height`: the sky, the
 * letters popped in so far, the Japanese fading in; from `wipeAt`, line 1's
 * first frame (`background`) alone.
 */
export function drawStarsOpening(ctx: Ctx, background: CanvasImageSource | null, scene: StarsScene, t: number, width: number, height: number): void {
  const { layout, timing } = scene
  ctx.save()
  if (t >= timing.wipeAt) {
    if (background) ctx.drawImage(background, 0, 0, width, height)
    else {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.restore()
    return
  }
  drawSky(ctx, width, height, t, scene.shooting)
  ctx.font = cardFont(layout.fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = STARS_INK
  for (const letter of layout.letters) {
    const pop = popScaleAt(t - (timing.charTimes[letter.src] ?? timing.typedEnd))
    if (pop <= 0) continue
    const { cut } = letter
    ctx.save()
    ctx.translate(letter.x, letter.y + cut.dy * layout.fontPx)
    ctx.rotate(((cut.rotate + letterTilt(scene.wobbles, letter.src, t - timing.typedEnd)) * Math.PI) / 180)
    ctx.scale(pop * cut.scaleX, pop * cut.scaleY)
    letterShadow(ctx, layout.fontPx)
    ctx.fillText(letter.ch, 0, 0)
    ctx.restore()
  }
  if (layout.ja) {
    const shown = Math.min(1, Math.max(0, (t - timing.jaAt) / OPENING_JA_FADE_S))
    if (shown > 0) {
      ctx.save()
      ctx.globalAlpha = shown
      ctx.font = cardJaFont(layout.ja.fontPx)
      const { lines, y, step, fontPx } = layout.ja
      lines.forEach((line, row) => fillJaWithShadow(ctx, line, width / 2, y + row * step, fontPx))
      ctx.restore()
    }
  }
  ctx.restore()
}

/**
 * How to draw `plan`'s card: laid out once for `measure` at `width` ×
 * `height` (the video's size; scale the context for a smaller canvas), then
 * one call per frame. The night sky, or the 暖簾 for a plan that says so
 * (or made before there was a choice).
 */
export function openingCardDrawer(
  plan: OpeningCardPlan,
  width: number,
  height: number,
  measure: (text: string, font: string) => number,
): (ctx: Ctx, background: CanvasImageSource | null, t: number) => void {
  if (plan.style === 'stars') {
    const scene = starsSceneOf(plan.text, layoutStarsOpening(plan.text, width, height, measure, plan.ja), plan.timing)
    return (ctx, background, t) => drawStarsOpening(ctx, background, scene, t, width, height)
  }
  const layout = layoutOpening(plan.text, width, height, measure, plan.ja)
  return (ctx, background, t) => drawOpeningCard(ctx, background, layout, plan.timing, t)
}
