import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg()
  if (!loaded) {
    const origin = window.location.origin
    await ffmpeg.load({
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    })
    loaded = true
  }
  return ffmpeg
}

/** Build the concat-demuxer list file content FFmpeg's `-f concat` expects. */
export function buildConcatListFile(filenames: string[]): string {
  return filenames.map(name => `file '${name}'\n`).join('')
}

/**
 * Concatenate already-normalized (same codec/resolution) clips with the fast
 * concat demuxer (-c copy). Callers are expected to have run each clip
 * through trimAndNormalizeShot first so the streams match.
 */
export async function concatVideos(blobs: Blob[]): Promise<Blob> {
  const ff = await getFFmpeg()
  const filenames = await Promise.all(
    blobs.map(async (blob, i) => {
      const name = `clip${i}.mp4`
      await ff.writeFile(name, await fetchFile(blob))
      return name
    }),
  )

  await ff.writeFile('list.txt', buildConcatListFile(filenames))
  await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
  const data = await ff.readFile('out.mp4')

  await Promise.all(filenames.map(name => ff.deleteFile(name)))
  ff.deleteFile('list.txt')
  ff.deleteFile('out.mp4')

  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
