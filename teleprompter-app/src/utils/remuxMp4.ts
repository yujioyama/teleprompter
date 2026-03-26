import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

// Singleton — load once, reuse across recordings
let ffmpeg: FFmpeg | null = null
let loaded = false

const CORE_VERSION = '0.12.6'
const CDN = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg()
  }
  if (!loaded) {
    await ffmpeg.load({
      coreURL: `${CDN}/ffmpeg-core.js`,
      wasmURL: `${CDN}/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/**
 * Remux a fragmented MP4 (from MediaRecorder) into a flat MP4 with
 * the moov atom at the front (-movflags +faststart).
 * This makes the file compatible with editors like CapCut.
 * Falls back to the original blob if remux fails.
 */
export async function remuxMp4(blob: Blob): Promise<Blob> {
  try {
    const ff = await getFFmpeg()
    await ff.writeFile('in.mp4', await fetchFile(blob))
    await ff.exec(['-i', 'in.mp4', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'])
    const data = await ff.readFile('out.mp4')
    ff.deleteFile('in.mp4')
    ff.deleteFile('out.mp4')
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } catch (err) {
    console.error('remuxMp4 failed, using original blob:', err)
    return blob
  }
}
