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
 * Scan a short window [fromSec, fromSec+windowSec] of the video for keyframe timestamps.
 * Passing a short window avoids processing the full video in WASM (critical for long recordings).
 * Returns timestamps sorted ascending.
 */
async function getKeyframeTimes(
  ff: FFmpeg,
  fromSec: number,
  windowSec: number,
): Promise<number[]> {
  const times: number[] = []
  const handler = ({ message }: { message: string }) => {
    if (!message.includes('iskey:1')) return
    const m = /pts_time:(\d+(?:\.\d+)?)/.exec(message)
    if (m) times.push(parseFloat(m[1]))
  }
  ff.on('log', handler)
  try {
    const args: string[] = []
    if (fromSec > 0.05) {
      args.push('-ss', fromSec.toFixed(3))
    }
    args.push('-i', 'in.mp4')
    args.push('-t', windowSec.toFixed(3))
    args.push('-an', '-vf', 'showinfo', '-vsync', '0', '-f', 'null', '-')
    await ff.exec(args)
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

    let KF_start = 0
    let KF_end: number | null = null

    if (trim) {
      // --- KF_start: scan the first few seconds only ---
      // iOS keyframes typically start at t=0, so the relevant keyframe is almost always 0.
      // Scan just the opening window to confirm.
      if (trim.start > 0.05) {
        const startKFs = await getKeyframeTimes(ff, 0, trim.start + 2.0)
        KF_start = [...startKFs].reverse().find(t => t <= trim.start) ?? 0
      }

      // --- KF_end: scan a short window around trim.end ---
      // Key insight: scan only ~4 seconds near trim.end, NOT the full video.
      // For a 20-second recording this avoids the WASM memory / timeout failure
      // that caused getKeyframeTimes to return [] and trigger the freeze-inducing fallback.
      const scanFrom = Math.max(0, trim.end - 1.5)
      const endKFs = await getKeyframeTimes(ff, scanFrom, 4.0)
      const found = endKFs.find(t => t >= trim.end)

      if (found !== undefined) {
        KF_end = found
      } else {
        // No keyframe found near trim.end.
        // Do NOT use an arbitrary fallback time — that guarantees a freeze.
        // Skipping end-trim leaves trailing silence but no freeze: far better UX.
        console.warn(
          '[remuxMp4] No keyframe found ≥ trim.end =', trim.end,
          '— skipping end trim to avoid freeze.',
        )
        KF_end = null
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
