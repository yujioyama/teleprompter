import type { CinemaLook } from '../../shared/cinemaLook'
import {
  buildLut,
  dustSpecs,
  glitchParams,
  glitchPixels,
  gradePixels,
  grainNoise,
  GRAIN_HEIGHT,
  GRAIN_WIDTH,
  LOOK_GRAIN,
  LOOK_HAS_DUST,
  DUST_OPACITY,
  lookStep,
  releaseLookTables,
  vignetteMask,
  type DustSpec,
} from './cinemaLook'

/**
 * Draws a film look over the picture already on a 2D canvas (2026-11-03). The
 * preview's canvas and the burn's OffscreenCanvas both call it, so the two
 * agree; the math is in cinemaLook.ts.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

/**
 * The width the pixels are graded at. A fixed width, not a fraction of the
 * frame: the glitch's scanlines are 2 px at 540 wide, so the 540 preview and
 * the 1080 burn must both process at 540 (the burn scales its result up) or
 * the preview would show something other than what is burned. Narrower frames
 * are not scaled up. 540 also kept every look under 12 ms a frame on a Mac.
 */
export const LOOK_PROCESS_WIDTH = 540

/** The grain and dust are cycled over this many frames, as in the reference. */
const GRAIN_FRAMES = 6

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const context = (canvas: AnyCanvas, readBack: boolean) =>
  canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined) as Ctx

interface Scratch {
  canvas: AnyCanvas
  ctx: Ctx
  /** Where the glitch writes, so it can read the picture while it does. */
  out: ImageData
}

/** One per size: the burn (1080×1920) and the subtitle preview (540×960) draw at the same time. */
const scratches = new Map<string, Scratch>()

/** The picture's copy to read pixels from; kept between frames. */
function scratchFor(width: number, height: number): Scratch {
  const key = `${width}x${height}`
  let work = scratches.get(key)
  if (!work) {
    const canvas = createCanvas(width, height)
    const ctx = context(canvas, true)
    work = { canvas, ctx, out: ctx.createImageData(width, height) }
    scratches.set(key, work)
  }
  return work
}

const grainCanvases: AnyCanvas[] = []

function grainCanvas(frame: number): AnyCanvas {
  let canvas = grainCanvases[frame]
  if (!canvas) {
    canvas = createCanvas(GRAIN_WIDTH, GRAIN_HEIGHT)
    const ctx = context(canvas, false)
    const image = ctx.createImageData(GRAIN_WIDTH, GRAIN_HEIGHT)
    image.data.set(grainNoise(frame))
    ctx.putImageData(image, 0, 0)
    grainCanvases[frame] = canvas
  }
  return canvas
}

const dustCache = new Map<string, DustSpec[]>()

function dustFor(frame: number, width: number, height: number): DustSpec[] {
  const key = `${frame}:${width}x${height}`
  let specs = dustCache.get(key)
  if (!specs) {
    specs = dustSpecs(frame, width, height)
    dustCache.set(key, specs)
  }
  return specs
}

function drawDust(ctx: Ctx, specs: DustSpec[], height: number): void {
  for (const s of specs) {
    ctx.beginPath()
    if (s.kind === 'speck') {
      ctx.fillStyle = s.style
      ctx.ellipse(s.x, s.y, s.rx, s.ry, s.rotation, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = s.style
      ctx.lineWidth = s.lineWidth
      if (s.kind === 'hair') {
        const k = s.size
        ctx.moveTo(s.x, s.y)
        ctx.bezierCurveTo(s.x + 10 * k, s.y + 6 * k, s.x - 6 * k, s.y + 14 * k, s.x + 8 * k, s.y + 22 * k)
      } else {
        ctx.moveTo(s.x, 0)
        ctx.lineTo(s.x2, height)
      }
      ctx.stroke()
    }
  }
}

/**
 * Frees what the look keeps between frames (~17 MB: tables, scratch canvases,
 * masks, grain); the next draw rebuilds it. Called when the page that draws
 * looks goes away, since the iPhone has run out of memory before.
 */
export function releaseCinemaLookCaches(): void {
  // a zero size lets Safari free the canvas's backing store right away
  for (const work of scratches.values()) work.canvas.width = work.canvas.height = 0
  for (const canvas of grainCanvases) canvas.width = canvas.height = 0
  scratches.clear()
  grainCanvases.length = 0
  dustCache.clear()
  releaseLookTables()
}

/**
 * `drawCinemaLook` at a given processing scale (1 = the frame's own size);
 * split out so the scaled path can be tested at any size.
 */
export function drawCinemaLookAtScale(
  ctx: Ctx,
  look: CinemaLook,
  t: number,
  opacity: number,
  width: number,
  height: number,
  scale: number,
): void {
  if (opacity <= 0) return
  const alpha = Math.min(1, opacity)
  const step = lookStep(t)
  const pw = Math.max(1, Math.round(width * scale))
  const ph = Math.max(1, Math.round(height * scale))

  // Read the picture from a copy: getImageData on the caller's canvas would
  // pin it to the CPU (and `ctx` may be a burn's OffscreenCanvas).
  const work = scratchFor(pw, ph)
  work.ctx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, pw, ph)
  const picture = work.ctx.getImageData(0, 0, pw, ph)
  const mask = vignetteMask(pw, ph)
  let graded: ImageData
  if (look === 'glitch') {
    glitchPixels(picture.data, work.out.data, pw, ph, glitchParams(step, pw, ph), mask)
    graded = work.out
  } else {
    gradePixels(picture.data, pw, ph, buildLut(look), mask)
    graded = picture
  }
  work.ctx.putImageData(graded, 0, 0)

  const savedOp = ctx.globalCompositeOperation
  const savedAlpha = ctx.globalAlpha
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = alpha
  ctx.drawImage(work.canvas, 0, 0, pw, ph, 0, 0, width, height)

  const frame = step % GRAIN_FRAMES
  const grain = LOOK_GRAIN[look]
  if (grain > 0) {
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = Math.min(1, grain * 0.55) * alpha
    ctx.drawImage(grainCanvas(frame), 0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
  if (LOOK_HAS_DUST(look)) {
    ctx.globalAlpha = alpha * DUST_OPACITY
    drawDust(ctx, dustFor(frame, width, height), height)
  }

  ctx.globalCompositeOperation = savedOp
  ctx.globalAlpha = savedAlpha
}

/**
 * Expects the untouched picture on `ctx` (`width` × `height`); leaves it with
 * the look over it at `opacity`, so the opening's fade is the look's fade.
 * `t` (seconds) picks the grain, dust and glitch frame.
 */
export function drawCinemaLook(ctx: Ctx, look: CinemaLook, t: number, opacity: number, width: number, height: number): void {
  drawCinemaLookAtScale(ctx, look, t, opacity, width, height, Math.min(1, LOOK_PROCESS_WIDTH / width))
}
