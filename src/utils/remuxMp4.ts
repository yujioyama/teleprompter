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
 * Scan the full video for all keyframe timestamps.
 * Uses -skip_frame nokey so only I-frames are decoded — fast even for long videos.
 * Returns timestamps sorted ascending.
 */
async function getAllKeyframeTimes(ff: FFmpeg): Promise<number[]> {
  const times: number[] = []
  const handler = ({ message }: { message: string }) => {
    if (!message.includes('iskey:1')) return
    const m = /pts_time:(\d+(?:\.\d+)?)/.exec(message)
    if (m) times.push(parseFloat(m[1]))
  }
  ff.on('log', handler)
  try {
    await ff.exec([
      '-skip_frame', 'nokey',   // only decode I-frames: O(keyframes) not O(all frames)
      '-i', 'in.mp4',
      '-an',
      '-vf', 'showinfo',
      '-vsync', '0',
      '-f', 'null',
      '-',
    ])
  } catch (e) {
    console.warn('[remuxMp4] keyframe scan failed:', e)
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

    // Probe container duration (comes from FFmpeg's -i log output)
    let containerDuration: number | null = null
    const durHandler = ({ message }: { message: string }) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
      if (m && containerDuration === null) {
        containerDuration =
          parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])
      }
    }
    ff.on('log', durHandler)
    try { await ff.exec(['-i', 'in.mp4', '-f', 'null', '-']) } catch {}
    ff.off('log', durHandler)

    console.log('[remuxMp4] blob:', blob.size, 'bytes | container duration:', containerDuration, 's')
    if (trim) console.log('[remuxMp4] trim requested:', trim)

    let KF_start = 0
    let KF_end: number | null = null

    if (trim) {
      // Full scan with -skip_frame nokey: only decodes I-frames so it stays fast.
      // (Windowed seek was unreliable for fMP4 which may lack a seek index.)
      const allKFs = await getAllKeyframeTimes(ff)
      console.log('[remuxMp4] all keyframes:', allKFs)

      // KF_start: last keyframe at or before trim.start
      if (trim.start > 0.05) {
        KF_start = [...allKFs].reverse().find(t => t <= trim.start) ?? 0
      }
      console.log('[remuxMp4] KF_start:', KF_start)

      // KF_end: first keyframe at or after trim.end
      const found = allKFs.find(t => t >= trim.end)
      if (found !== undefined) {
        KF_end = found
        console.log('[remuxMp4] KF_end:', KF_end)
      } else {
        // No keyframe found at or after trim.end — video track likely ends before trim.end.
        // Use the LAST keyframe found as the cut point. This may cut slightly before
        // trim.end but avoids the freeze that occurs when cutting past video track end.
        const lastKF = allKFs[allKFs.length - 1] ?? null
        console.warn(
          '[remuxMp4] No keyframe ≥ trim.end =', trim.end,
          '— last keyframe is', lastKF,
          '— cutting at last keyframe to avoid freeze',
        )
        KF_end = lastKF  // null if no keyframes at all → no end trim
      }
    }

    const args: string[] = []
    if (KF_start > 0.05) {
      args.push('-ss', KF_start.toFixed(3))
    }
    args.push('-i', 'in.mp4')
    if (KF_end !== null) {
      args.push('-t', (KF_end - KF_start).toFixed(3))
    }
    // -shortest: safety net — if video track is shorter than audio (iOS encoder lag),
    // stop all streams when the shortest one ends, preventing the freeze.
    args.push('-c', 'copy', '-movflags', '+faststart', '-shortest', 'out.mp4')

    console.log('[remuxMp4] exec args:', args.join(' '))

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
