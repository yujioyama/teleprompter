import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'

interface RemuxOptions {
  /** Normalize audio loudness to -14 LUFS (Instagram/TikTok standard). Default false. */
  normalize?: boolean
}

/**
 * Remux a fragmented MP4 (from MediaRecorder) into a flat MP4 with
 * the moov atom at the front (-movflags +faststart). Never trims: a stream
 * copy can only cut on keyframes, so trimming happens frame-accurately in the
 * finalize step instead, where the auto-detected cut stays adjustable.
 * Falls back to the original blob if remux fails.
 */
export async function remuxMp4(
  blob: Blob,
  { normalize }: RemuxOptions = {},
): Promise<{ blob: Blob; ok: boolean; error?: string }> {
  try {
    const ff = await getFFmpeg()
    await ff.writeFile('in.mp4', await fetchFile(blob))

    // No separate duration probe here: `-i in.mp4 -f null -` is a real
    // (null-muxer) output, so it decoded every audio and video frame — by far
    // the slowest step of an import, for a value that was only ever logged
    // (issue #11).
    console.log('[remuxMp4] blob:', blob.size, 'bytes')

    const args: string[] = ['-i', 'in.mp4']
    if (normalize) {
      // Re-encode audio with loudnorm targeting -14 LUFS (Instagram/TikTok standard).
      // -af must come after -i. -shortest omitted: AAC encoder delay (~23 ms) would
      // cause premature truncation.
      args.push(
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-af', 'loudnorm=I=-14:LRA=11:TP=-1',
        '-movflags', '+faststart',
        'out.mp4',
      )
    } else {
      // Stream-copy both streams.
      args.push('-c', 'copy', '-movflags', '+faststart', 'out.mp4')
    }

    console.log('[remuxMp4] exec args:', args.join(' '))

    await execFFmpeg(ff, args)
    const data = await ff.readFile('out.mp4')
    ff.deleteFile('in.mp4')
    ff.deleteFile('out.mp4')
    return { blob: new Blob([data as Uint8Array], { type: 'video/mp4' }), ok: true }
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('remuxMp4 failed:', msg)
    return { blob, ok: false, error: msg }
  }
}
