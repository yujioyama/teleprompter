/**
 * Which shots get a fairy: a small cameo of a middle line's emoji, and the
 * finale where the first line's emoji comes back in the last shot. Planned
 * once for the whole video in absolute time, so the preview and the burns
 * draw the same fairies; `fairiesForShot` re-times them for one shot.
 */

import { random } from './seededRandom'
import { cameoBursts, cameoHover, cameoPath, CAMEO_LENGTHS, END_MARGIN, FAIRY_MOTIONS, finalePath, finaleTiming } from './fairyMotion'
import { emitSparkles, type Sparkle } from './sparkles'
import { stickerSeed, type StickerPath } from './stickerMotion'
import type { HookOptions } from './subtitleHook'
import { DEFAULT_STICKER_PLACEMENT, findSticker, STICKER_EMOJI_PX, STICKER_PLACEMENTS } from './subtitleSticker'

/** A cameo is drawn this much smaller than the sticker. */
export const FAIRY_SCALE = 0.62

/** A cameo starts this long into its shot, and nothing outlasts its shot minus END_MARGIN (fairyMotion). */
const CAMEO_DELAY = 0.3
/** A cameo squeezed below this is not worth showing. */
const MIN_CAMEO = 0.8

export interface FairyAppearance {
  emoji: string
  kind: 'cameo' | 'finale'
  /** Absolute seconds in the video (shot-relative after `fairiesForShot`). */
  start: number
  end: number
  /** Takes the same time base as start and end. */
  path: StickerPath
  scale: number
  sparkles: Sparkle[]
  /** Identifies the appearance, so a consumer can cache its sprite or sparkles. */
  key: string
}

/** The sprite is about STICKER_EMOJI_PX wide at scale 1 on a 1080 frame; the sparkles spread around its radius. */
const spreadOf = (scale: number) => (0.5 * STICKER_EMOJI_PX * scale) / 1080

/** The times are relative to the appearance's shot, so re-trimming an earlier shot doesn't re-key (and re-encode) the later ones. */
const keyOf = (kind: string, emoji: string, motion: string, mirror: boolean, start: number, end: number, seed: number) =>
  JSON.stringify([kind, emoji, motion, mirror, start.toFixed(3), end.toFixed(3), seed])

/** The finale keeps this far (frame heights) from the normal subtitles' center, about the sprite's height plus its bob and burst. */
const FINALE_SUBTITLE_CLEARANCE = 0.15
/** Where the finale may hover, whatever the subtitles do. */
const FINALE_Y = { min: 0.27, max: 0.75 }

/** The finale's home y, moved to the clear side of the normal subtitles (`subtitleY`, 0-1) when it would sit on them. */
function clearOfSubtitles(homeY: number, subtitleY: number): number {
  const y = Math.abs(homeY - subtitleY) < FINALE_SUBTITLE_CLEARANCE ? subtitleY + (subtitleY >= homeY ? -1 : 1) * FINALE_SUBTITLE_CLEARANCE : homeY
  return Math.min(FINALE_Y.max, Math.max(FINALE_Y.min, y))
}

export function planFairies(
  shots: { text: string; duration: number }[],
  hook: Pick<HookOptions, 'style' | 'sticker' | 'stickerRoute' | 'fairies'>,
  /** Where the normal subtitles are centered, 0-100 (the finale keeps clear of them). */
  position: number,
): FairyAppearance[] {
  const placement = hook.sticker ?? DEFAULT_STICKER_PLACEMENT
  if (hook.fairies === false || placement === 'off' || shots.length === 0) return []
  const route = hook.stickerRoute ?? 0
  const plan: FairyAppearance[] = []

  let shotStart = 0
  shots.forEach((shot, i) => {
    const start0 = shotStart
    shotStart += shot.duration
    if (i === 0 || i === shots.length - 1) return
    const emoji = findSticker(shot.text)
    if (!emoji) return

    const seed = stickerSeed(shot.text, route)
    const rand = random(seed)
    const motion = FAIRY_MOTIONS[Math.floor(rand() * FAIRY_MOTIONS.length)]
    const mirror = rand() < 0.5

    const available = shot.duration - CAMEO_DELAY - END_MARGIN
    const nominal = CAMEO_LENGTHS[motion]
    // The epsilon: 1.2 - 0.3 - 0.1 is 0.7999999999999999 in floating point.
    if (available < MIN_CAMEO - 1e-9) return
    const length = Math.min(nominal, available)

    const start = start0 + CAMEO_DELAY
    const end = start + length
    const local = cameoPath(motion, length, mirror)
    const path: StickerPath = t => local(t - start)
    const hover = cameoHover(motion, length)
    plan.push({
      emoji,
      kind: 'cameo',
      start,
      end,
      path,
      scale: FAIRY_SCALE,
      sparkles: emitSparkles({
        path,
        start,
        end,
        seed,
        spread: spreadOf(FAIRY_SCALE),
        bursts: cameoBursts(motion, length).map(b => start + b),
        moving: t => !(hover && t >= start + hover[0] && t < start + hover[1]),
      }),
      key: keyOf('cameo', emoji, motion, mirror, CAMEO_DELAY, CAMEO_DELAY + length, seed),
    })
  })

  // With the hook style off there is no first-shot sticker to bring back.
  const finale = hook.style ? planFinale(shots, placement, route, shotStart, position / 100) : null
  if (finale) plan.push(finale)
  return plan
}

function planFinale(
  shots: { text: string; duration: number }[],
  placement: Exclude<NonNullable<HookOptions['sticker']>, 'off'>,
  route: number,
  total: number,
  subtitleY: number,
): FairyAppearance | null {
  if (shots.length < 2) return null
  const emoji = findSticker(shots[0].text)
  const last = shots[shots.length - 1]
  const timing = finaleTiming(last.duration)
  if (!emoji || !timing) return null

  const home = STICKER_PLACEMENTS[placement]
  const y = clearOfSubtitles(home.y / 100, subtitleY)
  const local = finalePath({ x: home.x, y, rotation: home.rotation }, timing)
  const start = total - last.duration
  const length = timing.fly + timing.hover + timing.burst
  const end = start + length
  const path: StickerPath = t => local(t - start)
  const seed = stickerSeed(last.text, route)
  return {
    emoji,
    kind: 'finale',
    start,
    end,
    path,
    scale: 1,
    sparkles: emitSparkles({
      path,
      start,
      end,
      seed,
      spread: spreadOf(1),
      bursts: [start + timing.fly, start + timing.fly + timing.hover],
      moving: t => t < start + timing.fly,
    }),
    key: keyOf('finale', emoji, `${placement}@${y.toFixed(3)}`, false, 0, length, seed),
  }
}

/** The appearances inside one shot, moved onto the shot's own timeline (0 = its first frame). */
export function fairiesForShot(plan: FairyAppearance[], shotStart: number, shotDuration: number): FairyAppearance[] {
  return plan
    .filter(f => f.start >= shotStart - 1e-6 && f.end <= shotStart + shotDuration + 1e-6)
    .map(f => ({
      ...f,
      start: f.start - shotStart,
      end: f.end - shotStart,
      path: t => f.path(t + shotStart),
      sparkles: f.sparkles.map(s => ({ ...s, born: s.born - shotStart })),
    }))
}
