import type { VideoSample } from 'mediabunny'
import { impactAt, snapZoomScale, type PunchInPlan } from '../subtitleHook'
import { drawImpactFrame, drawZoomed } from './pictureEffects'

export interface SubtitleOverlay {
  start: number
  end: number
  image: Blob
  /** Top edge of the image in the output frame. */
  y: number
}

export interface OverlayOptions {
  /** The first shot's snap zoom and when it ends; null = never zoom. */
  punchIn?: PunchInPlan | null
}

export interface OverlayProcess {
  /** Mediabunny `video.process`: zooms the frame and composites the active cues onto it. */
  process: (sample: VideoSample) => VideoSample | OffscreenCanvas
  dispose: () => void
}

/**
 * Build a Mediabunny `video.process` callback that composites each cue's
 * pre-rendered PNG at (centered, its y) during [start, end), in the frame's
 * own timeline, over the picture with the first shot's snap zoom, plus the
 * impact effect (zoom blur and RGB split) during its first IMPACT_DURATION.
 * Only the picture gets these, the subtitles keep their size. Frames with no
 * active cue and no zoom are passed through untouched. Mediabunny calls this
 * after resizing to the output size. Call `dispose` once the conversion ends
 * to release the decoded images.
 */
export async function createOverlayProcess(
  overlays: SubtitleOverlay[],
  { punchIn = null }: OverlayOptions = {},
): Promise<OverlayProcess> {
  const bitmaps = await Promise.all(overlays.map(o => createImageBitmap(o.image)))
  const cues = overlays.map((o, i) => ({ start: o.start, end: o.end, y: o.y, bitmap: bitmaps[i] }))
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  // The impact effect's second canvas: made on its first frame and released
  // as soon as the effect is over, so it doesn't sit in a phone's memory for
  // the rest of the encode.
  let scratch: OffscreenCanvas | null = null
  let scratchCtx: OffscreenCanvasRenderingContext2D | null = null
  const releaseScratch = () => {
    if (!scratch) return
    scratch.width = 0
    scratch.height = 0
    scratch = null
    scratchCtx = null
  }

  return {
    process: (sample: VideoSample) => {
      // Midpoint of the frame, so a cue boundary that falls exactly on a
      // frame edge doesn't flicker on for a single extra frame.
      const t = sample.timestamp + sample.duration / 2
      const active = cues.filter(c => t >= c.start && t < c.end)
      const scale = punchIn ? snapZoomScale(t, punchIn.punchIn, punchIn.until) : 1
      const impact = punchIn ? impactAt(t, punchIn.punchIn, punchIn.until) : null
      if (active.length === 0 && scale === 1 && !impact) return sample
      const width = sample.displayWidth
      const height = sample.displayHeight
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height)
        ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
        // For the zoom's upscale of the picture.
        ctx.imageSmoothingQuality = 'high'
      }
      if (impact) {
        if (!scratch) {
          scratch = new OffscreenCanvas(width, height)
          scratchCtx = scratch.getContext('2d')
          if (!scratchCtx) throw new Error('OffscreenCanvas 2D context unavailable')
          scratchCtx.imageSmoothingQuality = 'high'
        }
        drawImpactFrame(ctx!, scratchCtx!, sample, scale, impact, width, height)
      } else {
        releaseScratch()
        drawZoomed(ctx!, sample, scale, width, height)
      }
      for (const cue of active) {
        ctx!.drawImage(cue.bitmap, Math.round((width - cue.bitmap.width) / 2), cue.y)
      }
      return canvas
    },
    dispose: () => {
      releaseScratch()
      bitmaps.forEach(b => b.close())
    },
  }
}
