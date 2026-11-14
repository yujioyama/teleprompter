import { applyGainWithLimiter, planLoudnessGain } from './loudness'
import { shiftFormants } from './formant'
/**
 * 相手のセリフ: the voices the other person's line can be given. The line
 * is said in our own voice; these make it someone else's.
 * - kid / high / low change how high the voice is and keep its pace; the
 *   formants (how big the speaker sounds) move far less than the pitch, as
 *   between real voices, so a raised voice doesn't sound like helium
 * - fast / slow change both together, like a tape played quicker or slower
 * - phone keeps the voice and narrows it to a telephone's band; phoneKid /
 *   phoneHigh / phoneLow are kid / high / low heard down a phone line
 */
export const HEARD_VOICES = ['natural', 'kid', 'high', 'low', 'fast', 'slow', 'phone', 'phoneKid', 'phoneHigh', 'phoneLow'] as const
export type HeardVoice = (typeof HEARD_VOICES)[number]

export const HEARD_VOICE_LABELS: Record<HeardVoice, string> = {
  natural: 'そのまま',
  kid: '子ども',
  high: '高い声（女の人）',
  low: '低い声',
  fast: '早回し（高く速く）',
  slow: 'スロー（低くゆっくり）',
  phone: '電話',
  phoneKid: '電話（子ども）',
  phoneHigh: '電話（女の人）',
  phoneLow: '電話（男の人）',
}

export function isHeardVoice(value: unknown): value is HeardVoice {
  return typeof value === 'string' && (HEARD_VOICES as readonly string[]).includes(value)
}

const semitones = (n: number) => 2 ** (n / 12)

interface VoiceShape {
  /** How many times higher the voice is; its pace is kept. */
  pitch?: number
  /** How many times higher its formants end up (with `pitch`; 1 = the speaker's own). */
  formant?: number
  /** Played this many times quicker, higher with it. */
  speed?: number
  phone?: boolean
}

const KID: VoiceShape = { pitch: semitones(11), formant: 1.45 }
const HIGH: VoiceShape = { pitch: semitones(7), formant: 1.12 }
// Our own voice is a man's already: a little lower is another man, more is a monster.
const LOW: VoiceShape = { pitch: semitones(-2), formant: 0.97 }

const SHAPES: Record<HeardVoice, VoiceShape> = {
  natural: {},
  kid: KID,
  high: HIGH,
  low: LOW,
  fast: { speed: 1.25 },
  slow: { speed: 0.85 },
  phone: { phone: true },
  phoneKid: { ...KID, phone: true },
  phoneHigh: { ...HIGH, phone: true },
  phoneLow: { ...LOW, phone: true },
}

/** How many times quicker the line plays in this voice (1 unless 早回し / スロー). */
export function voiceSpeed(voice: HeardVoice | undefined): number {
  return SHAPES[voice ?? 'natural'].speed ?? 1
}

/** `samples` (mono) in the given voice. Its length is the input's divided by voiceSpeed. */
export function shapeVoice(samples: Float32Array, sampleRate: number, voice: HeardVoice | undefined): Float32Array {
  const shape = SHAPES[voice ?? 'natural']
  let out = samples
  // Higher without quicker: made longer at the same pitch, then played that much faster.
  if (shape.pitch) {
    out = resample(timeStretch(out, sampleRate, shape.pitch), shape.pitch, samples.length)
    // The shift took the formants up with the pitch: back to where they belong.
    out = shiftFormants(out, sampleRate, (shape.formant ?? 1) / shape.pitch)
  }
  if (shape.speed) out = resample(out, shape.speed)
  if (shape.phone) out = telephone(out, sampleRate)
  return out
}

/** `samples` played `rate` times faster (and that much higher), by linear interpolation. */
export function resample(samples: Float32Array, rate: number, length = Math.round(samples.length / rate)): Float32Array {
  const out = new Float32Array(length)
  const last = samples.length - 1
  for (let i = 0; i < length; i++) {
    const at = i * rate
    const lo = Math.min(Math.floor(at), last)
    const hi = Math.min(lo + 1, last)
    const t = at - lo
    out[i] = samples[lo] * (1 - t) + samples[hi] * t
  }
  return out
}

const FRAME_S = 0.03
const SEEK_S = 0.008
/** Every how many samples the frames are compared: plenty to find a voice's period. */
const SEEK_STRIDE = 2

/**
 * `samples` made `factor` times longer at the same pitch (WSOLA): windows
 * of the sound overlap-added at a wider spacing, each taken from where it
 * best continues the one before, so the voice's own waves line up.
 */
export function timeStretch(samples: Float32Array, sampleRate: number, factor: number): Float32Array {
  const frame = Math.max(64, Math.round(sampleRate * FRAME_S) & ~1)
  const hop = frame / 2
  const seek = Math.round(sampleRate * SEEK_S)
  const length = Math.round(samples.length * factor)
  if (samples.length < frame * 2) return resample(samples, 1 / factor, length)

  const window = new Float32Array(frame)
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame)
  const out = new Float32Array(length + frame)
  const lastStart = samples.length - frame
  let previous = 0
  for (let k = 0; k * hop < length; k++) {
    const target = Math.min(Math.round((k * hop) / factor), lastStart)
    let start = target
    if (k > 0) {
      // What would follow the last window if nothing were stretched.
      const natural = Math.min(previous + hop, lastStart)
      let best = -Infinity
      const from = Math.max(0, target - seek)
      const to = Math.min(lastStart, target + seek)
      for (let candidate = from; candidate <= to; candidate++) {
        let score = 0
        for (let i = 0; i < frame; i += SEEK_STRIDE) score += samples[candidate + i] * samples[natural + i]
        if (score > best) {
          best = score
          start = candidate
        }
      }
    }
    const at = k * hop
    for (let i = 0; i < frame; i++) out[at + i] += samples[start + i] * window[i]
    previous = start
  }
  // The first half-window has no neighbour to add up to full level with.
  for (let i = 0; i < hop && i < length; i++) out[i] /= Math.max(window[i], 0.05)
  return out.subarray(0, length)
}

/** A second-order filter (RBJ cookbook), run over `samples` in place. */
function biquad(samples: Float32Array, sampleRate: number, kind: 'highpass' | 'lowpass', frequency: number) {
  const w = (2 * Math.PI * frequency) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const edge = kind === 'highpass' ? (1 + cos) / 2 : (1 - cos) / 2
  const b0 = edge
  const b1 = kind === 'highpass' ? -(1 + cos) : 1 - cos
  const b2 = edge
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    samples[i] = y
  }
}

const PHONE_LOW_HZ = 300
const PHONE_HIGH_HZ = 3400
/** Pushed into a soft clip, for the small speaker's edge. */
const PHONE_DRIVE = 2.5

/** `samples` as heard down a phone line: only the middle of the voice, a little crushed. */
export function telephone(samples: Float32Array, sampleRate: number): Float32Array {
  const out = Float32Array.from(samples)
  for (let pass = 0; pass < 2; pass++) {
    biquad(out, sampleRate, 'highpass', PHONE_LOW_HZ)
    biquad(out, sampleRate, 'lowpass', Math.min(PHONE_HIGH_HZ, sampleRate * 0.45))
  }
  const full = Math.tanh(PHONE_DRIVE)
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * PHONE_DRIVE) / full
  // The clip lifts the level; bring the loudness back to the input's.
  const gain = rms(samples) / (rms(out) || 1)
  for (let i = 0; i < out.length; i++) out[i] *= Math.min(gain, 4)
  return out
}

export function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0
}

/**
 * `samples` (mono, changed in place) brought to the loudness every take is
 * brought to at import (TARGET_LUFS), so the other person's line is as loud
 * as ours whether it was said softly or the voice effect changed its level.
 */
export function levelVoice(samples: Float32Array, sampleRate: number): Float32Array {
  const gainDb = planLoudnessGain([samples], sampleRate)
  if (gainDb !== null) applyGainWithLimiter([samples], sampleRate, gainDb)
  return samples
}
