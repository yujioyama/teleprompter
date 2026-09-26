import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'

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

let callSeq = 0

export async function trimAndNormalizeShot(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
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
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`trimAndNormalizeShot failed: ${msg}\n--- ffmpeg log tail ---\n${logs.slice(-15).join('\n')}`)
  } finally {
    // Always clean up — a failed encode would otherwise leave the input
    // (and any partial output) in MEMFS for the rest of the session.
    await ff.deleteFile(inputName).catch(() => undefined)
    await ff.deleteFile(outputName).catch(() => undefined)
    ff.off('log', handleLog)
    if (handleProgress) ff.off('progress', handleProgress)
  }
}
