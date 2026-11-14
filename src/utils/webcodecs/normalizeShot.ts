import {
  ALL_FORMATS,
  type AudioSample,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  type VideoSample,
} from 'mediabunny'
import {
  aacEncoderDelay,
  OUTPUT_CHANNELS,
  OUTPUT_FRAME_RATE,
  OUTPUT_HEIGHT,
  OUTPUT_SAMPLE_RATE,
  OUTPUT_WIDTH,
} from './support'
import { encodesHeld, whenNotHeld } from './encodeHold'
import { guardAgainstStall } from './stallGuard'
import { createOverlayProcess, type OverlayOptions, type SubtitleOverlay } from './subtitleOverlay'
import { drawZoomed } from './pictureEffects'
import { slowZoomScale } from '../heardZoom'
import { coverLeadSeconds, withCoverFrames, withCoverSilence, withSlowMotion, type CoverLead } from './coverLead'
import { onAbort, throwIfCancelled } from '../cancellation'

/**
 * WebCodecs counterpart of the ffmpeg trim+normalize pass: cut [start, end]
 * out of the clip and re-encode it to the same fixed profile (1080x1920
 * letterboxed, 30fps H.264, 48kHz stereo AAC) so every clip can be joined by
 * packet copy.
 *
 * Rotation (teleprompter-cam's HEVC clips are 1920x1080 plus a rotation
 * matrix) is baked into the frames rather than left as metadata, so every
 * clip ends up with identical, unrotated track headers. Only the primary
 * video/audio tracks are used — the camera's `mebx` metadata track is dropped.
 *
 * `overlays` (in the trimmed clip's own timeline, 0 = `start`) are
 * composited into the same encode, so a shot with burned-in subtitles costs
 * one encode rather than a normalize followed by a second full re-encode.
 * The encoder settings don't change with or without them, so both kinds of
 * clip join by packet copy.
 *
 * Mediabunny decodes and encodes one frame at a time and closes each
 * VideoFrame itself, and the decoder/encoder are released when the
 * conversion ends, so nothing outlives this call (see issue #12).
 *
 * `signal` cancels the conversion (中断する, issue #34).
 *
 * `options.punchIn` zooms the first shot's picture in during the same encode,
 * and `options.midZoom` a peak's or the punchline's; `options.opening` gives
 * it the opening look. `options.cover` puts the
 * cover image in as frames before the shot's first, over silence, with the
 * shot (overlays in its own timeline as before) following it.
 *
 * `options.stretch` plays the picture that many times slower (see
 * withSlowMotion); only the 相手のセリフ clip uses it, and replaces the audio.
 * `options.slowZoom` zooms the picture in from 1 to that scale over the
 * clip (see slowZoomScale), the 相手のセリフ clip's push-in.
 *
 * Every frame waits while the preview holds the encodes (see encodeHold).
 */
export async function normalizeShotWebCodecs(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  overlays: SubtitleOverlay[] = [],
  signal?: AbortSignal,
  options: OverlayOptions & { cover?: CoverLead; stretch?: number; slowZoom?: number } = {},
): Promise<Blob> {
  throwIfCancelled(signal)
  const audioDelay = await aacEncoderDelay()
  const punchIn = options.punchIn ?? null
  const midZoom = options.midZoom ?? []
  const opening = options.opening ?? null
  const cover = options.cover ?? null
  const stretch = options.stretch ?? 1
  // Feed the encoder early by its priming delay so the audio isn't
  // pushed later than the video (see aacEncoderDelay).
  const primeAudio = (sample: AudioSample) => {
    sample.setTimestamp(sample.timestamp - audioDelay)
    return sample
  }
  const overlay = overlays.length > 0 || punchIn !== null || midZoom.length > 0 || opening !== null
    ? await createOverlayProcess(overlays, { punchIn, midZoom, opening })
    : options.slowZoom && options.slowZoom > 1
      ? slowZoomProcess(end - start, options.slowZoom)
      : null
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    })
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start, end },
      video: {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        fit: 'contain',
        frameRate: OUTPUT_FRAME_RATE,
        codec: 'avc',
        quality: new Quality('high'),
        allowTransformationMetadata: false,
        forceTranscode: true,
        process: whenNotHeld<VideoSample, VideoSample | VideoSample[] | OffscreenCanvas>(
          stretch > 1
            ? withSlowMotion(overlay?.process, stretch)
            : cover ? withCoverFrames(overlay?.process, cover) : (overlay?.process ?? (sample => sample)),
          signal,
        ),
      },
      audio: {
        codec: 'aac',
        sampleRate: OUTPUT_SAMPLE_RATE,
        numberOfChannels: OUTPUT_CHANNELS,
        quality: new Quality('high'),
        forceTranscode: true,
        process: cover ? withCoverSilence(primeAudio, coverLeadSeconds(cover.count)) : primeAudio,
      },
      showWarnings: false,
    })
    assertUsable(conversion)
    const cancel = () => void conversion.cancel().catch(() => undefined)
    // 中断する stops the encoder too, not just the wait for it (issue #34).
    const unregister = onAbort(signal, cancel)
    try {
      // If the encoder stops dead, give up so the caller can fall back to
      // ffmpeg instead of waiting forever (issue #31).
      await guardAgainstStall(
        poke => {
          conversion.onProgress = progress => {
            poke()
            onProgress?.(Math.min(Math.max(progress, 0), 1))
          }
          return conversion.execute()
        },
        { onStall: cancel, paused: encodesHeld },
      )
    } finally {
      unregister()
    }
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error(`suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    input.dispose()
    overlay?.dispose()
  }
}

/**
 * Both a video and an audio track must come out of the conversion: the
 * concat step needs every clip to carry the same set of tracks, and a
 * silently discarded track (e.g. a codec the device can't decode) should
 * send this clip down the ffmpeg path instead.
 */
export function assertUsable(conversion: Conversion): void {
  const kept = new Set(conversion.utilizedTracks.map(t => t.type))
  if (!conversion.isValid || !kept.has('video') || !kept.has('audio')) {
    const reasons = conversion.discardedTracks.map(d => `${d.track.type}: ${d.reason}`).join(', ')
    throw new Error(`WebCodecs conversion unusable (${reasons || 'missing track'})`)
  }
}

/**
 * Zoom each frame in from 1 to `to` over `length` seconds of source (the
 * frames' own timestamps, so it lasts the whole clip at any stretch).
 */
function slowZoomProcess(length: number, to: number) {
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  return {
    process: (sample: VideoSample): VideoSample | OffscreenCanvas => {
      const scale = slowZoomScale((sample.timestamp + sample.duration / 2) / length, to)
      if (scale <= 1) return sample
      const width = sample.displayWidth
      const height = sample.displayHeight
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height)
        ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
        ctx.imageSmoothingQuality = 'high'
      }
      drawZoomed(ctx!, sample, scale, width, height)
      return canvas
    },
    dispose: () => {},
  }
}
