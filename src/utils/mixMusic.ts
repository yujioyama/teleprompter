import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'
import { finishAudio } from './normalizeLoudness'
import type { VoicePreset } from './voicePreset'
import { canUseWebCodecs } from './webcodecs/support'
import { bgmEnvelope, PLAYS_TO_END, type BgmEnding } from './bgmStop'
import { mixMusicWebCodecs } from './webcodecs/mixMusicWebCodecs'

/**
 * Build the filter_complex that loops/trims the BGM track (input 1) to the
 * video's exact duration, fades it in/out at the edges (or out just before
 * the punchline, or lowered under it for a soft genre, see bgmStop), applies
 * the user's chosen volume,
 * then mixes it with the original audio (input 0). Video is left untouched
 * by the caller (stream-copied, not part of this filter).
 */
export function buildMixFilterComplex(durationSeconds: number, volume: number, ending: BgmEnding = PLAYS_TO_END): string {
  const duration = durationSeconds.toFixed(3)
  const { duck, fadeOut: fade } = bgmEnvelope(durationSeconds, ending)
  let ducking = ''
  if (duck) {
    const start = duck.start.toFixed(3)
    const end = (duck.start + duck.length).toFixed(3)
    // A linear ramp from 1 to `level`, then held, like the gain ramp in renderMix.
    ducking = `volume='if(lt(t,${start}),1,if(lt(t,${end}),1-${+(1 - duck.level).toFixed(3)}*(t-${start})/${duck.length},${duck.level}))':eval=frame,`
  }
  const fadeOut = `afade=t=out:st=${fade.start.toFixed(3)}:d=${+fade.length.toFixed(3)}`
  return (
    `[1:a]aloop=loop=-1:size=2e9,atrim=0:${duration},afade=t=in:d=1,${ducking}${fadeOut},volume=${volume}[bgm];` +
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
    // Input only, no output: ffmpeg prints the input's header (Duration
    // included) and exits with "At least one output file must be specified".
    // A `-f null -` output would instead decode every frame of the video.
    await ff.exec(['-i', filename])
  } catch {
    // ffmpeg exits non-zero for this probe-only invocation; the log listener
    // above already captured Duration before that, so this is expected.
  }
  ff.off('log', handler)
  if (duration === null) throw new Error(`Could not determine duration of ${filename}`)
  return duration
}

// Serializes actual FFmpeg-touching mix executions: the shared FFmpeg
// instance uses fixed filenames with no locking, so two mixMusic() calls
// running concurrently could interleave writeFile/exec/readFile/deleteFile
// on the same files and corrupt each other's input/output. Chaining every
// call onto this promise guarantees at most one mixMusicInternal body runs
// at a time, while each caller still gets its own promise settling with its
// own result.
let mixQueue: Promise<unknown> = Promise.resolve()

/**
 * Mix a BGM track under a video's existing audio, looped/faded to match the
 * video's exact duration at the given volume (0-1). Video stream is copied;
 * only audio is re-encoded.
 *
 * Uses Web Audio + WebCodecs when available (no ffmpeg.wasm load), falling
 * back to ffmpeg.wasm for this call if that fails. Unlike the encode paths,
 * a failure here doesn't disable WebCodecs for the session: it may just as
 * well be the BGM file or Web Audio at fault.
 *
 * `voice` (声の加工) is applied to the video's own audio before the BGM goes
 * under it. `ending` says where the punchline starts, for the BGM to drop
 * out just before it (or be lowered, for a soft genre); see bgmStop.
 */
export function mixMusic(
  videoBlob: Blob,
  trackBlob: Blob,
  volume: number,
  voice: VoicePreset = 'none',
  ending: BgmEnding = PLAYS_TO_END,
): Promise<Blob> {
  const run = mixQueue.then(() => mixMusicAuto(videoBlob, trackBlob, volume, voice, ending))
  // Swallow rejection in the queue chain itself so one failed mix doesn't
  // permanently wedge the queue for later calls; this call's own returned
  // promise still rejects normally for its caller.
  mixQueue = run.catch(() => {})
  return run
}

async function mixMusicAuto(
  videoBlob: Blob,
  trackBlob: Blob,
  volume: number,
  voice: VoicePreset,
  ending: BgmEnding,
): Promise<Blob> {
  if (await canUseWebCodecs()) {
    try {
      return await mixMusicWebCodecs(videoBlob, trackBlob, volume, voice, ending)
    } catch (err) {
      console.warn('[mixMusic] WebCodecs mix failed, falling back to ffmpeg:', err)
    }
  }
  // The filtergraph has no voice preset: apply it in a pass of its own first.
  const voiced = await finishAudio(videoBlob, { voice, normalize: false })
  return mixMusicFFmpeg(voiced, trackBlob, volume, ending)
}

async function mixMusicFFmpeg(videoBlob: Blob, trackBlob: Blob, volume: number, ending: BgmEnding): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))
  await ff.writeFile('track.mp3', await fetchFile(trackBlob))

  const duration = await probeDuration(ff, 'in.mp4')
  const filterComplex = buildMixFilterComplex(duration, volume, ending)

  await execFFmpeg(ff, [
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
