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
 * Extract a 16kHz mono PCM WAV from a video blob's audio track — the format
 * transformers.js's Whisper pipeline expects when fed a URL/Blob directly.
 */
export async function extractAudioForTranscription(videoBlob: Blob): Promise<Blob> {
  const ff = await getFFmpeg()
  await ff.writeFile('in.mp4', await fetchFile(videoBlob))
  await ff.exec(['-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'out.wav'])
  const data = await ff.readFile('out.wav')
  ff.deleteFile('in.mp4')
  ff.deleteFile('out.wav')
  return new Blob([data as Uint8Array], { type: 'audio/wav' })
}
