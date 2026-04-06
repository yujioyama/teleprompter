import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

// Singleton — load once, reuse across recordings
let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg()
  }
  if (!loaded) {
    // Serve core files from same origin to avoid CORS issues in iOS Safari PWA
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

interface RemuxOptions {
  /** Trim bounds in seconds. When provided, clips the output to [start, end]. */
  trim?: { start: number; end: number }
}

/**
 * Extract all keyframe timestamps from the already-written 'in.mp4' in FFmpeg's FS.
 * Uses showinfo filter with -skip_frame nokey so only I-frames are decoded.
 * Returns timestamps sorted ascending.
 */
async function getKeyframeTimes(ff: FFmpeg): Promise<number[]> {
  const times: number[] = []
  const handler = ({ message }: { message: string }) => {
    if (!message.includes('iskey:1')) return
    const m = /pts_time:(\d+\.?\d*)/.exec(message)
    if (m) times.push(parseFloat(m[1]))
  }
  ff.on('log', handler)
  try {
    await ff.exec([
      '-skip_frame', 'nokey',
      '-i', 'in.mp4',
      '-an',
      '-vf', 'showinfo',
      '-vsync', '0',
      '-f', 'null',
      '-',
    ])
  } catch {
    // showinfo writes to stderr which FFmpeg may report as an error — ignore
  }
  ff.off('log', handler)
  return times.sort((a, b) => a - b)
}

/**
 * Remux a fragmented MP4 (from MediaRecorder) into a flat MP4 with
 * the moov atom at the front (-movflags +faststart).
 * Optionally trims silence from the start/end in the same FFmpeg pass.
 * Falls back to the original blob if remux fails.
 */
export async function remuxMp4(
  blob: Blob,
  { trim }: RemuxOptions = {},
): Promise<{ blob: Blob; ok: boolean; error?: string }> {
  try {
    const ff = await getFFmpeg()
    await ff.writeFile('in.mp4', await fetchFile(blob))

    const args: string[] = []

    // Input seek before decode = fast
    if (trim && trim.start > 0.05) {
      args.push('-ss', trim.start.toFixed(3))
    }

    args.push('-i', 'in.mp4')

    if (trim) {
      // Find the first keyframe at or after trim.end so stream-copy (-c copy)
      // lands on a real keyframe boundary — eliminates the video-freeze gap.
      // Falls back to trim.end + 1.5 s if keyframe detection fails.
      const keyframeTimes = await getKeyframeTimes(ff)
      const cutPoint =
        keyframeTimes.find(t => t >= trim.end) ?? trim.end + 1.5
      const duration = cutPoint - (trim.start > 0.05 ? trim.start : 0)
      args.push('-t', duration.toFixed(3))
    }

    // Fast stream copy — moov atom move and optional trim in one pass
    args.push('-c', 'copy', '-movflags', '+faststart', 'out.mp4')

    await ff.exec(args)
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
