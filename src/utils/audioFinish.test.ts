import { describe, it, expect } from 'vitest'
import { applyAudioFinish, finishKey, isNoFinish, LOUDNESS_ONLY } from './audioFinish'
import { measureIntegratedLoudness, TARGET_LUFS } from './loudness'

const RATE = 48000

function sine(amplitude: number, freq: number, seconds = 3): Float32Array[] {
  const ch = new Float32Array(RATE * seconds)
  for (let i = 0; i < ch.length; i++) ch[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE)
  return [ch, ch.slice()]
}

describe('applyAudioFinish', () => {
  it('only corrects the loudness without a voice preset', () => {
    const channels = sine(0.05, 1000)
    const untouched = channels[0].slice()
    expect(applyAudioFinish(channels, RATE, LOUDNESS_ONLY)).toBe(true)
    expect(measureIntegratedLoudness(channels, RATE)).toBeCloseTo(TARGET_LUFS, 1)
    // A pure gain: the waveform's shape is the same.
    expect(channels[0][1000] / untouched[1000]).toBeCloseTo(channels[0][2000] / untouched[2000], 5)
  })

  it('applies the voice preset, then brings it to the target loudness', () => {
    const channels = sine(0.05, 40)
    expect(applyAudioFinish(channels, RATE, { voice: 'natural', normalize: true })).toBe(true)
    // The 40 Hz rumble is cut, and the rest still reaches the target (within the boost cap).
    expect(measureIntegratedLoudness(channels, RATE)).toBeLessThan(TARGET_LUFS + 0.5)
  })

  it('applies the voice preset alone, keeping the level, when loudness correction is off', () => {
    const channels = sine(0.05, 1000)
    const before = measureIntegratedLoudness(channels, RATE)
    expect(applyAudioFinish(channels, RATE, { voice: 'radio', normalize: false })).toBe(true)
    expect(measureIntegratedLoudness(channels, RATE)).toBeCloseTo(before, 0)
  })

  it('changes nothing with neither', () => {
    const channels = sine(0.05, 1000)
    const untouched = channels[0].slice()
    expect(applyAudioFinish(channels, RATE, { voice: 'none', normalize: false })).toBe(false)
    expect(channels[0]).toEqual(untouched)
  })
})

describe('isNoFinish / finishKey', () => {
  it('tells apart every combination', () => {
    expect(isNoFinish({ voice: 'none', normalize: false })).toBe(true)
    expect(isNoFinish(LOUDNESS_ONLY)).toBe(false)
    expect(isNoFinish({ voice: 'natural', normalize: false })).toBe(false)
    const keys = new Set(
      (['none', 'natural', 'radio'] as const).flatMap(voice => [true, false].map(normalize => finishKey({ voice, normalize }))),
    )
    expect(keys.size).toBe(6)
  })
})
