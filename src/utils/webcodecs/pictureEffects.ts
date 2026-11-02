import type { VideoSample } from 'mediabunny'
import { ZOOM_ANCHOR_Y } from '../subtitleHook'
import { letterboxHeight, type OpeningLook } from '../openingLook'

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

/** The opening look's black bars over the picture already drawn on `ctx` (before the subtitles). */
export function drawOpening(ctx: Ctx, t: number, look: OpeningLook, width: number, height: number): void {
  const bar = Math.round(letterboxHeight(t, look) * height)
  if (bar > 0) {
    ctx.save()
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, bar)
    ctx.fillRect(0, height - bar, width, bar)
    ctx.restore()
  }
}
