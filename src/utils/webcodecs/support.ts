import { canEncodeAudio, canEncodeVideo } from 'mediabunny'

export const OUTPUT_WIDTH = 1080
export const OUTPUT_HEIGHT = 1920
export const OUTPUT_FRAME_RATE = 30
export const OUTPUT_SAMPLE_RATE = 48000
export const OUTPUT_CHANNELS = 2

let support: Promise<boolean> | null = null
let disabled = false

/**
 * Whether the WebCodecs (Mediabunny) pipeline can be used for encoding the
 * app's 1080x1920 H.264/AAC output. Checked once per session.
 *
 * Safari only gained `AudioEncoder` recently, so when native AAC encoding is
 * missing the WASM AAC encoder extension is registered instead — audio is
 * tiny next to video, so a software AAC encode costs little.
 */
export function canUseWebCodecs(): Promise<boolean> {
  if (disabled) return Promise.resolve(false)
  if (!support) support = detect()
  return support
}

/**
 * Stop using the WebCodecs pipeline for the rest of the session, after it
 * failed at runtime on this device. Everything then goes through ffmpeg.wasm.
 */
export function disableWebCodecs(reason: unknown): void {
  if (disabled) return
  disabled = true
  console.warn('[webcodecs] disabled for this session, falling back to ffmpeg.wasm:', reason)
}

async function detect(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return false
  try {
    const videoOk = await canEncodeVideo('avc', {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      frameRate: OUTPUT_FRAME_RATE,
    })
    if (!videoOk) return false
    const audioOptions = { sampleRate: OUTPUT_SAMPLE_RATE, numberOfChannels: OUTPUT_CHANNELS }
    if (!(await canEncodeAudio('aac', audioOptions))) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
      registerAacEncoder()
      if (!(await canEncodeAudio('aac', audioOptions))) return false
    }
    return true
  } catch (err) {
    console.warn('[webcodecs] support check failed:', err)
    return false
  }
}
