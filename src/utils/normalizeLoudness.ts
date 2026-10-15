import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { execFFmpeg } from './execFFmpeg'
import { getFFmpeg } from './ffmpegClient'
import { applyAudioFinish, finishKey, isNoFinish, LOUDNESS_ONLY, type AudioFinish } from './audioFinish'
import { canUseWebCodecs } from './webcodecs/support'
import { finishAudioWebCodecs } from './webcodecs/normalizeLoudnessWebCodecs'

// Raw PCM handed between ffmpeg and audioFinish.ts. Every exported video's
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
// Per blob, per finishKey.
const results = new WeakMap<Blob, Map<string, Promise<Blob>>>()

function resultsFor(blob: Blob): Map<string, Promise<Blob>> {
  let byFinish = results.get(blob)
  if (!byFinish) {
    byFinish = new Map()
    results.set(blob, byFinish)
  }
  return byFinish
}

/**
 * The export's pass over the finished video's audio: the voice preset (声の
 * 加工, when no BGM mix applied it already), then the loudness Instagram and
 * TikTok play back at (-14 LUFS, peaks limited below -1 dBTP), so the final
 * video is neither quieter nor louder than the rest of the feed — whatever
 * the per-shot levels and the BGM mix did to it. The video stream is copied.
 *
 * Returns the same blob when nothing changed. Results are cached per blob
 * and finish, so returning to the export step doesn't redo the work.
 *
 * Uses WebCodecs when available (no ffmpeg.wasm load), falling back to
 * ffmpeg.wasm if that fails.
 */
export function finishAudio(videoBlob: Blob, finish: AudioFinish): Promise<Blob> {
  if (isNoFinish(finish)) return Promise.resolve(videoBlob)
  const byFinish = resultsFor(videoBlob)
  const key = finishKey(finish)
  const cached = byFinish.get(key)
  if (cached) return cached
  const run = queue.then(() => finishAudioAuto(videoBlob, finish))
  queue = run.catch(() => {})
  byFinish.set(key, run)
  run.catch(() => byFinish.delete(key))
  return run
}

/**
 * Record that `blob`'s audio was built at the target loudness already (see
 * preparedAudio.ts), so finishAudio hands it back as is.
 */
export function markLoudnessNormalized(blob: Blob): void {
  resultsFor(blob).set(finishKey(LOUDNESS_ONLY), Promise.resolve(blob))
}

async function finishAudioAuto(videoBlob: Blob, finish: AudioFinish): Promise<Blob> {
  if (await canUseWebCodecs()) {
    try {
      return await finishAudioWebCodecs(videoBlob, finish)
    } catch (err) {
      console.warn('[finishAudio] WebCodecs pass failed, falling back to ffmpeg:', err)
    }
  }
  return finishAudioFFmpeg(videoBlob, finish)
}

async function finishAudioFFmpeg(videoBlob: Blob, finish: AudioFinish): Promise<Blob> {
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
    if (!applyAudioFinish(channels, PCM_RATE, finish)) return videoBlob
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
