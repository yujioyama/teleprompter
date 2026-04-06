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

    // Input seek before decode = fast; 0.5 s padding makes keyframe imprecision acceptable
    if (trim && trim.start > 0.05) {
      args.push('-ss', trim.start.toFixed(3))
    }

    args.push('-i', 'in.mp4')

    if (trim) {
      // Extend end by 1.5 s so the last video keyframe is always included.
      // Stream copy (-c copy) can only cut at keyframe boundaries (~1 s apart on iOS).
      // Without this buffer the video track ends at the keyframe *before* trim.end
      // while audio ends exactly at trim.end, causing an apparent video freeze.
      const KEY_FRAME_BUFFER = 1.0
      const duration = (trim.end + KEY_FRAME_BUFFER) - (trim.start > 0.05 ? trim.start : 0)
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
