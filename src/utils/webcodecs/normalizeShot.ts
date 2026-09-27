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
  OUTPUT_CHANNELS,
  OUTPUT_FRAME_RATE,
  OUTPUT_HEIGHT,
  OUTPUT_SAMPLE_RATE,
  OUTPUT_WIDTH,
} from './support'

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
 * Mediabunny decodes and encodes one frame at a time and closes each
 * VideoFrame itself, and the decoder/encoder are released when the
 * conversion ends, so nothing outlives this call (see issue #12).
 */
export async function normalizeShotWebCodecs(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
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
      },
      audio: {
        codec: 'aac',
        sampleRate: OUTPUT_SAMPLE_RATE,
        numberOfChannels: OUTPUT_CHANNELS,
        quality: new Quality('high'),
        forceTranscode: true,
      },
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
