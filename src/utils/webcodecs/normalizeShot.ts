import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'
import {
  aacEncoderDelay,
  OUTPUT_CHANNELS,
  OUTPUT_FRAME_RATE,
  OUTPUT_HEIGHT,
  OUTPUT_SAMPLE_RATE,
  OUTPUT_WIDTH,
} from './support'
import { guardAgainstStall } from './stallGuard'
import { createOverlayProcess, type OverlayOptions, type SubtitleOverlay } from './subtitleOverlay'
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
 * `options.punchIn` snaps the first shot's picture in during the same encode.
 */
export async function normalizeShotWebCodecs(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  overlays: SubtitleOverlay[] = [],
  signal?: AbortSignal,
  options: OverlayOptions = {},
): Promise<Blob> {
  throwIfCancelled(signal)
  const audioDelay = await aacEncoderDelay()
  const punchIn = options.punchIn ?? null
  const overlay = overlays.length > 0 || punchIn !== null
    ? await createOverlayProcess(overlays, { punchIn })
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
        ...(overlay && { process: overlay.process }),
      },
      audio: {
        codec: 'aac',
        sampleRate: OUTPUT_SAMPLE_RATE,
        numberOfChannels: OUTPUT_CHANNELS,
        quality: new Quality('high'),
        forceTranscode: true,
        // Feed the encoder early by its priming delay so the audio isn't
        // pushed later than the video (see aacEncoderDelay).
        process: sample => {
          sample.setTimestamp(sample.timestamp - audioDelay)
          return sample
        },
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
        { onStall: cancel },
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
