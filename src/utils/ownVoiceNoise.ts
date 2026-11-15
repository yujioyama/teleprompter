import { fft } from './formant'

/**
 * ノイズ除去 for our own takes: the room's steady hiss and hum taken down
 * under the voice, as reduceNoise (denoise.ts) already does for the other
 * person's recorded line. Plain JS like voicePreset.ts, so every import path
 * shares it. Unlike reduceNoise it keeps no spectra between passes (a
 * 一発撮り take runs to a minute, far more than an iPhone tab can hold of
 * them), works on stereo, and has a strength to pick.
 *
 * A short-time spectral gain (Wiener, with the decision-directed SNR of
 * Ephraim & Malah): the noise's spectrum is measured on the quietest stretches of
 * the take itself, and each bin of each frame is turned down by how much of it
 * is that noise. Two things keep the voice from going muffled or robotic:
 * - the gain never drops below a floor (the strength sets it), so the noise
 *   is lowered rather than cut out and the gaps between words stay natural
 * - the SNR is smoothed over time and the gain over neighbouring bins, so
 *   no lone bins flicker on and off ("musical noise", the robotic warble)
 */
export type NoiseReduction = 'off' | 'light' | 'medium' | 'strong'

export const NOISE_REDUCTION_OPTIONS: { value: NoiseReduction; label: string }[] = [
  { value: 'off', label: 'オフ' },
  { value: 'light', label: '弱め' },
  { value: 'medium', label: 'ふつう' },
  { value: 'strong', label: '強め' },
]

export function isNoiseReduction(value: unknown): value is NoiseReduction {
  return NOISE_REDUCTION_OPTIONS.some(o => o.value === value)
}

interface Strength {
  /** The most a bin is turned down, in dB. */
  floorDb: number
  /** How much more than the measured noise is taken as noise. */
  overSubtract: number
}

const STRENGTHS: Record<Exclude<NoiseReduction, 'off'>, Strength> = {
  light: { floorDb: -8, overSubtract: 1 },
  medium: { floorDb: -12, overSubtract: 1.3 },
  strong: { floorDb: -16, overSubtract: 1.6 },
}

/** Frame length in samples (~21 ms at 48 kHz) and hop (75% overlap). */
const FRAME = 1024
const HOP = FRAME / 4
/** The share of frames, the quietest, the noise is measured on. */
const NOISE_SHARE = 0.1
/** Decision-directed smoothing of the a-priori SNR. */
const SMOOTHING = 0.96
/** Below this (dBFS RMS over the quietest frames) there is no noise worth taking out. */
const SILENT_DB = -75

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

const WINDOW = (() => {
  const w = new Float64Array(FRAME)
  // Periodic Hann, analysis and synthesis: Hann² at 75% overlap sums to a constant 1.5.
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)
  return w
})()
const OLA_GAIN = 1 / 1.5

const BINS = FRAME / 2 + 1

/** The windowed frame of `samples` starting at `at` (zeros past its ends), transformed. */
function spectrum(samples: Float32Array, at: number, re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < FRAME; i++) {
    const n = at + i
    re[i] = n >= 0 && n < samples.length ? samples[n] * WINDOW[i] : 0
    im[i] = 0
  }
  fft(re, im, false)
}

function frameStarts(length: number): number[] {
  // The first frame starts a hop's worth of overlap before 0, so every sample is fully covered.
  const starts: number[] = []
  for (let at = -(FRAME - HOP); at < length; at += HOP) starts.push(at)
  return starts
}

/** Each bin's noise power, from the quietest frames of `mono`; null when there is no noise to speak of. */
function noiseProfile(mono: Float32Array, starts: number[]): Float64Array | null {
  const energy = starts.map(at => {
    let sum = 0
    for (let i = Math.max(0, at); i < Math.min(mono.length, at + FRAME); i++) sum += mono[i] * mono[i]
    return sum / FRAME
  })
  // Frames hanging off the ends hold fewer samples, so they'd look quieter than they are.
  const whole = starts.map((_, k) => k).filter(k => starts[k] >= 0 && starts[k] + FRAME <= mono.length)
  if (whole.length < 8) return null
  whole.sort((a, b) => energy[a] - energy[b])
  const quiet = whole.slice(0, Math.max(4, Math.round(whole.length * NOISE_SHARE)))
  const meanEnergy = quiet.reduce((sum, k) => sum + energy[k], 0) / quiet.length
  if (10 * Math.log10(meanEnergy + 1e-20) < SILENT_DB) return null

  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const noise = new Float64Array(BINS)
  for (const k of quiet) {
    spectrum(mono, starts[k], re, im)
    for (let b = 0; b < BINS; b++) noise[b] += (re[b] * re[b] + im[b] * im[b]) / quiet.length
  }
  return noise
}

/**
 * Take the noise out of `channels` in place (one gain for all of them, from
 * their mix, so the stereo image stays). Returns false, leaving them
 * untouched, when off or when the take has no noise worth taking out.
 */
export function reduceOwnVoiceNoise(channels: Float32Array[], strength: NoiseReduction): boolean {
  if (strength === 'off' || channels.length === 0 || channels[0].length < FRAME * 2) return false
  const { floorDb, overSubtract } = STRENGTHS[strength]
  const floor = dbToGain(floorDb)
  const length = channels[0].length

  const mono = channels.length === 1 ? channels[0] : new Float32Array(length)
  if (channels.length > 1) {
    for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length
  }
  const starts = frameStarts(length)
  const profile = noiseProfile(mono, starts)
  if (!profile) return false
  const noise = profile.map(p => p * overSubtract + 1e-12)

  // A copy of a channel the same as the first gets the first's result.
  const same = channels.map((ch, c) => c > 0 && ch.every((v, i) => v === channels[0][i]))
  const distinct = channels.filter((_, c) => !same[c])
  const outs = distinct.map(() => new Float32Array(length + FRAME))

  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const gain = new Float64Array(BINS)
  const smoothed = new Float64Array(BINS)
  const lastClean = new Float64Array(BINS)
  for (const at of starts) {
    spectrum(mono, at, re, im)
    for (let b = 0; b < BINS; b++) {
      const power = re[b] * re[b] + im[b] * im[b]
      const post = power / noise[b]
      const prior = SMOOTHING * (lastClean[b] / noise[b]) + (1 - SMOOTHING) * Math.max(post - 1, 0)
      gain[b] = Math.max(floor, prior / (1 + prior))
      lastClean[b] = gain[b] * gain[b] * power
    }
    // Neighbouring bins together, so none flickers alone.
    for (let b = 0; b < BINS; b++) {
      const lo = gain[Math.max(0, b - 1)]
      const hi = gain[Math.min(BINS - 1, b + 1)]
      smoothed[b] = 0.25 * lo + 0.5 * gain[b] + 0.25 * hi
    }
    distinct.forEach((ch, c) => {
      spectrum(ch, at, re, im)
      for (let b = 0; b < BINS; b++) {
        const g = smoothed[b]
        re[b] *= g
        im[b] *= g
        // The mirrored half, for a real result.
        if (b > 0 && b < FRAME / 2) {
          re[FRAME - b] = re[b]
          im[FRAME - b] = -im[b]
        }
      }
      fft(re, im, true)
      const out = outs[c]
      const offset = at + FRAME - HOP
      for (let i = 0; i < FRAME; i++) out[offset + i] += re[i] * WINDOW[i] * OLA_GAIN
    })
  }
  distinct.forEach((ch, c) => ch.set(outs[c].subarray(FRAME - HOP, FRAME - HOP + length)))
  channels.forEach((ch, c) => {
    if (same[c]) ch.set(channels[0])
  })
  return true
}
