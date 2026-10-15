import { describe, it, expect } from 'vitest'
import { applyVoicePreset, type VoicePreset } from './voicePreset'
import { measureIntegratedLoudness } from './loudness'

const RATE = 48000

function tones(seconds: number, parts: { freq: number; amplitude: number }[]): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) {
    let v = 0
    for (const { freq, amplitude } of parts) v += amplitude * Math.sin((2 * Math.PI * freq * i) / RATE)
    out[i] = v
  }
  return out
}

function stereo(ch: Float32Array): Float32Array[] {
  return [ch, ch.slice()]
}

/** Amplitude of `freq` in `samples[from, to)` (Goertzel), as dB. */
function levelAt(samples: Float32Array, freq: number, from = RATE, to = samples.length): number {
  const w = (2 * Math.PI * freq) / RATE
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    const s = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return 20 * Math.log10((2 * Math.sqrt(power)) / (to - from))
}

function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return 10 * Math.log10(sum / (to - from))
}

/** How far `freq` moved against 1 kHz after the preset, in dB. */
function tiltAt(freq: number, preset: VoicePreset): number {
  const input = tones(3, [{ freq, amplitude: 0.05 }, { freq: 1000, amplitude: 0.05 }])
  const before = levelAt(input, freq) - levelAt(input, 1000)
  const channels = stereo(input.slice())
  applyVoicePreset(channels, RATE, preset)
  return levelAt(channels[0], freq) - levelAt(channels[0], 1000) - before
}

/** A line 6 dB louder than the next: the gap between them, in dB, after the preset. */
function loudQuietGap(preset: VoicePreset, scale = 1): number {
  const loud = tones(2, [{ freq: 1000, amplitude: 0.1 * scale }])
  const quiet = tones(2, [{ freq: 1000, amplitude: 0.05 * scale }])
  const input = new Float32Array(loud.length + quiet.length)
  input.set(loud)
  input.set(quiet, loud.length)
  const channels = stereo(input)
  applyVoicePreset(channels, RATE, preset)
  // The middle of each half, clear of the attack and release.
  return rmsDb(channels[0], RATE * 0.5, RATE * 1.5) - rmsDb(channels[0], RATE * 2.5, RATE * 3.5)
}

describe('applyVoicePreset', () => {
  it('leaves the audio untouched for none', () => {
    const input = tones(2, [{ freq: 200, amplitude: 0.1 }])
    const channels = stereo(input.slice())
    expect(applyVoicePreset(channels, RATE, 'none')).toBe(false)
    expect(channels[0]).toEqual(input)
  })

  it('leaves silence untouched', () => {
    const channels = stereo(new Float32Array(RATE * 2))
    expect(applyVoicePreset(channels, RATE, 'radio')).toBe(false)
    expect(channels[0].every(v => v === 0)).toBe(true)
  })

  it.each(['natural', 'radio'] as const)('keeps the loudness the voice had (%s)', preset => {
    const channels = stereo(tones(3, [{ freq: 300, amplitude: 0.05 }, { freq: 3000, amplitude: 0.03 }]))
    const before = measureIntegratedLoudness(channels, RATE)
    expect(applyVoicePreset(channels, RATE, preset)).toBe(true)
    expect(measureIntegratedLoudness(channels, RATE)).toBeCloseTo(before, 0)
  })

  it.each(['natural', 'radio'] as const)('cuts rumble below the voice (%s)', preset => {
    expect(tiltAt(40, preset)).toBeLessThan(-10)
  })

  it('takes out some boxiness, more for radio', () => {
    const natural = tiltAt(300, 'natural')
    const radio = tiltAt(330, 'radio')
    expect(natural).toBeLessThan(-1.5)
    expect(radio).toBeLessThan(natural)
  })

  it('brings the voice forward around 4 kHz, more for radio', () => {
    const natural = tiltAt(4000, 'natural')
    const radio = tiltAt(3500, 'radio')
    expect(natural).toBeGreaterThan(1.5)
    expect(radio).toBeGreaterThan(natural)
  })

  it('adds air above 10 kHz', () => {
    expect(tiltAt(12000, 'natural')).toBeGreaterThan(1)
    expect(tiltAt(12000, 'radio')).toBeGreaterThan(tiltAt(12000, 'natural'))
  })

  it('evens out loud and quiet lines, radio the most', () => {
    const untouched = 6
    const natural = loudQuietGap('natural')
    const radio = loudQuietGap('radio')
    expect(natural).toBeLessThan(untouched - 1)
    expect(radio).toBeLessThan(natural - 1.5)
  })

  it('compresses the same however loud the take was recorded', () => {
    expect(loudQuietGap('radio', 0.25)).toBeCloseTo(loudQuietGap('radio', 1), 0)
  })

  it('handles mono', () => {
    const channels = [tones(2, [{ freq: 1000, amplitude: 0.1 }])]
    expect(applyVoicePreset(channels, RATE, 'natural')).toBe(true)
    expect(channels[0].every(Number.isFinite)).toBe(true)
  })
})
