import type { VideoSample } from 'mediabunny'
import { punchInScale, type PunchInPlan } from '../subtitleHook'
import { drawZoomed } from './pictureEffects'

export interface SubtitleOverlay {
  start: number
  end: number
  image: Blob
  /** Top edge of the image in the output frame. */
  y: number
}

export interface OverlayOptions {
  /** The first shot's zoom in and when it ends; null = never zoom. */
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
 * own timeline, over the picture with the first shot's zoom in. Only the
 * picture is zoomed, the subtitles keep their size. Frames with no
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

  return {
    process: (sample: VideoSample) => {
      // Midpoint of the frame, so a cue boundary that falls exactly on a
      // frame edge doesn't flicker on for a single extra frame.
      const t = sample.timestamp + sample.duration / 2
      const active = cues.filter(c => t >= c.start && t < c.end)
      const scale = punchIn ? punchInScale(t, punchIn.punchIn, punchIn.until) : 1
      if (active.length === 0 && scale === 1) return sample
      const width = sample.displayWidth
      const height = sample.displayHeight
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height)
        ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
        // For the zoom's upscale of the picture.
        ctx.imageSmoothingQuality = 'high'
      }
      drawZoomed(ctx!, sample, scale, width, height)
      for (const cue of active) {
        ctx!.drawImage(cue.bitmap, Math.round((width - cue.bitmap.width) / 2), cue.y)
      }
      return canvas
    },
    dispose: () => {
      bitmaps.forEach(b => b.close())
    },
  }
}
