export type SubtitlePosition = 'top' | 'center' | 'bottom'

/** Pure: compute the overlay's Y coordinate for a given vertical position choice. */
export function subtitleY(position: SubtitlePosition, videoHeight: number, overlayHeight: number): number {
  switch (position) {
    case 'top':
      return Math.round(videoHeight * 0.08)
    case 'center':
      return Math.round((videoHeight - overlayHeight) / 2)
    case 'bottom':
      return Math.round(videoHeight * 0.78 - overlayHeight)
  }
}
