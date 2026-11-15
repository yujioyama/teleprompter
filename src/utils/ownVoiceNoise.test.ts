import { describe, expect, it } from 'vitest'
import { reduceOwnVoiceNoise } from './ownVoiceNoise'

const RATE = 48000

/** A seeded noise source, so the test is the same every run. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

/** 3 s: hiss throughout at about -40 dBFS, and a voice-like tone from 1 s to 2 s. */
function take(): Float32Array {
  const rand = random(7)
  const out = new Float32Array(RATE * 3)
  for (let i = 0; i < out.length; i++) {
    out[i] = rand() * 0.035
    if (i >= RATE && i < RATE * 2) {
      const t = (2 * Math.PI * 180 * i) / RATE
      out[i] += 0.3 * Math.sin(t) + 0.15 * Math.sin(2 * t) + 0.08 * Math.sin(3 * t) + 0.04 * Math.sin(5 * t)
    }
  }
  return out
}

function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return 10 * Math.log10(sum / (to - from))
}

const QUIET = [Math.round(RATE * 0.2), Math.round(RATE * 0.8)] as const
const VOICE = [Math.round(RATE * 1.2), Math.round(RATE * 1.8)] as const

describe('reduceOwnVoiceNoise', () => {
  it.each([
    ['light', 5],
    ['medium', 9],
    ['strong', 12],
  ] as const)('turns the hiss down (%s) and leaves the voice as loud', (strength, atLeastDb) => {
    const before = take()
    const after = Float32Array.from(before)
    expect(reduceOwnVoiceNoise([after], strength)).toBe(true)
    expect(rmsDb(before, ...QUIET) - rmsDb(after, ...QUIET)).toBeGreaterThan(atLeastDb)
    expect(Math.abs(rmsDb(before, ...VOICE) - rmsDb(after, ...VOICE))).toBeLessThan(1)
  })

  it('goes stronger as asked, but never cuts the gaps to silence', () => {
    const quietAfter = (strength: 'light' | 'medium' | 'strong') => {
      const a = take()
      reduceOwnVoiceNoise([a], strength)
      return rmsDb(a, ...QUIET)
    }
    const original = rmsDb(take(), ...QUIET)
    expect(quietAfter('light')).toBeGreaterThan(quietAfter('medium'))
    expect(quietAfter('medium')).toBeGreaterThan(quietAfter('strong'))
    expect(original - quietAfter('strong')).toBeLessThan(20)
  })

  it('keeps the voice the same shape: what comes out is close to the clean tone', () => {
    const noisy = take()
    const clean = take().map((v, i) => (i >= RATE && i < RATE * 2 ? v : 0))
    reduceOwnVoiceNoise([noisy], 'medium')
    let err = 0
    let sig = 0
    for (let i = VOICE[0]; i < VOICE[1]; i++) {
      err += (noisy[i] - clean[i]) ** 2
      sig += clean[i] ** 2
    }
    // The leftover hiss and any distortion together stay well under the voice.
    expect(10 * Math.log10(sig / err)).toBeGreaterThan(20)
  })

  it('gives both channels of a stereo take the same treatment', () => {
    const left = take()
    const right = Float32Array.from(left)
    expect(reduceOwnVoiceNoise([left, right], 'medium')).toBe(true)
    expect(Array.from(right)).toEqual(Array.from(left))
  })

  it('leaves the take alone when off, or when there is no noise at all', () => {
    const a = take()
    expect(reduceOwnVoiceNoise([a], 'off')).toBe(false)
    expect(Array.from(a)).toEqual(Array.from(take()))
    const silent = new Float32Array(RATE * 2)
    expect(reduceOwnVoiceNoise([silent], 'strong')).toBe(false)
  })
})
