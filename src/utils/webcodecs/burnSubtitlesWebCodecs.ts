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
import { assertUsable } from './normalizeShot'
import { createOverlayProcess, type SubtitleOverlay } from './subtitleOverlay'
import { onAbort, throwIfCancelled } from '../cancellation'

export type { SubtitleOverlay } from './subtitleOverlay'

/**
 * WebCodecs counterpart of the ffmpeg overlay filtergraph: re-encode the
 * video once, compositing each cue's pre-rendered PNG at (centered, its y)
 * during [start, end). Frames with no cue are passed to the encoder as-is.
 * Audio packets are copied untouched.
 *
 * Only the fallback for a whole joined video now — FinalizePage burns each
 * shot during its normalize encode instead (see burnShotSubtitles).
 */
export async function burnSubtitlesWebCodecs(
  videoBlob: Blob,
  overlays: SubtitleOverlay[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const overlay = await createOverlayProcess(overlays)
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
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
        process: overlay.process,
      },
      audio: {},
      showWarnings: false,
    })
    assertUsable(conversion)
    if (onProgress) conversion.onProgress = progress => onProgress(Math.min(Math.max(progress, 0), 1))
    const unregister = onAbort(signal, () => void conversion.cancel().catch(() => undefined))
    try {
      await conversion.execute()
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
    overlay.dispose()
  }
}
