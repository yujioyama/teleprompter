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
 * - olderWoman / youngWoman / olderMan / youngMan (2026-11-15) tell two
 *   people of one kind apart: besides pitch and formants they change the
 *   pace alone (tempo, the pitch kept), the older ones a little slower and
 *   darker, the younger ones a little quicker and brighter; phoneOlderWoman
 *   and the rest are those down a phone line
 *
 * The voices there were before keep their names and sound, so a script
 * made with them comes out as it did.
 */
export const HEARD_VOICES = [
  'natural', 'kid', 'high', 'low', 'fast', 'slow', 'phone', 'phoneKid', 'phoneHigh', 'phoneLow',
  'olderWoman', 'youngWoman', 'olderMan', 'youngMan',
  'phoneOlderWoman', 'phoneYoungWoman', 'phoneOlderMan', 'phoneYoungMan',
] as const
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
  olderWoman: '年上の女の人（母・先輩）',
  youngWoman: '若い女の人（店員・美容師）',
  olderMan: '年上の男の人（上司・父）',
  youngMan: '若い男の人（同僚・友達）',
  phoneOlderWoman: '電話（年上の女の人）',
  phoneYoungWoman: '電話（若い女の人）',
  phoneOlderMan: '電話（年上の男の人）',
  phoneYoungMan: '電話（若い男の人）',
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
  /** Spoken this many times quicker at the same pitch. */
  tempo?: number
  /** What is left of the sound above DARK_HZ (below 1: a darker, older voice). */
  dark?: number
  phone?: boolean
}

const KID: VoiceShape = { pitch: semitones(11), formant: 1.45 }
const HIGH: VoiceShape = { pitch: semitones(7), formant: 1.12 }
// Our own voice is a man's already. Pitch alone a little lower still sounds
// like us, and much lower is a monster: another man is mostly in the body
// (the formants), so those go down further than the pitch does.
const LOW: VoiceShape = { pitch: semitones(-3), formant: 0.9 }
// Each a few steps from its neighbour in pitch, body and pace at once, so
// high and olderWoman, or low and olderMan, side by side are two people.
// Below high and slower, with less brightness: someone settled.
const OLDER_WOMAN: VoiceShape = { pitch: semitones(4.5), formant: 1.05, tempo: 0.9 }
// Above high, brighter and a little quick.
const YOUNG_WOMAN: VoiceShape = { pitch: semitones(9), formant: 1.17, tempo: 1.08 }
// Our own voice is a man's already: -5 semitones and a much bigger body
// (0.84) sounded like a demon, and -1 like us. A little lower and bigger,
// slower, and darker (older voices have less brightness), picked by ear.
const OLDER_MAN: VoiceShape = { pitch: semitones(-2.5), formant: 0.92, tempo: 0.85, dark: 0.55 }
// Hardly lower than our own, but a slimmer body and a quicker pace, so it isn't us.
const YOUNG_MAN: VoiceShape = { pitch: semitones(1), formant: 0.94, tempo: 1.1 }

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
  olderWoman: OLDER_WOMAN,
  youngWoman: YOUNG_WOMAN,
  olderMan: OLDER_MAN,
  youngMan: YOUNG_MAN,
  phoneOlderWoman: { ...OLDER_WOMAN, phone: true },
  phoneYoungWoman: { ...YOUNG_WOMAN, phone: true },
  phoneOlderMan: { ...OLDER_MAN, phone: true },
  phoneYoungMan: { ...YOUNG_MAN, phone: true },
}

/** A voice heard down a phone line (電話, and the kid / woman / man on the phone). */
export function isPhoneVoice(voice: HeardVoice | undefined): boolean {
  return Boolean(voice && SHAPES[voice].phone)
}

/** How many times quicker the line plays in this voice (1 unless 早回し / スロー or one with its own pace). */
export function voiceSpeed(voice: HeardVoice | undefined): number {
  const shape = SHAPES[voice ?? 'natural']
  return (shape.speed ?? 1) * (shape.tempo ?? 1)
}

/** `samples` (mono) in the given voice. Its length is the input's divided by voiceSpeed. */
export function shapeVoice(samples: Float32Array, sampleRate: number, voice: HeardVoice | undefined): Float32Array {
  const shape = SHAPES[voice ?? 'natural']
  let out = samples
  // Higher without quicker: made longer at the same pitch, then played that much faster.
  // A tempo of its own is the same stretch, by that much less, before the same resample.
  if (shape.pitch) {
    const tempo = shape.tempo ?? 1
    out = resample(timeStretch(out, sampleRate, shape.pitch / tempo), shape.pitch, Math.round(samples.length / tempo))
    // The shift took the formants up with the pitch: back to where they belong.
    out = shiftFormants(out, sampleRate, (shape.formant ?? 1) / shape.pitch)
  }
  if (shape.dark !== undefined) out = darken(out, sampleRate, shape.dark)
  if (shape.speed) out = resample(out, shape.speed)
  if (shape.phone) out = telephone(out, sampleRate)
  return out
}

const DARK_HZ = 2500

/** `samples` with what is above DARK_HZ turned down to `keep` of its level (a gentle high shelf). */
export function darken(samples: Float32Array, sampleRate: number, keep: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * DARK_HZ) / sampleRate)
  const out = new Float32Array(samples.length)
  let low = 0
  for (let i = 0; i < samples.length; i++) {
    low = (1 - a) * samples[i] + a * low
    out[i] = low + keep * (samples[i] - low)
  }
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

/**
 * 心の声: how much echo the thought's voice is given. The voice stays our
 * own (no pitch or pace change); the echo and a softer top end make it the
 * voice in our head.
 */
export const THOUGHT_ECHOES = ['light', 'medium', 'strong'] as const
export type ThoughtEcho = (typeof THOUGHT_ECHOES)[number]
export const THOUGHT_ECHO_LABELS: Record<ThoughtEcho, string> = {
  light: '弱め',
  medium: 'ふつう',
  strong: '強め',
}
export function isThoughtEcho(value: unknown): value is ThoughtEcho {
  return typeof value === 'string' && (THOUGHT_ECHOES as readonly string[]).includes(value)
}

/** How much of the echo is mixed in, and how long it rings (the comb filters' feedback). */
const ECHO_SHAPES: Record<ThoughtEcho, { wet: number; feedback: number }> = {
  light: { wet: 0.22, feedback: 0.7 },
  medium: { wet: 0.34, feedback: 0.78 },
  strong: { wet: 0.48, feedback: 0.84 },
}
/** Above this the thought is softened, as a voice heard from inside is. */
const THOUGHT_MUFFLE_HZ = 4500
// Schroeder's reverb: four combs side by side, then two all-passes, at these
// delays (ms) — mutually prime-ish, so the echoes don't pile up on one note.
const COMB_MS = [29.7, 37.1, 41.1, 43.7]
const ALLPASS_MS = [5.0, 1.7]
const ALLPASS_GAIN = 0.7
/** How long the echo rings on after the voice, at most. */
export const THOUGHT_TAIL_S = 0.6

/**
 * `samples` (mono) as a thought: the same voice, its top end softened, with
 * an echo of `echo`'s strength. The result runs THOUGHT_TAIL_S longer, for
 * the echo to ring out.
 */
export function thinkingVoice(samples: Float32Array, sampleRate: number, echo: ThoughtEcho = 'medium'): Float32Array {
  const { wet, feedback } = ECHO_SHAPES[echo]
  const length = samples.length + Math.round(THOUGHT_TAIL_S * sampleRate)
  const dry = new Float32Array(length)
  dry.set(samples)
  biquad(dry, sampleRate, 'lowpass', Math.min(THOUGHT_MUFFLE_HZ, sampleRate * 0.45))
  const echoed = new Float32Array(length)
  for (const ms of COMB_MS) {
    const delay = Math.max(1, Math.round((ms / 1000) * sampleRate))
    const line = new Float32Array(delay)
    let at = 0
    for (let i = 0; i < length; i++) {
      const out = line[at]
      line[at] = dry[i] + out * feedback
      echoed[i] += out / COMB_MS.length
      at = (at + 1) % delay
    }
  }
  for (const ms of ALLPASS_MS) {
    const delay = Math.max(1, Math.round((ms / 1000) * sampleRate))
    const line = new Float32Array(delay)
    let at = 0
    for (let i = 0; i < length; i++) {
      const buffered = line[at]
      const input = echoed[i]
      const out = -ALLPASS_GAIN * input + buffered
      line[at] = input + ALLPASS_GAIN * out
      echoed[i] = out
      at = (at + 1) % delay
    }
  }
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = (1 - wet) * dry[i] + wet * echoed[i] * 2
  return out
}
