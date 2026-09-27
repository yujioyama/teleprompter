import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'
import { applyGainWithLimiter, planLoudnessGain } from './loudness'
import { canUseWebCodecs } from './webcodecs/support'
import { normalizeLoudnessWebCodecs } from './webcodecs/normalizeLoudnessWebCodecs'

// Raw PCM handed between ffmpeg and loudness.ts. Every exported video's
// audio is already 48 kHz stereo (trimAndNormalizeShot pins it), so this
// is no resampling in practice.
const PCM_RATE = 48000
const PCM_CHANNELS = 2

/** Decode the video's audio track to interleaved float PCM. */
export function buildDecodePcmArgs(input: string, output: string): string[] {
  return ['-i', input, '-vn', '-ac', String(PCM_CHANNELS), '-ar', String(PCM_RATE), '-f', 'f32le', output]
}

/** Copy the video stream and replace the audio with the given PCM, encoded to AAC. */
export function buildReplaceAudioArgs(video: string, pcm: string, output: string): string[] {
  return [
    '-i', video,
    '-f', 'f32le', '-ar', String(PCM_RATE), '-ac', String(PCM_CHANNELS), '-i', pcm,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ]
}

// Serializes this module's ffmpeg work: the shared FFmpeg instance has no
// locking, so two runs would trample each other's files (see mixMusic.ts).
let queue: Promise<unknown> = Promise.resolve()
const results = new WeakMap<Blob, Promise<Blob>>()

/**
 * Bring the video's audio to the loudness Instagram and TikTok play back at
 * (-14 LUFS, peaks limited below -1 dBTP), so the final video is neither
 * quieter nor louder than the rest of the feed — whatever the per-shot
 * levels and the BGM mix did to it. The video stream is copied.
 *
 * Returns the same blob when the audio is already on target. Results are
 * cached per blob, so returning to the export step doesn't redo the work.
 *
 * Uses WebCodecs when available (no ffmpeg.wasm load), falling back to
 * ffmpeg.wasm if that fails.
 */
export function normalizeLoudness(videoBlob: Blob): Promise<Blob> {
  const cached = results.get(videoBlob)
  if (cached) return cached
  const run = queue.then(() => normalizeLoudnessAuto(videoBlob))
  queue = run.catch(() => {})
  results.set(videoBlob, run)
  run.catch(() => results.delete(videoBlob))
  return run
}

async function normalizeLoudnessAuto(videoBlob: Blob): Promise<Blob> {
  if (await canUseWebCodecs()) {
    try {
      return await normalizeLoudnessWebCodecs(videoBlob)
    } catch (err) {
      console.warn('[normalizeLoudness] WebCodecs pass failed, falling back to ffmpeg:', err)
    }
  }
  return normalizeLoudnessFFmpeg(videoBlob)
}

async function normalizeLoudnessFFmpeg(videoBlob: Blob): Promise<Blob> {
  const ff = await getFFmpeg()
  const files = { video: 'loudness-in.mp4', pcmIn: 'loudness-in.pcm', pcmOut: 'loudness-out.pcm', out: 'loudness-out.mp4' }
  try {
    await ff.writeFile(files.video, await fetchFile(videoBlob))
    await execFFmpeg(ff, buildDecodePcmArgs(files.video, files.pcmIn))
    const raw = (await ff.readFile(files.pcmIn)) as Uint8Array
    await ff.deleteFile(files.pcmIn)
    // Copy out: the bytes may not sit on a 4-byte boundary for a Float32Array view.
    const interleaved = new Float32Array(raw.slice().buffer)

    const frames = Math.floor(interleaved.length / PCM_CHANNELS)
    const channels = Array.from({ length: PCM_CHANNELS }, () => new Float32Array(frames))
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < PCM_CHANNELS; c++) channels[c][i] = interleaved[i * PCM_CHANNELS + c]
    }
    const gainDb = planLoudnessGain(channels, PCM_RATE)
    if (gainDb === null) return videoBlob
    applyGainWithLimiter(channels, PCM_RATE, gainDb)
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < PCM_CHANNELS; c++) interleaved[i * PCM_CHANNELS + c] = channels[c][i]
    }

    await ff.writeFile(files.pcmOut, new Uint8Array(interleaved.buffer))
    await execFFmpeg(ff, buildReplaceAudioArgs(files.video, files.pcmOut, files.out))
    const data = await ff.readFile(files.out)
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  } finally {
    await cleanup(ff, Object.values(files))
  }
}

async function cleanup(ff: FFmpeg, names: string[]): Promise<void> {
  for (const name of names) {
    // Not every file exists on every path (e.g. an early return or failure).
    await ff.deleteFile(name).catch(() => undefined)
  }
}
