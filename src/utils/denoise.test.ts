import { describe, expect, it } from 'vitest'
import { reduceNoise } from './denoise'
import { rms } from './voiceEffects'

const RATE = 48000

/** Repeatable white noise (a small LCG), at `level` RMS. */
function hiss(length: number, level: number, seed = 1): Float32Array {
  const out = new Float32Array(length)
  let s = seed
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = ((s / 2 ** 32) * 2 - 1) * level * Math.sqrt(3)
  }
  return out
}

/** 0.5s of hiss, 1s of a voice-like tone over the hiss, 0.5s of hiss. */
function recording() {
  const quiet = RATE / 2
  const loud = RATE
  const samples = hiss(quiet * 2 + loud, 0.005)
  for (let i = 0; i < loud; i++) samples[quiet + i] += 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return { samples, quiet, loud }
}

const db = (a: number, b: number) => 20 * Math.log10(a / b)

describe('reduceNoise', () => {
  it('turns the hiss down where nobody is talking', () => {
    const { samples, quiet } = recording()
    const clean = reduceNoise(samples)
    // Away from the edges of the line, where the release is still fading.
    const before = rms(samples.subarray(2048, quiet - 4096))
    const after = rms(clean.subarray(2048, quiet - 4096))
    expect(db(before, after)).toBeGreaterThan(12)
  })

  it('keeps the voice at its level and the length as it was', () => {
    const { samples, quiet, loud } = recording()
    const clean = reduceNoise(samples)
    expect(clean.length).toBe(samples.length)
    const voice = (s: Float32Array) => rms(s.subarray(quiet + 4096, quiet + loud - 4096))
    expect(Math.abs(db(voice(samples), voice(clean)))).toBeLessThan(0.5)
  })

  it('leaves a recording alone when there is no quiet to learn the hiss from', () => {
    const tone = new Float32Array(RATE)
    for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)
    expect(reduceNoise(tone)).toBe(tone)
  })

  it('leaves a very short recording alone', () => {
    const short = hiss(2000, 0.01)
    expect(reduceNoise(short)).toBe(short)
  })
})
