/**
 * Detect the start and end of audible speech in a video/audio blob.
 * Returns trimmed bounds with padding, or null if nothing meaningful to cut.
 */

const RMS_THRESHOLD = 0.015 // ~-36 dBFS — treat below this as silence
const WINDOW_S = 0.05       // analyze in 50 ms windows

export interface SpeechBounds {
  start: number // seconds from beginning to start playback
  end: number   // seconds from beginning to stop playback
}

export async function detectSpeechBounds(blob: Blob, padding: number): Promise<SpeechBounds | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext()

    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    } finally {
      await ctx.close()
    }

    const { sampleRate, duration, numberOfChannels } = audioBuffer
    const windowSize = Math.floor(sampleRate * WINDOW_S)

    // Mix all channels down to mono for analysis
    const mono = new Float32Array(audioBuffer.length)
    for (let c = 0; c < numberOfChannels; c++) {
      const ch = audioBuffer.getChannelData(c)
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i]
    }
    const scale = 1 / numberOfChannels
    for (let i = 0; i < mono.length; i++) mono[i] *= scale

    function rms(offset: number): number {
      const end = Math.min(offset + windowSize, mono.length)
      let sum = 0
      for (let i = offset; i < end; i++) sum += mono[i] * mono[i]
      return Math.sqrt(sum / (end - offset))
    }

    // Scan forward to find first non-silent window
    let speechStart = 0
    for (let i = 0; i < mono.length; i += windowSize) {
      if (rms(i) > RMS_THRESHOLD) {
        speechStart = i / sampleRate
        break
      }
    }

    // Scan backward to find last non-silent window
    let speechEnd = duration
    for (let i = mono.length - windowSize; i >= 0; i -= windowSize) {
      if (rms(i) > RMS_THRESHOLD) {
        speechEnd = Math.min((i + windowSize) / sampleRate, duration)
        break
      }
    }

    const start = Math.max(0, speechStart - padding)
    const end = Math.min(duration, speechEnd + padding)

    // Skip trim if we'd cut less than 0.3 s total — not worth re-encoding
    const savedStart = start
    const savedEnd = duration - end
    if (savedStart < 0.1 && savedEnd < 0.1) return null

    return { start, end }
  } catch (err) {
    // decodeAudioData can fail on some fragmented MP4s — silently skip trim
    console.warn('detectSpeechBounds failed, skipping auto-trim:', err)
    return null
  }
}
