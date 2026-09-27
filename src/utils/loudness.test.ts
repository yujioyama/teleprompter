import { describe, it, expect } from 'vitest'
import {
  PEAK_CEILING_DB,
  TARGET_LUFS,
  applyGainWithLimiter,
  measureIntegratedLoudness,
  planLoudnessGain,
} from './loudness'

function sine(amplitude: number, seconds: number, sampleRate: number, freq = 1000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

function stereo(ch: Float32Array): Float32Array[] {
  return [ch, ch.slice()]
}

function peakOf(channels: Float32Array[]): number {
  let peak = 0
  for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v))
  return peak
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

describe('measureIntegratedLoudness (ITU-R BS.1770)', () => {
  // BS.1770's reference point: a 1 kHz sine at 0 dBFS in one channel of
  // stereo reads -3.01 LUFS, so the same sine in both reads 0 LUFS and a
  // stereo sine at amplitude A reads 20*log10(A) LUFS.
  it('reads a stereo 1 kHz sine at -20 dBFS as -20 LUFS at 48 kHz', () => {
    const lufs = measureIntegratedLoudness(stereo(sine(0.1, 5, 48000)), 48000)
    expect(lufs).toBeCloseTo(-20, 1)
  })

  it('gives the same reading at 44.1 kHz', () => {
    const lufs = measureIntegratedLoudness(stereo(sine(0.1, 5, 44100)), 44100)
    expect(lufs).toBeCloseTo(-20, 1)
  })

  it('reads a single channel at 3 dB below the same signal in stereo', () => {
    const lufs = measureIntegratedLoudness([sine(1, 5, 48000)], 48000)
    expect(lufs).toBeCloseTo(-3.01, 1)
  })

  it('gates out silence, so pauses between lines do not drag the reading down', () => {
    const rate = 48000
    const tone = sine(0.1, 3, rate)
    const withPauses = new Float32Array(tone.length + rate * 6)
    withPauses.set(tone, rate * 3)
    // The 6 s of silence are gated out entirely. What's left is the tone's
    // 27 whole blocks plus the 6 blocks straddling its edges (3/4, 2/4 and
    // 1/4 tone on each side), which BS.1770 keeps: 30 blocks' worth of
    // energy over 33 blocks.
    const expected = -20 + 10 * Math.log10(30 / 33)
    expect(measureIntegratedLoudness(stereo(withPauses), rate)).toBeCloseTo(expected, 1)
  })

  it('returns -Infinity for silence or a clip shorter than one 400 ms block', () => {
    expect(measureIntegratedLoudness(stereo(new Float32Array(48000 * 2)), 48000)).toBe(-Infinity)
    expect(measureIntegratedLoudness(stereo(sine(0.5, 0.3, 48000)), 48000)).toBe(-Infinity)
  })
})

describe('planLoudnessGain', () => {
  it('boosts a quiet recording up to the target', () => {
    const channels = stereo(sine(0.05, 5, 48000))
    const measured = measureIntegratedLoudness(channels, 48000)
    const gainDb = planLoudnessGain(channels, 48000)
    expect(gainDb).not.toBeNull()
    expect(measured + gainDb!).toBeCloseTo(TARGET_LUFS, 1)
  })

  it('turns down a recording louder than the target', () => {
    const gainDb = planLoudnessGain(stereo(sine(0.5, 5, 48000)), 48000)
    expect(gainDb).toBeLessThan(0)
  })

  it('leaves audio already at the target untouched', () => {
    const channels = stereo(sine(dbToGain(TARGET_LUFS + 0.2), 5, 48000))
    expect(planLoudnessGain(channels, 48000)).toBeNull()
  })

  it('leaves silent audio untouched instead of boosting noise', () => {
    expect(planLoudnessGain(stereo(new Float32Array(48000 * 2)), 48000)).toBeNull()
  })

  it('caps the boost, so near-silent room noise is not blown up', () => {
    const gainDb = planLoudnessGain(stereo(sine(0.0005, 5, 48000)), 48000)
    expect(gainDb).toBe(20)
  })
})

describe('applyGainWithLimiter', () => {
  it('applies a plain gain when no peak would cross the ceiling', () => {
    const channels = stereo(sine(0.1, 1, 48000))
    const before = channels[0].slice()
    applyGainWithLimiter(channels, 48000, 6)
    for (let i = 0; i < before.length; i += 997) {
      expect(channels[0][i]).toBeCloseTo(before[i] * dbToGain(6), 5)
    }
  })

  it('never lets a peak through above the ceiling', () => {
    const rate = 48000
    const speechLike = sine(0.1, 2, rate)
    // A few sharp transients — the plosives that make speech's peaks sit far
    // above its loudness — right where the boost would clip them.
    for (const at of [1000, 30000, 60000, 95000]) speechLike[at] = 0.9
    const channels = stereo(speechLike)
    applyGainWithLimiter(channels, rate, 12)
    expect(peakOf(channels)).toBeLessThanOrEqual(dbToGain(PEAK_CEILING_DB) + 1e-6)
  })

  it('limits only around the transient, leaving the rest at full gain', () => {
    const rate = 48000
    const signal = sine(0.1, 2, rate)
    signal[rate] = 0.9
    const channels = stereo(signal)
    const before = signal.slice()
    applyGainWithLimiter(channels, rate, 12)
    // Well before the transient (beyond the lookahead) the gain is untouched...
    const early = Math.round(rate * 0.5) + 3
    expect(channels[0][early]).toBeCloseTo(before[early] * dbToGain(12), 4)
    // ...and a second after it, the release has fully recovered.
    const late = rate * 2 - 5
    expect(channels[0][late]).toBeCloseTo(before[late] * dbToGain(12), 3)
  })
})
