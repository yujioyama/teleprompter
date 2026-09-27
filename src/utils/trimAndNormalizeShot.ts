import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { onAbort, throwIfCancelled } from './cancellation'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'

/**
 * Build the FFmpeg args that trim [start, end] out of in.mp4 and re-encode
 * to a fixed 1080x1920 H.264/AAC profile (letterboxed if the source aspect
 * ratio differs), so every clip matches for a fast concat-demuxer pass.
 * Frame rate, pixel format, and audio sample rate/channel count are also
 * pinned (30fps, yuv420p, 48kHz stereo) — clips can come from either
 * browser recording or camera-roll import, which may differ in these, and
 * a mismatch breaks the concat demuxer's fast (-c copy) path silently.
 */
export function buildTrimAndNormalizeArgs(
  start: number,
  end: number,
  inputName = 'in.mp4',
  outputName = 'out.mp4',
): string[] {
  const args: string[] = []
  if (start > 0.001) {
    args.push('-ss', start.toFixed(3))
  }
  args.push('-i', inputName)
  args.push('-t', (end - start).toFixed(3))
  args.push(
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-ar', '48000',
    '-ac', '2',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputName,
  )
  return args
}

export type NormalizeBackend = 'webcodecs' | 'ffmpeg'

const backends = new WeakMap<Blob, NormalizeBackend>()

/** Which encoder produced a clip returned by trimAndNormalizeShot. */
export function normalizedBackendOf(blob: Blob): NormalizeBackend | undefined {
  return backends.get(blob)
}

/**
 * Trim and normalize a shot, using the device's hardware encoder via
 * WebCodecs when available (issue #10) and ffmpeg.wasm otherwise. A
 * WebCodecs failure falls back to ffmpeg for this shot and disables
 * WebCodecs for the rest of the session, so a device where it misbehaves
 * doesn't pay for a failed attempt on every shot.
 *
 * Clips from the two backends have different H.264 headers and can't be
 * joined by packet copy — callers combining clips should check
 * normalizedBackendOf() and re-encode stragglers with the ffmpeg variant.
 */
export async function trimAndNormalizeShot(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (await canUseWebCodecs()) {
    try {
      const out = await normalizeShotWebCodecs(blob, start, end, onProgress, [], signal)
      backends.set(out, 'webcodecs')
      return out
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
      onProgress?.(0)
    }
  }
  return trimAndNormalizeShotFFmpeg(blob, start, end, onProgress, signal)
}

/**
 * Bring clips from mixed backends (WebCodecs broke down partway through a
 * combine) onto one encoder so they can be joined by packet copy.
 *
 * Usually only the shots encoded after the breakdown came from ffmpeg, so
 * those are retried on the hardware encoder first: it's many times faster
 * than ffmpeg.wasm on a phone, where re-encoding every other shot with
 * ffmpeg took long enough to look frozen (issue #31). If that fails too, the
 * hardware clips are re-encoded with ffmpeg instead.
 *
 * `onProgress` covers this whole step, restarting from 0 on the fallback.
 */
export async function unifyNormalizeBackends(
  clips: { blob: Blob; start: number; end: number }[],
  normalized: Blob[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob[]> {
  if (new Set(normalized.map(normalizedBackendOf)).size <= 1) return normalized

  const reencode = async (
    backend: NormalizeBackend,
    encode: (clip: (typeof clips)[number], onClipProgress: (ratio: number) => void) => Promise<Blob>,
  ) => {
    const out = [...normalized]
    const indices = normalized.flatMap((blob, i) => (normalizedBackendOf(blob) === backend ? [] : [i]))
    for (const [done, i] of indices.entries()) {
      out[i] = await encode(clips[i], ratio => onProgress?.((done + ratio) / indices.length))
      backends.set(out[i], backend)
      onProgress?.((done + 1) / indices.length)
    }
    return out
  }

  try {
    return await reencode('webcodecs', (clip, p) =>
      normalizeShotWebCodecs(clip.blob, clip.start, clip.end, p, [], signal),
    )
  } catch (err) {
    throwIfCancelled(signal)
    console.warn('[unifyNormalizeBackends] hardware re-encode failed, re-encoding with ffmpeg instead:', err)
  }
  onProgress?.(0)
  return reencode('ffmpeg', (clip, p) => trimAndNormalizeShotFFmpeg(clip.blob, clip.start, clip.end, p, signal))
}

let callSeq = 0

export async function trimAndNormalizeShotFFmpeg(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  const ff = await getFFmpeg()
  // Per-call file names: FinalizePage runs this in the background (see
  // normalizedShotCache.ts), so it can overlap with other callers of the
  // shared FFmpeg instance that use the fixed in.mp4/out.mp4 names. The
  // worker serializes exec() itself, but a writeFile from one caller could
  // otherwise clobber another's input between its writeFile and exec.
  const seq = ++callSeq
  const inputName = `norm${seq}-in.mp4`
  const outputName = `norm${seq}-out.mp4`
  // Kept only to surface ffmpeg's own stderr in the thrown error on failure —
  // the vendored core's `ff.exec()` rejection carries no detail beyond a
  // generic "Aborted"/FS error (see execFFmpeg.ts), so without this a failed
  // encode is nearly undiagnosable from the caller's side.
  const logs: string[] = []
  const handleLog = ({ message }: { message: string }) => {
    logs.push(message)
    if (logs.length > 40) logs.shift()
  }
  const handleProgress = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.min(Math.max(progress, 0), 1))
    : undefined
  ff.on('log', handleLog)
  if (handleProgress) ff.on('progress', handleProgress)
  // Terminating ffmpeg is the only way to stop an exec() midway (issue #34).
  const unregister = onAbort(signal, releaseFFmpeg)
  try {
    await ff.writeFile(inputName, await fetchFile(blob))
    await execFFmpeg(ff, buildTrimAndNormalizeArgs(start, end, inputName, outputName))
    const data = await ff.readFile(outputName)
    // A real encode failure can still leave a small/truncated out.mp4 behind
    // (e.g. ffmpeg exits before muxing the moov atom), which readFile above
    // doesn't catch — it only throws when nothing was written at all. execFFmpeg
    // also can't distinguish a genuine failure from the harmless Safari/WebKit
    // exit-unwind bug it swallows (see execFFmpeg.ts), so a failed encode would
    // otherwise pass through silently as a corrupt "successful" clip. A valid
    // 1080x1920 H.264/AAC clip is always far larger than this floor.
    if (!(data instanceof Uint8Array) || data.length < 1000) {
      throw new Error(
        `ffmpeg produced a suspiciously small output (${data instanceof Uint8Array ? data.length : typeof data} bytes) — the encode likely failed`,
      )
    }
    const out = new Blob([data as Uint8Array], { type: 'video/mp4' })
    backends.set(out, 'ffmpeg')
    return out
  } catch (err) {
    throwIfCancelled(signal)
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`trimAndNormalizeShot failed: ${msg}\n--- ffmpeg log tail ---\n${logs.slice(-15).join('\n')}`)
  } finally {
    unregister()
    // Always clean up — a failed encode would otherwise leave the input
    // (and any partial output) in MEMFS for the rest of the session.
    await ff.deleteFile(inputName).catch(() => undefined)
    await ff.deleteFile(outputName).catch(() => undefined)
    ff.off('log', handleLog)
    if (handleProgress) ff.off('progress', handleProgress)
  }
}
