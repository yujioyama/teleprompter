import type { VideoSample } from 'mediabunny'
import { ZOOM_ANCHOR_Y } from '../subtitleHook'

/**
 * The first shot's zoom, drawn with OffscreenCanvas 2D only (no WebGL).
 * Subtitles are composited afterwards by the caller and never get it.
 */

type Ctx = OffscreenCanvasRenderingContext2D

/** Draw the frame zoomed by `scale` about (50%, ZOOM_ANCHOR_Y). */
export function drawZoomed(ctx: Ctx, sample: VideoSample, scale: number, width: number, height: number): void {
  const w = width * scale
  const h = height * scale
  sample.draw(ctx, (width - w) / 2, ZOOM_ANCHOR_Y * (height - h), w, h)
}
