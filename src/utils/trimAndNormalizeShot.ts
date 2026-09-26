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
export function buildTrimAndNormalizeArgs(start: number, end: number): string[] {
  const args: string[] = []
  if (start > 0.001) {
    args.push('-ss', start.toFixed(3))
  }
  args.push('-i', 'in.mp4')
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
    'out.mp4',
  )
  return args
}

export async function trimAndNormalizeShot(
  blob: Blob,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg()
  const handleProgress = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.min(Math.max(progress, 0), 1))
    : undefined
  if (handleProgress) ff.on('progress', handleProgress)
  try {
    await ff.writeFile('in.mp4', await fetchFile(blob))
    await execFFmpeg(ff, buildTrimAndNormalizeArgs(start, end))
    const data = await ff.readFile('out.mp4')
    ff.deleteFile('in.mp4')
    ff.deleteFile('out.mp4')
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } finally {
    if (handleProgress) ff.off('progress', handleProgress)
  }
}
