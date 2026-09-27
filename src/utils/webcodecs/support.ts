import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny'

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

let aacDelay: Promise<number> | null = null

/**
 * The AAC encoder's priming delay in seconds, measured once per session.
 *
 * WebCodecs' AudioEncoder emits its priming samples (2112 on Chrome) as
 * ordinary audio starting at the first input timestamp, and nothing tells
 * the muxer to trim them, so every encode would push the audio that much
 * later than the video. Callers shift the audio they feed the encoder
 * earlier by this amount; Mediabunny then writes an edit list that hides
 * the (now negative-timestamp) priming, the same way ffmpeg's output does.
 *
 * Measured rather than hard-coded because the delay is up to the platform
 * encoder (or the WASM fallback). Found by encoding a single click and
 * locating it in the decoded output; 0 (the old, unshifted behavior) if the
 * measurement fails or looks implausible.
 */
export function aacEncoderDelay(): Promise<number> {
  if (!aacDelay) {
    aacDelay = measureAacDelay().catch(err => {
      console.warn('[webcodecs] AAC delay measurement failed:', err)
      return 0
    })
  }
  return aacDelay
}

async function measureAacDelay(): Promise<number> {
  const rate = OUTPUT_SAMPLE_RATE
  const clickAt = Math.round(rate * 0.1)
  const probe = new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length: Math.round(rate * 0.5), sampleRate: rate })
  for (let c = 0; c < OUTPUT_CHANNELS; c++) probe.getChannelData(c)[clickAt] = 0.9

  const source = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') })
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  output.addAudioTrack(source)
  await output.start()
  await source.add(probe)
  await output.finalize()
  if (!output.target.buffer) throw new Error('no output')

  const input = new Input({ source: new BufferSource(output.target.buffer), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('no audio track')
    let peak = 0
    let peakTime = 0
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i])
        if (v > peak) {
          peak = v
          peakTime = timestamp + i / buffer.sampleRate
        }
      }
    }
    const delay = Math.round((peakTime - clickAt / rate) * rate) / rate
    if (peak < 0.1 || delay < 0 || delay > 0.2) throw new Error(`implausible delay ${delay}s (peak ${peak})`)
    return delay
  } finally {
    input.dispose()
  }
}
