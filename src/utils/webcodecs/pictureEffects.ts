import type { VideoSample } from 'mediabunny'
import { ZOOM_ANCHOR_Y, type ImpactAmounts } from '../subtitleHook'

/**
 * The first shot's picture effects, drawn with OffscreenCanvas 2D only (no
 * WebGL): the snap zoom itself, and the impact effect riding on it — a
 * radial zoom blur plus an RGB split, for the few frames the impact lasts.
 * Subtitles are composited afterwards by the caller and never get these.
 */

type Ctx = OffscreenCanvasRenderingContext2D

/** Copies of the frame averaged into the zoom blur. */
export const BLUR_LAYERS = 5

// Each pass keeps one channel; red is shifted left, blue right.
const CHANNELS = [
  { color: '#f00', dir: -1 },
  { color: '#0f0', dir: 0 },
  { color: '#00f', dir: 1 },
] as const

/**
 * Draw the frame zoomed by `scale` about (50%, ZOOM_ANCHOR_Y), moved `dx`
 * px sideways. The zoomed picture overhangs the frame by (scale - 1) * width
 * / 2 on each side, so as long as |dx| stays within that overscan the shift
 * leaves no empty strip at the edge (drawImpactFrame clamps its shift to it).
 */
export function drawZoomed(ctx: Ctx, sample: VideoSample, scale: number, width: number, height: number, dx = 0): void {
  const w = width * scale
  const h = height * scale
  sample.draw(ctx, (width - w) / 2 + dx, ZOOM_ANCHOR_Y * (height - h), w, h)
}

/**
 * The zoom blur: BLUR_LAYERS copies, each a little more zoomed, layer j at
 * alpha 1/(j+1) so the stack is their even average and streaks outward
 * from the anchor.
 */
function drawBlurred(ctx: Ctx, sample: VideoSample, scale: number, spread: number, width: number, height: number, dx: number) {
  for (let j = 0; j < BLUR_LAYERS; j++) {
    ctx.globalAlpha = 1 / (j + 1)
    drawZoomed(ctx, sample, scale * (1 + (spread * j) / (BLUR_LAYERS - 1)), width, height, dx)
  }
  ctx.globalAlpha = 1
}

/**
 * One impact frame onto `ctx`: for each color channel, the blurred picture
 * is drawn onto `scratch` shifted for that channel, cut down to the channel
 * by multiplying with its pure color, and added onto `ctx` with `lighter`.
 * With no shift the three passes add back up to the plain blurred picture.
 */
export function drawImpactFrame(
  ctx: Ctx,
  scratch: Ctx,
  sample: VideoSample,
  scale: number,
  amounts: ImpactAmounts,
  width: number,
  height: number,
): void {
  const shift = Math.min(amounts.rgbShiftPx, ((scale - 1) * width) / 2)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  for (const channel of CHANNELS) {
    scratch.globalCompositeOperation = 'source-over'
    drawBlurred(scratch, sample, scale, amounts.blurSpread, width, height, channel.dir * shift)
    scratch.globalCompositeOperation = 'multiply'
    scratch.fillStyle = channel.color
    scratch.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(scratch.canvas, 0, 0)
  }
  scratch.globalCompositeOperation = 'source-over'
  ctx.globalCompositeOperation = 'source-over'
}
