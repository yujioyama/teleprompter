/**
 * The fairies' routes. A cameo is a small sticker that crosses a middle
 * shot (glide, peek or loop); the finale is the last shot's fairy that
 * flies to the first shot's sticker spot, hovers and bursts. Scales here
 * are relative (1 = normal): the consumers apply the fairy's drawn size.
 */

import { clamp, easeInOut, lerp } from './stickerMotion'
import type { Home, StickerPath, StickerPose } from './stickerMotion'

export type FairyMotion = 'glide' | 'peek' | 'loop'
export const FAIRY_MOTIONS: FairyMotion[] = ['glide', 'peek', 'loop']

/** Seconds each cameo takes at its nominal length. */
export const CAMEO_LENGTHS: Record<FairyMotion, number> = { glide: 1.2, peek: 1.6, loop: 1.4 }

const easeOut = (s: number) => 1 - (1 - s) ** 2
const easeIn = (s: number) => s * s
/** Local time `t` as 0-1 progress through the phase [from, to], held at the ends. */
const phase = (t: number, from: number, to: number) => clamp((t - from) / (to - from), 0, 1)

// Each cameo below is written for its nominal length, for the left entry.

// ふわっと横切る: a gentle diagonal across, waving as it goes. Stays above y = 0.5 on the right.
const glide: StickerPath = t => {
  const s = phase(t, 0, CAMEO_LENGTHS.glide)
  return {
    x: lerp(-0.1, 1.1, s),
    y: lerp(0.66, 0.3, s) + 0.035 * Math.sin(Math.PI * 4 * s),
    rotation: 12 * Math.sin(Math.PI * 4 * t),
    scale: 1,
  }
}

/** Where the peek stops to look, and how long it flies in and zips out. */
const PEEK = { x: 0.22, y: 0.52, fly: 0.45, hoverEnd: 1.15, end: CAMEO_LENGTHS.peek }

// ひょっこり顔を出す: flies in, hovers with a bob, zips up and out, off the top.
const peek: StickerPath = t => {
  if (t < PEEK.fly) {
    const e = easeOut(phase(t, 0, PEEK.fly))
    return { x: lerp(-0.1, PEEK.x, e), y: lerp(0.58, PEEK.y, e), rotation: lerp(-20, 0, e), scale: lerp(0.7, 1, e) }
  }
  if (t < PEEK.hoverEnd) {
    // Two bobs over the hover, so it is back at rest in the middle of it and at both ends.
    const bob = Math.sin(Math.PI * 4 * phase(t, PEEK.fly, PEEK.hoverEnd))
    return { x: PEEK.x, y: PEEK.y + 0.02 * bob, rotation: 8 * bob, scale: 1 + 0.06 * bob }
  }
  const e = easeIn(phase(t, PEEK.hoverEnd, PEEK.end))
  return { x: lerp(PEEK.x, 0.1, e), y: lerp(PEEK.y, -0.1, e), rotation: lerp(0, -15, e), scale: lerp(1, 0.7, e) }
}

/** The loop: where it arrives, the ellipse it circles, and when each phase ends. */
const LOOP = { x: 0.22, y: 0.6, cx: 0.22, cy: 0.52, rx: 0.09, ry: 0.08, enter: 0.4, around: 1.0, end: CAMEO_LENGTHS.loop }

// くるりんと一回転: arrives at the bottom of a small ellipse, goes round it once while spinning, leaves up to the right.
const loop: StickerPath = t => {
  if (t < LOOP.enter) {
    const e = easeOut(phase(t, 0, LOOP.enter))
    return { x: lerp(-0.1, LOOP.x, e), y: LOOP.y, rotation: 0, scale: lerp(1, 1.1, e) }
  }
  if (t < LOOP.around) {
    const s = easeInOut(phase(t, LOOP.enter, LOOP.around))
    // From the bottom, to the right first (the way it came), once round and back to the bottom.
    const a = Math.PI / 2 - Math.PI * 2 * s
    return { x: LOOP.cx + LOOP.rx * Math.cos(a), y: LOOP.cy + LOOP.ry * Math.sin(a), rotation: -360 * s, scale: 1.1 }
  }
  // The straight line to (1.12, 0.35) is under y = 0.5 wherever x > 0.7.
  const e = easeIn(phase(t, LOOP.around, LOOP.end))
  return { x: lerp(LOOP.x, 1.12, e), y: lerp(LOOP.y, 0.35, e), rotation: 0, scale: lerp(1.1, 1, e) }
}

const LEFT: Record<FairyMotion, StickerPath> = { glide, peek, loop }

/** Peek and loop, entered from the right: mirrored, and lifted clear of the button column. */
const mirrored = (path: StickerPath): StickerPath => t => {
  const p = path(t)
  return { ...p, x: 1 - p.x, y: p.y - 0.16, rotation: -p.rotation }
}

/**
 * A cameo over `length` seconds of its own time (0 … length): the nominal
 * route, time-compressed when the shot leaves less room. `mirror` enters
 * from the right instead of the left.
 */
export function cameoPath(motion: FairyMotion, length: number, mirror: boolean): StickerPath {
  const nominal = CAMEO_LENGTHS[motion]
  const left = LEFT[motion]
  const base: StickerPath = !mirror ? left : motion === 'glide' ? t => left(nominal - t) : mirrored(left)
  return t => base((t * nominal) / length)
}

/** When the cameo bursts into sparkles (its own time): peek does as it zips away. */
export function cameoBursts(motion: FairyMotion, length: number): number[] {
  return motion === 'peek' ? [PEEK.hoverEnd * (length / CAMEO_LENGTHS.peek)] : []
}

/** The stretch (its own time) where the cameo hovers still, or null if it never does. */
export function cameoHover(motion: FairyMotion, length: number): [number, number] | null {
  if (motion !== 'peek') return null
  const k = length / CAMEO_LENGTHS.peek
  return [PEEK.fly * k, PEEK.hoverEnd * k]
}

export interface FinaleTiming {
  fly: number
  hover: number
  burst: number
}

const FINALE_FLY = 0.6
const FINALE_BURST = 0.3
const END_MARGIN = 0.1
/** The shortest hover, when the shot is too short for the full fly-in. */
const SHORT_HOVER = 0.2

/** How the finale's three phases fit a last shot of `duration` seconds, ending END_MARGIN before the cut. Null under 1 s. */
export function finaleTiming(duration: number): FinaleTiming | null {
  if (duration < 1.0) return null
  if (duration < 1.2) return { fly: duration - FINALE_FLY, hover: SHORT_HOVER, burst: FINALE_BURST }
  return { fly: FINALE_FLY, hover: duration - FINALE_FLY - FINALE_BURST - END_MARGIN, burst: FINALE_BURST }
}

/**
 * The finale fairy over `fly + hover + burst` seconds of its own time:
 * flies in from the side edge nearer `home` (the left for a centered one), hovers there and bursts
 * (bigger, fading out).
 */
export function finalePath(home: Home, timing: FinaleTiming): StickerPath {
  // A centered home enters from the left: from the right, a low home like the chest would cross the button column.
  const fromX = home.x <= 0.5 ? -0.1 : 1.1
  const burstStart = timing.fly + timing.hover
  return (t): StickerPose => {
    if (t < timing.fly) {
      const e = easeOut(phase(t, 0, timing.fly))
      return { x: lerp(fromX, home.x, e), y: lerp(home.y - 0.22, home.y, e), rotation: lerp(-25, home.rotation, e), scale: lerp(0.6, 1, e) }
    }
    if (t < burstStart) {
      const u = t - timing.fly
      return { x: home.x, y: home.y + 0.012 * Math.sin(u * 5), rotation: home.rotation + 5 * Math.sin(u * 4), scale: 1 }
    }
    const b = phase(t, burstStart, burstStart + timing.burst)
    return { x: home.x, y: home.y, rotation: home.rotation, scale: lerp(1, 1.4, b), opacity: 1 - b }
  }
}
