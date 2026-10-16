/**
 * Sparkles: little four-point stars that trail a moving sticker, twinkle
 * around a still one and burst out of it. All the randomness is seeded and
 * drawn ahead of time into a list, so any frame can be drawn from `t` alone
 * and the preview and both burns draw the same particles.
 */

import { random } from './seededRandom'
import { ASPECT, type StickerPath } from './stickerMotion'

/** x, y are fractions of the frame, vx, vy fractions per second, radius px at 1080 width. */
export interface Sparkle {
  born: number
  life: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

const TRAIL_RATE = 120
const BURST_COUNT = 18
const TWINKLE_RATE = 7
/** Sampling step in seconds. */
const STEP = 1 / 120
/** Emission stops this long before the end, so a particle always has time to be seen. */
const TAIL = 0.1
const LIFE = { min: 0.4, max: 0.75 }
const RADIUS = { min: 10, max: 28 }
const BURST_SPEED = { min: 0.18, max: 0.4 }
/** Trail particles sink, in frame-heights per second. */
const TRAIL_DRIFT = 0.02
const TRAIL_SPREAD = 0.5
const TWINKLE_SPREAD = 0.7
const WHITE = '#FFFFFF'
const GOLD = '#FAC775'
const WHITE_SHARE = 0.55

export interface EmitOptions {
  /** Where the source is, in absolute time. */
  path: StickerPath
  start: number
  end: number
  seed: number
  /** The sprite's radius as a fraction of the frame width. */
  spread: number
  /** Absolute times of 18-particle bursts. */
  bursts: number[]
  /** Whether the source moves at t: trail while it does, twinkle while it doesn't. */
  moving: (t: number) => boolean
}

/** Every particle for one appearance, between `start` and `end`. */
export function emitSparkles({ path, start, end, seed, spread, bursts, moving }: EmitOptions): Sparkle[] {
  // A non-finite span would never reach `last` below.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  const rand = random(seed)
  const out: Sparkle[] = []
  const last = end - TAIL
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand()

  const add = (born: number, x: number, y: number, vx: number, vy: number) => {
    const life = Math.min(between(LIFE.min, LIFE.max), end - born)
    const radius = between(RADIUS.min, RADIUS.max)
    const color = rand() < WHITE_SHARE ? WHITE : GOLD
    if (life >= TAIL) out.push({ born, life, x, y, vx, vy, radius, color })
  }
  /** A particle spawned around the source within ±`reach` sprite radii (y scaled to look round). */
  const around = (born: number, reach: number, vy: number) => {
    const p = path(born)
    const dx = between(-1, 1) * reach * spread
    const dy = between(-1, 1) * reach * spread * ASPECT
    add(born, p.x + dx, p.y + dy, 0, vy)
  }

  // Sampled at step midpoints, so a step never lands exactly on a burst time.
  let trail = 0
  let twinkle = 0
  for (let k = 0; ; k++) {
    const t = start + (k + 0.5) * STEP
    if (t > last) break
    if (moving(t)) {
      trail += TRAIL_RATE * STEP
      for (; trail >= 1; trail -= 1) around(t, TRAIL_SPREAD, TRAIL_DRIFT)
    } else {
      twinkle += TWINKLE_RATE * STEP
      for (; twinkle >= 1; twinkle -= 1) around(t, TWINKLE_SPREAD, 0)
    }
  }

  for (const t of bursts) {
    if (t < start || t > last) continue
    const p = path(t)
    for (let i = 0; i < BURST_COUNT; i++) {
      const angle = rand() * Math.PI * 2
      const speed = between(BURST_SPEED.min, BURST_SPEED.max)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      // Born on the sprite's edge, not its center: sparkles draw under the sprite, so a burst from the middle never clears it.
      add(t, p.x + cos * spread, p.y + sin * spread * ASPECT, cos * speed, sin * speed * ASPECT)
    }
  }

  return out
}

/** Draws the sparkles alive at `t`, each a four-point concave star: four quadratic curves bending through the center. */
export function drawSparkles(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sparkles: Sparkle[],
  t: number,
  width: number,
  height: number,
): void {
  ctx.save()
  for (const s of sparkles) {
    if (t < s.born || t >= s.born + s.life) continue
    const age = t - s.born
    const u = age / s.life
    const r = s.radius * (width / 1080) * (1 - 0.7 * u) * (0.6 + 0.4 * Math.sin(age * 30))
    const cx = (s.x + s.vx * age) * width
    const cy = (s.y + s.vy * age) * height
    ctx.globalAlpha = 1 - u
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.quadraticCurveTo(cx, cy, cx + r, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy + r)
    ctx.quadraticCurveTo(cx, cy, cx - r, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy - r)
    ctx.fill()
  }
  ctx.restore()
}
