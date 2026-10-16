/**
 * The first shot's sticker can go on a trip: it leaves its spot on the
 * first frame, travels around the picture and is back home, with a little
 * pop, before the first shot ends. The route is random but fixed per video
 * (seeded from the sticker's cue text and a re-roll counter), so the
 * preview and every burn of the same video move it the same way.
 */

import type { HookOptions } from './subtitleHook'
import { hash, random } from './seededRandom'
import { emitSparkles, type Sparkle } from './sparkles'
import { DEFAULT_STICKER_PLACEMENT, STICKER_EMOJI_PX, STICKER_PLACEMENTS, findSticker } from './subtitleSticker'

export type StickerMotion = 'none' | 'random' | 'wander' | 'bounce' | 'orbit' | 'warp' | 'dash'
/** The motions おまかせ ('random') picks from. */
export const STICKER_TRIPS: Exclude<StickerMotion, 'none' | 'random'>[] = ['wander', 'bounce', 'orbit', 'warp', 'dash']
export const DEFAULT_STICKER_MOTION: StickerMotion = 'random'

/** Where the sticker is: x and y as fractions of the frame, rotation in degrees, scale 1 = its normal size, opacity 1 (the default) = fully visible. */
export interface StickerPose {
  x: number
  y: number
  rotation: number
  scale: number
  opacity?: number
}

export type StickerPath = (t: number) => StickerPose

/** The biggest scale any path reaches, so the sprite can be drawn sharp at it. */
export const STICKER_MAX_SCALE = 1.4

/** Seconds at the end of the first shot for the landing pop at home. */
const LANDING = 0.4
/** Below this much travel time the sticker just stays put. */
const MIN_TRAVEL = 0.8

/** The face the orbit goes around (zoom anchor height, a little lower). */
const ORBIT_CENTER = { x: 0.5, y: 0.45 }
const ORBIT_RADIUS = { x: 0.32, y: 0.22 }

/**
 * Where the trip may go: clear of the hook subtitle at the top, the
 * bottom edge, and the TikTok/Reels button column at the lower right.
 */
export const AREA = { left: 0.18, right: 0.82, top: 0.27, bottom: 0.75 }
export const inButtonColumn = (p: { x: number; y: number }) => p.x > 0.7 && p.y > 0.5
/** Around the face (the zoom anchor): fine to pass over, not to stop on. */
export const onFace = (p: { x: number; y: number }) => ((p.x - 0.5) / 0.22) ** 2 + ((p.y - 0.4) / 0.15) ** 2 < 1
/** The bouncing box, a bit wider so a home on the edge is inside it. */
const BOUNCE_BOX = { left: 0.16, right: 0.84, top: 0.27, bottom: 0.72 }
/** Fractions of the width per second; y is scaled by the frame's aspect so both look as fast. */
const BOUNCE_SPEED = 1.3
export const ASPECT = 1080 / 1920

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, s: number) => a + (b - a) * s
export const easeInOut = (s: number) => (s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2)

/** The route's seed: the sticker's cue text, re-rolled by ルートを変える (`route`). */
export function stickerSeed(cueText: string, route: number): number {
  return hash(`${route}|${cueText}`)
}

interface Point {
  x: number
  y: number
}

/** `count` stops inside AREA, off the face, each clear of home and of the stop before it. */
function stops(rand: () => number, home: Point, count: number): Point[] {
  const out: Point[] = []
  let last = home
  for (let i = 0; i < count; i++) {
    let p: Point = { x: 0.5, y: 0.5 }
    for (let tries = 0; tries < 40; tries++) {
      p = { x: lerp(AREA.left, AREA.right, rand()), y: lerp(AREA.top, AREA.bottom, rand()) }
      if (!inButtonColumn(p) && !onFace(p) && Math.hypot(p.x - home.x, p.y - home.y) > 0.15 && Math.hypot(p.x - last.x, p.y - last.y) > 0.2) break
    }
    out.push(p)
    last = p
  }
  return out
}

/** Catmull-Rom through `points` at `s` (0-1), the ends held by repeating them. */
function spline(points: Point[], s: number): Point {
  const n = points.length - 1
  const f = clamp(s, 0, 1) * n
  const i = Math.min(Math.floor(f), n - 1)
  const u = f - i
  const p = (k: number) => points[clamp(k, 0, n)]
  const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)]
  const axis = (k: 'x' | 'y') =>
    0.5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u)
  return { x: axis('x'), y: axis('y') }
}

/** Fold an unbounded coordinate back into [lo, hi], as if bouncing off both walls. */
function fold(v: number, lo: number, hi: number): number {
  const span = hi - lo
  const m = (((v - lo) % (2 * span)) + 2 * span) % (2 * span)
  return lo + (m <= span ? m : 2 * span - m)
}

export type Home = Point & { rotation: number }
/** One trip over the travel time: `s` 0→1, starting and ending exactly at home. */
type Trip = (s: number) => StickerPose
type TripMaker = (rand: () => number, home: Home, travel: number) => Trip

const TRIPS: Record<(typeof STICKER_TRIPS)[number], TripMaker> = {
  // 気まぐれ旅: a smooth wander through a few stops, leaning into the way it goes.
  wander: (rand, home, travel) => {
    const route = [home, ...stops(rand, home, clamp(Math.round(travel / 0.7), 2, 5)), home]
    return s => {
      const p = spline(route, s)
      const ahead = spline(route, s + 0.01)
      const speed = (ahead.x - p.x) / 0.01 / travel
      return { ...p, rotation: home.rotation + clamp(speed * 25, -35, 35) * Math.sin(Math.PI * s), scale: 1 }
    }
  },
  // DVD反射: a straight line off the walls, spinning, steered home over the last stretch.
  bounce: (rand, home, travel) => {
    const angle = rand() * Math.PI * 2
    const spins = Math.max(1, Math.round(travel / 1.2)) * (rand() < 0.5 ? -1 : 1)
    return s => {
      const d = BOUNCE_SPEED * travel * s
      const x = fold(home.x + Math.cos(angle) * d, BOUNCE_BOX.left, BOUNCE_BOX.right)
      const y = fold(home.y + Math.sin(angle) * d * ASPECT, BOUNCE_BOX.top, BOUNCE_BOX.bottom)
      const back = easeInOut(clamp((s - 0.7) / 0.3, 0, 1))
      return { x: lerp(x, home.x, back), y: lerp(y, home.y, back), rotation: home.rotation + 360 * spins * s, scale: 1 }
    }
  },
  // 周回: around the face, bigger when it swings in front (lower), smaller behind.
  orbit: (rand, home, travel) => {
    const dx = (home.x - ORBIT_CENTER.x) / ORBIT_RADIUS.x
    const dy = (home.y - ORBIT_CENTER.y) / ORBIT_RADIUS.y
    const reach = Math.hypot(dx, dy) || 1
    const start = Math.atan2(dy, dx)
    const turns = (travel >= 2.4 ? 2 : 1) * (rand() < 0.5 ? -1 : 1)
    const depth = (a: number) => Math.sin(a) - Math.sin(start)
    return s => {
      const a = start + Math.PI * 2 * turns * easeInOut(s)
      return {
        x: ORBIT_CENTER.x + reach * ORBIT_RADIUS.x * Math.cos(a),
        y: ORBIT_CENTER.y + reach * ORBIT_RADIUS.y * Math.sin(a),
        rotation: home.rotation + 14 * depth(a),
        scale: 1 + 0.3 * depth(a),
      }
    }
  },
  // ワープ: shrinks away and pops up somewhere else, a few times, the last time at home.
  warp: (rand, home, travel) => {
    const route = [home, ...stops(rand, home, clamp(Math.floor(travel / 0.55), 1, 5)), home]
    const tilts = route.map((_, i) => (i === 0 || i === route.length - 1 ? 0 : (rand() - 0.5) * 50))
    const legs = route.length - 1
    return s => {
      const f = clamp(s, 0, 1) * legs
      const i = Math.min(Math.floor(f), legs - 1)
      const u = f - i
      if (u < 0.8) return { ...route[i], rotation: home.rotation + tilts[i], scale: 1 }
      if (u < 0.9) return { ...route[i], rotation: home.rotation + tilts[i], scale: (0.9 - u) / 0.1 }
      return { ...route[i + 1], rotation: home.rotation + tilts[i + 1], scale: (u - 0.9) / 0.1 }
    }
  },
  // ちょこまか: dash, stop and wiggle, dash again.
  dash: (rand, home, travel) => {
    const route = [home, ...stops(rand, home, clamp(Math.round(travel / 0.6), 2, 6)), home]
    const legs = route.length - 1
    return s => {
      const f = clamp(s, 0, 1) * legs
      const i = Math.min(Math.floor(f), legs - 1)
      const u = f - i
      const [a, b] = [route[i], route[i + 1]]
      if (u < 0.35) {
        const e = easeInOut(u / 0.35)
        const lean = Math.sign(b.x - a.x) * 28 * Math.sin((Math.PI * u) / 0.35)
        return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), rotation: home.rotation + lean, scale: 1 }
      }
      const wiggle = 7 * Math.sin(u * 45) * Math.sin((Math.PI * (u - 0.35)) / 0.65)
      return { ...b, rotation: home.rotation + wiggle, scale: 1 }
    }
  },
}

/** The trip a motion makes: おまかせ picks one by the seed, so the same video always gets the same one. */
export function stickerTrip(motion: StickerMotion, seed: number): (typeof STICKER_TRIPS)[number] | null {
  if (motion === 'none') return null
  if (motion !== 'random') return motion
  return STICKER_TRIPS[Math.floor(random(hash(`trip|${seed}`))() * STICKER_TRIPS.length)]
}

/**
 * The sticker's path over the first shot (`duration` seconds), from and
 * back to `home` (x, y as fractions of the frame). Null when it doesn't
 * move: motion 'none', or a first shot too short for a trip.
 */
export function stickerPath(motion: StickerMotion, seed: number, home: Home, duration: number): StickerPath | null {
  const travel = duration - LANDING
  const kind = stickerTrip(motion, seed)
  if (kind === null || travel < MIN_TRAVEL) return null
  const trip = TRIPS[kind](random(seed), home, travel)
  return t => {
    if (t < travel) return trip(Math.max(0, t) / travel)
    // The landing pop: up past its size, a small dip, settled by the cut.
    const u = clamp((t - travel) / LANDING, 0, 1)
    return { x: home.x, y: home.y, rotation: home.rotation, scale: 1 + 0.32 * Math.sin(Math.PI * 2 * u) * (1 - u) }
  }
}

/** The first shot's sticker as placed: its emoji, its spot, its trip (null = it stays put) and its sparkles. */
export interface PlacedSticker {
  emoji: string
  home: Home
  path: StickerPath | null
  /** Over [0, firstShotDuration], all gone by its end; they follow the sticker. */
  sparkles: Sparkle[]
}

/**
 * The sticker the burn and the preview both show: the first hook cue's
 * emoji (translated cues only, as burned) at `placement`, moving as
 * `motion` says over the first shot. Null without one, with placement
 * 'off', or for a video that doesn't start with the first shot. Its
 * sparkles trail the trip and burst at the landing, or twinkle when still.
 */
export function placeSticker(
  cues: { en: string; ja: string | null; variant: string }[],
  hook: Pick<HookOptions, 'sticker' | 'stickerMotion' | 'stickerRoute'>,
  firstShotDuration: number | null,
): PlacedSticker | null {
  const placement = hook.sticker ?? DEFAULT_STICKER_PLACEMENT
  if (firstShotDuration === null || placement === 'off') return null
  const cue = cues.find(c => c.ja !== null && c.variant === 'hook' && findSticker(c.en) !== null)
  if (!cue) return null
  const at = STICKER_PLACEMENTS[placement]
  const home = { x: at.x, y: at.y / 100, rotation: at.rotation }
  const seed = stickerSeed(cue.en, hook.stickerRoute ?? 0)
  const path = stickerPath(hook.stickerMotion ?? DEFAULT_STICKER_MOTION, seed, home, firstShotDuration)
  const landing = firstShotDuration - LANDING
  // Without a path the sticker never moves, so it only twinkles; a burst would have nothing to land.
  const sparkles = emitSparkles({
    path: path ?? (() => ({ x: home.x, y: home.y, rotation: home.rotation, scale: 1 })),
    start: 0,
    end: firstShotDuration,
    seed: hash(`sparkles|${seed}`),
    spread: (0.5 * STICKER_EMOJI_PX) / 1080,
    bursts: path ? [landing] : [],
    moving: t => path !== null && t < landing,
  })
  return { emoji: findSticker(cue.en)!, home, path, sparkles }
}
