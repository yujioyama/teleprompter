/** Percent of video height (0-100) marking the overlay's vertical anchor point. */
export type SubtitlePosition = number

/**
 * Preset percent values reproducing the exact pixel positions the old
 * top/center/bottom 3-value enum produced, at the production reference
 * geometry (VIDEO_HEIGHT=1920, and the old fixed 220px overlay height):
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

/** Height of the output video that subtitle positions are measured on. */
export const SUBTITLE_VIDEO_HEIGHT = 1920

/**
 * The position (0-100) moved just enough that an overlay `overlayHeight`
 * tall, centered on it, stays fully on screen.
 */
export function clampedSubtitlePosition(
  position: SubtitlePosition,
  overlayHeight: number,
  videoHeight = SUBTITLE_VIDEO_HEIGHT,
): SubtitlePosition {
  const half = (overlayHeight / 2 / videoHeight) * 100
  return Math.min(Math.max(position, half), 100 - half)
}

/** Top of an overlay on the output video, kept so all of it stays on screen. */
export function clampedSubtitleY(
  position: SubtitlePosition,
  overlayHeight: number,
  videoHeight = SUBTITLE_VIDEO_HEIGHT,
): number {
  return subtitleY(clampedSubtitlePosition(position, overlayHeight, videoHeight), videoHeight, overlayHeight)
}

/** The one-tap positions offered next to the fine-tune slider. */
export const SUBTITLE_POSITION_PRESETS: { label: string; value: SubtitlePosition }[] = [
  { label: '上部', value: SUBTITLE_POSITION_TOP },
  { label: '中央', value: SUBTITLE_POSITION_CENTER },
  { label: '下部', value: SUBTITLE_POSITION_BOTTOM },
]
