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

/**
 * Build the filter_complex that loops/trims the BGM track (input 1) to the
 * video's exact duration, fades it in/out at the edges, applies the user's
 * chosen volume, then mixes it with the original audio (input 0). Video is
 * left untouched by the caller (stream-copied, not part of this filter).
 */
export function buildMixFilterComplex(durationSeconds: number, volume: number): string {
  const duration = durationSeconds.toFixed(3)
  const fadeOutStart = Math.max(0, durationSeconds - 1).toFixed(3)
  return (
    `[1:a]aloop=loop=-1:size=2e9,atrim=0:${duration},afade=t=in:d=1,afade=t=out:st=${fadeOutStart}:d=1,volume=${volume}[bgm];` +
    `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]`
  )
}

/** Probe a written file's container duration in seconds, via FFmpeg's own log output. */
async function probeDuration(ff: FFmpeg, filename: string): Promise<number> {
  let duration: number | null = null
  const handler = ({ message }: { message: string }) => {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
    if (m && duration === null) {
      duration = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])
    }
  }
  ff.on('log', handler)
  try {
    await ff.exec(['-i', filename, '-f', 'null', '-'])
  } catch {
    // ffmpeg exits non-zero for this probe-only invocation; the log listener
    // above already captured Duration before that, so this is expected.
  }
  ff.off('log', handler)
  if (duration === null) throw new Error(`Could not determine duration of ${filename}`)
  return duration
}

/**
 * Mix a BGM track under a video's existing audio, looped/faded to match the
 * video's exact duration at the given volume (0-1). Video stream is copied;
 * only audio is re-encoded.
 */
export async function mixMusic(videoBlob: Blob, trackBlob: Blob, volume: number): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))
  await ff.writeFile('track.mp3', await fetchFile(trackBlob))

  const duration = await probeDuration(ff, 'in.mp4')
  const filterComplex = buildMixFilterComplex(duration, volume)

  await ff.exec([
    '-i', 'in.mp4',
    '-i', 'track.mp3',
    '-filter_complex', filterComplex,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    'out.mp4',
  ])

  const data = await ff.readFile('out.mp4')
  ff.deleteFile('in.mp4')
  ff.deleteFile('track.mp3')
  ff.deleteFile('out.mp4')
  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
