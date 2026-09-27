/**
 * Detect the start and end of the speech in a shot, so the finalize step can
 * open each shot already trimmed past the record-button press at its start
 * and the pause before the stop press at its end (issue #21).
 */

const ANALYSIS_SAMPLE_RATE = 16000 // plenty for voice, and a quarter of the memory of 48 kHz
const WINDOW_S = 0.02
const HIGH_PASS_HZ = 120           // drops handling rumble and hum below the voice band

// The threshold follows each clip's own room noise instead of a fixed level,
// so a noisy room isn't all "speech" and a quiet one still catches soft words.
const NOISE_PERCENTILE = 0.1
const PEAK_PERCENTILE = 0.98
const ABOVE_NOISE_DB = 10
const BELOW_PEAK_DB = 10
const MAX_BELOW_PEAK_DB = 40
const MIN_THRESHOLD_DB = -60

// A button press is a burst far shorter than a word, so only sound that keeps
// going counts as speech; short sounds just outside it (a clipped last word)
// are pulled in, anything further away (the stop press) is left out.
const MERGE_GAP_S = 0.25
const MIN_SPEECH_S = 0.25
const ATTACH_GAP_S = 0.4

// Below this on both ends there's nothing worth trimming.
const MIN_SAVED_S = 0.1

export interface SpeechBounds {
  start: number // seconds from beginning to start playback
  end: number   // seconds from beginning to stop playback
}

interface Segment {
  start: number
  end: number
}

function highPass(samples: Float32Array, sampleRate: number): Float32Array {
  // RBJ cookbook biquad, Q = 1/√2 (Butterworth).
  const w0 = (2 * Math.PI * HIGH_PASS_HZ) / sampleRate
  const alpha = Math.sin(w0) / Math.SQRT2
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 + cos) / 2 / a0
  const b1 = -(1 + cos) / a0
  const b2 = b0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0

  const out = new Float32Array(samples.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    out[i] = y
    x2 = x1; x1 = x
    y2 = y1; y1 = y
  }
  return out
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** Pure: find the speech in mono PCM. Null if there's none, or nothing worth trimming. */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  paddingStart: number,
  paddingEnd: number,
): SpeechBounds | null {
  const duration = samples.length / sampleRate
  const windowSize = Math.max(1, Math.round(sampleRate * WINDOW_S))
  const filtered = highPass(samples, sampleRate)

  const levels: number[] = []
  for (let offset = 0; offset < filtered.length; offset += windowSize) {
    const end = Math.min(offset + windowSize, filtered.length)
    let sum = 0
    for (let i = offset; i < end; i++) sum += filtered[i] * filtered[i]
    levels.push(10 * Math.log10(sum / (end - offset) + 1e-12))
  }
  if (levels.length === 0) return null

  const sorted = [...levels].sort((a, b) => a - b)
  const noise = percentile(sorted, NOISE_PERCENTILE)
  const peak = percentile(sorted, PEAK_PERCENTILE)
  const threshold = Math.min(
    Math.max(noise + ABOVE_NOISE_DB, peak - MAX_BELOW_PEAK_DB, MIN_THRESHOLD_DB),
    peak - BELOW_PEAK_DB,
  )

  // Runs of loud windows, with gaps shorter than a breath closed up.
  const segments: Segment[] = []
  levels.forEach((level, i) => {
    if (level <= threshold) return
    const start = (i * windowSize) / sampleRate
    const end = Math.min(((i + 1) * windowSize) / sampleRate, duration)
    const last = segments[segments.length - 1]
    if (last && start - last.end < MERGE_GAP_S) last.end = end
    else segments.push({ start, end })
  })

  const isSpeech = (s: Segment) => s.end - s.start >= MIN_SPEECH_S
  let first = segments.findIndex(isSpeech)
  if (first < 0) return null
  let last = segments.length - 1
  while (!isSpeech(segments[last])) last--

  while (first > 0 && segments[first].start - segments[first - 1].end <= ATTACH_GAP_S) first--
  while (last < segments.length - 1 && segments[last + 1].start - segments[last].end <= ATTACH_GAP_S) last++

  // Padding keeps a natural breath around the speech, but never reaches back
  // into a sound that was just left out (the button press).
  const start = Math.max(0, segments[first].start - paddingStart, segments[first - 1]?.end ?? 0)
  const end = Math.min(duration, segments[last].end + paddingEnd, segments[last + 1]?.start ?? duration)

  if (start < MIN_SAVED_S && duration - end < MIN_SAVED_S) return null
  return { start, end }
}

/**
 * Decode a shot's audio and find its speech. Null when decoding fails
 * (e.g. an unusual container) — the shot is then left untrimmed.
 */
export async function detectSpeechBounds(blob: Blob, paddingStart: number, paddingEnd: number): Promise<SpeechBounds | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext({ sampleRate: ANALYSIS_SAMPLE_RATE })

    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    } finally {
      await ctx.close()
    }

    // Mix all channels down to mono for analysis
    const mono = new Float32Array(audioBuffer.length)
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const ch = audioBuffer.getChannelData(c)
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audioBuffer.numberOfChannels
    }

    return findSpeechBounds(mono, audioBuffer.sampleRate, paddingStart, paddingEnd)
  } catch (err) {
    console.warn('detectSpeechBounds failed, skipping auto-trim:', err)
    return null
  }
}
