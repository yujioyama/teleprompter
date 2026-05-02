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
 * Probe the source file durations for video and audio streams.
 * Returns { videoDur, audioDur } parsed from FFmpeg's info log, or null if not found.
 */
async function probeSourceDurations(
  ff: FFmpeg,
): Promise<{ videoDur: number | null; audioDur: number | null }> {
  let videoDur: number | null = null
  let audioDur: number | null = null

  const handler = ({ message }: { message: string }) => {
    // "Duration: 00:00:20.13" — overall container duration
    const durMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
    if (durMatch && videoDur === null) {
      const h = parseInt(durMatch[1], 10)
      const m = parseInt(durMatch[2], 10)
      const s = parseFloat(durMatch[3])
      videoDur = h * 3600 + m * 60 + s
    }
    // Stream-level duration not always in log, but container Duration is enough
  }

  ff.on('log', handler)
  try {
    // Probe-only: run with no output (will "fail" because there's no output, that's fine)
    await ff.exec(['-i', 'in.mp4', '-f', 'null', '-'])
  } catch {
    // expected — no output file
  }
  ff.off('log', handler)
  return { videoDur, audioDur }
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

    // --- Diagnostic: log source file info ---
    const { videoDur } = await probeSourceDurations(ff)
    console.log('[remuxMp4] source blob size:', blob.size, 'bytes | probed duration:', videoDur, 's')
    if (trim) {
      console.log('[remuxMp4] trim requested:', trim)
    }

    let KF_start = 0
    let KF_end: number | null = null

    if (trim) {
      // --- KF_start: scan the first few seconds only ---
      if (trim.start > 0.05) {
        const startKFs = await getKeyframeTimes(ff, 0, trim.start + 2.0)
        KF_start = [...startKFs].reverse().find(t => t <= trim.start) ?? 0
        console.log('[remuxMp4] startKFs:', startKFs, '→ KF_start:', KF_start)
      }

      // --- KF_end: scan a short window around trim.end only ---
      // Scanning the full video in WASM fails for long recordings (memory/timeout).
      const scanFrom = Math.max(0, trim.end - 1.5)
      const endKFs = await getKeyframeTimes(ff, scanFrom, 4.0)
      const found = endKFs.find(t => t >= trim.end)
      console.log('[remuxMp4] endKFs (scanned from', scanFrom.toFixed(2), '):', endKFs, '→ found:', found)

      if (found !== undefined) {
        KF_end = found
      } else {
        // No keyframe found near trim.end — skip end trim rather than risk a freeze
        console.warn('[remuxMp4] No keyframe ≥ trim.end =', trim.end, '— skipping end trim')
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

    // -shortest: if the iOS video track is shorter than the audio track (common with
    // long recordings where the video encoder lags), stop ALL streams at the video end.
    // This prevents the "video freezes while audio continues" symptom.
    args.push('-c', 'copy', '-movflags', '+faststart', '-shortest', 'out.mp4')

    console.log('[remuxMp4] final args:', args.join(' '))

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
