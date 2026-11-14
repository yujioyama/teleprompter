import { describe, expect, it } from 'vitest'
import { fft, shiftFormants } from './formant'

const SR = 16000

/** A buzz at `f0` through one resonance at `formant` Hz. */
function vowel(f0: number, formant: number, seconds = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  for (let h = 1; h * f0 < SR / 2; h++) {
    const f = h * f0
    const amp = 1 / (1 + ((f - formant) / 300) ** 2)
    for (let i = 0; i < out.length; i++) out[i] += 0.05 * amp * Math.sin((2 * Math.PI * f * i) / SR)
  }
  return out
}

/** The spectrum's centre of mass in the middle of `samples`, in Hz. */
function centroidHz(samples: Float32Array): number {
  const n = 4096
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const from = Math.floor((samples.length - n) / 2)
  for (let i = 0; i < n; i++) re[i] = samples[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
  fft(re, im, false)
  let sum = 0
  let weighted = 0
  for (let k = 1; k < n / 2; k++) {
    const power = re[k] * re[k] + im[k] * im[k]
    sum += power
    weighted += power * k
  }
  return (weighted / sum) * (SR / n)
}

describe('fft', () => {
  it('comes back to the input', () => {
    const re = Float64Array.from({ length: 8 }, (_, i) => i)
    const im = new Float64Array(8)
    fft(re, im, false)
    fft(re, im, true)
    expect([...re].map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('shiftFormants', () => {
  it('moves the resonance and keeps the harmonics (the pitch) where they are', () => {
    const before = vowel(200, 1000)
    const after = shiftFormants(before, SR, 1.4)
    expect(after.length).toBe(before.length)
    const moved = centroidHz(after) / centroidHz(before)
    expect(moved).toBeGreaterThan(1.2)
    expect(moved).toBeLessThan(1.6)
  })

  it('leaves the voice alone at a ratio of 1', () => {
    const before = vowel(200, 1000)
    expect(shiftFormants(before, SR, 1)).toBe(before)
  })
})
