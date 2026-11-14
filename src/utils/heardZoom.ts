/** 相手のセリフ: the listening picture's slow push-in. */

/**
 * While the other person talks, the listening face slowly moves closer,
 * this much per second of the clip, up to HEARD_ZOOM_MAX: a still face over
 * a long line reads as hanging, a slow push-in as listening closely.
 */
export const HEARD_ZOOM_PER_S = 0.025
export const HEARD_ZOOM_MAX = 1.1

/** How far in the listening ends up, for a clip of `seconds`. */
export function heardZoomTo(seconds: number): number {
  return Math.min(HEARD_ZOOM_MAX, 1 + HEARD_ZOOM_PER_S * Math.max(0, seconds))
}

/** The zoom at `progress` (0-1) through the clip: eased, so it starts and settles gently. */
export function slowZoomScale(progress: number, to: number): number {
  const p = Math.min(1, Math.max(0, progress))
  const eased = p * p * (3 - 2 * p)
  return 1 + (to - 1) * eased
}
