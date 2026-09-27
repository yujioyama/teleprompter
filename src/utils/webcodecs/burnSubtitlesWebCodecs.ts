import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
} from 'mediabunny'
import { assertUsable } from './normalizeShot'

export interface SubtitleOverlay {
  start: number
  end: number
  image: Blob
}

/**
 * WebCodecs counterpart of the ffmpeg overlay filtergraph: re-encode the
 * video once, compositing each cue's pre-rendered PNG at (centered, y)
 * during [start, end). Frames with no cue are passed to the encoder as-is.
 * Audio packets are copied untouched.
 */
export async function burnSubtitlesWebCodecs(
  videoBlob: Blob,
  overlays: SubtitleOverlay[],
  y: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const bitmaps = await Promise.all(overlays.map(o => createImageBitmap(o.image)))
  const cues = overlays.map((o, i) => ({ start: o.start, end: o.end, bitmap: bitmaps[i] }))
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  try {
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    })
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        codec: 'avc',
        quality: new Quality('high'),
        allowTransformationMetadata: false,
        process: (sample: VideoSample) => {
          // Midpoint of the frame, so a cue boundary that falls exactly on a
          // frame edge doesn't flicker on for a single extra frame.
          const t = sample.timestamp + sample.duration / 2
          const active = cues.filter(c => t >= c.start && t < c.end)
          if (active.length === 0) return sample
          const width = sample.displayWidth
          const height = sample.displayHeight
          if (!canvas || canvas.width !== width || canvas.height !== height) {
            canvas = new OffscreenCanvas(width, height)
            ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
          }
          sample.draw(ctx!, 0, 0, width, height)
          for (const cue of active) {
            ctx!.drawImage(cue.bitmap, Math.round((width - cue.bitmap.width) / 2), y)
          }
          return canvas
        },
      },
      audio: {},
      showWarnings: false,
    })
    assertUsable(conversion)
    if (onProgress) conversion.onProgress = progress => onProgress(Math.min(Math.max(progress, 0), 1))
    await conversion.execute()
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error(`suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    input.dispose()
    bitmaps.forEach(b => b.close())
  }
}
