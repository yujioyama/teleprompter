import { applyGainWithLimiter, measureIntegratedLoudness } from './loudness'

/**
 * Voice processing that makes an iPhone recording sound closer to a good
 * microphone in a treated room (声の加工): an EQ that cuts rumble and boxiness
 * and lifts presence and air, then a compressor that evens out the level
 * the way podcasts and radio do. Plain JS, like loudness.ts, so every export
 * path shares one implementation.
 */
export type VoicePreset = 'none' | 'natural' | 'radio'

export const VOICE_PRESET_OPTIONS: { value: VoicePreset; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'natural', label: 'ナチュラル' },
  { value: 'radio', label: 'ラジオ風' },
]

interface Peak {
  freq: number
  gainDb: number
  q: number
}

interface PresetSpec {
  highPassHz: number
  peaks: Peak[]
  highShelf: { freq: number; gainDb: number }
  compressor: {
    /** dBFS, for a voice at REFERENCE_LUFS (see applyVoicePreset). */
    thresholdDb: number
    ratio: number
    attackMs: number
    releaseMs: number
  }
}

const PRESETS: Record<Exclude<VoicePreset, 'none'>, PresetSpec> = {
  // Cleaned up, still sounding like the room it was recorded in.
  natural: {
    highPassHz: 80,
    peaks: [
      { freq: 300, gainDb: -2.5, q: 1 },
      { freq: 4000, gainDb: 2, q: 1 },
    ],
    highShelf: { freq: 10000, gainDb: 1.5 },
    compressor: { thresholdDb: -22, ratio: 2, attackMs: 10, releaseMs: 150 },
  },
  // Close-miked and dense, like a podcast or radio host.
  radio: {
    highPassHz: 100,
    peaks: [
      { freq: 150, gainDb: 1.5, q: 0.9 },
      { freq: 330, gainDb: -4, q: 1 },
      { freq: 3500, gainDb: 4, q: 1 },
    ],
    highShelf: { freq: 10000, gainDb: 3 },
    compressor: { thresholdDb: -28, ratio: 4, attackMs: 5, releaseMs: 100 },
  },
}

/**
 * The loudness the compressor thresholds are set for. Takes are recorded at
 * whatever level the phone picked, so the threshold follows the take's own
 * loudness instead: a quiet take is compressed as much as a loud one.
 */
const REFERENCE_LUFS = -20

const KNEE_DB = 6

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

// RBJ Audio EQ Cookbook filters, normalized by a0.
function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function highPass(freq: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  return normalized((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
}

function peaking({ freq, gainDb, q }: Peak, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40)
  const w = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  return normalized(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A)
}

function highShelf(freq: number, gainDb: number, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40)
  const w = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w)
  // Shelf slope 1.
  const beta = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.SQRT2
  return normalized(
    A * (A + 1 + (A - 1) * cos + beta),
    -2 * A * (A - 1 + (A + 1) * cos),
    A * (A + 1 + (A - 1) * cos - beta),
    A + 1 - (A - 1) * cos + beta,
    2 * (A - 1 - (A + 1) * cos),
    A + 1 - (A - 1) * cos - beta,
  )
}

function filterInPlace(samples: Float32Array, f: Biquad): void {
  // Direct form I.
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    samples[i] = y
  }
}

/**
 * Feed-forward compressor with a soft knee, its detector linked across
 * channels so a stereo image doesn't wander.
 */
function compress(channels: Float32Array[], sampleRate: number, spec: PresetSpec['compressor'], thresholdDb: number): void {
  const attack = Math.exp(-1 / ((sampleRate * spec.attackMs) / 1000))
  const release = Math.exp(-1 / ((sampleRate * spec.releaseMs) / 1000))
  const slope = 1 / spec.ratio - 1
  let envelope = 0
  for (let i = 0; i < channels[0].length; i++) {
    let peak = 0
    for (const samples of channels) peak = Math.max(peak, Math.abs(samples[i]))
    const coeff = peak > envelope ? attack : release
    envelope = coeff * envelope + (1 - coeff) * peak

    const over = 20 * Math.log10(envelope + 1e-9) - thresholdDb
    let reductionDb = 0
    if (2 * over > KNEE_DB) reductionDb = slope * over
    else if (2 * over > -KNEE_DB) reductionDb = (slope * (over + KNEE_DB / 2) ** 2) / (2 * KNEE_DB)
    if (reductionDb === 0) continue
    const gain = Math.pow(10, reductionDb / 20)
    for (const samples of channels) samples[i] *= gain
  }
}

/**
 * Apply `preset` to the voice in place, keeping its loudness as it was (the
 * export's loudness pass sets the final level). Returns false, leaving it
 * untouched, for 'none' or a take with nothing audible in it.
 */
export function applyVoicePreset(channels: Float32Array[], sampleRate: number, preset: VoicePreset): boolean {
  if (preset === 'none' || channels.length === 0) return false
  const loudness = measureIntegratedLoudness(channels, sampleRate)
  if (!Number.isFinite(loudness)) return false
  const spec = PRESETS[preset]

  const filters = [
    highPass(spec.highPassHz, sampleRate),
    ...spec.peaks.map(p => peaking(p, sampleRate)),
    highShelf(spec.highShelf.freq, spec.highShelf.gainDb, sampleRate),
  ]
  for (const samples of channels) {
    for (const f of filters) filterInPlace(samples, f)
  }
  compress(channels, sampleRate, spec.compressor, spec.compressor.thresholdDb + loudness - REFERENCE_LUFS)

  const after = measureIntegratedLoudness(channels, sampleRate)
  if (Number.isFinite(after)) applyGainWithLimiter(channels, sampleRate, loudness - after)
  return true
}
