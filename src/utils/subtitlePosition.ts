/** Percent of video height (0-100) marking the overlay's vertical anchor point. */
export type SubtitlePosition = number

/**
 * Preset percent values reproducing the exact pixel positions the old
 * top/center/bottom 3-value enum produced, at the production reference
 * geometry (VIDEO_HEIGHT=1920, OVERLAY_HEIGHT=220 in burnSubtitles.ts):
 * old top = round(1920*0.08) = 154, old center = round((1920-220)/2) = 850,
 * old bottom = round(1920*0.78-220) = 1278. Solving y = round(H*p/100 - overlayHeight/2)
 * for p at H=1920, overlayHeight=220 gives the constants below.
 */
export const SUBTITLE_POSITION_TOP = 13.75
export const SUBTITLE_POSITION_CENTER = 50
export const SUBTITLE_POSITION_BOTTOM = 72.2917

/** Pure: compute the overlay's Y coordinate for a vertical position percent (0-100). */
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number {
  return Math.round((videoHeight * position) / 100 - overlayHeight / 2)
}
