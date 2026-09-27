import { describe, it, expect } from 'vitest'
import { findSpeechBounds } from './detectSpeechBounds'

const SR = 16000

// Deterministic pseudo-random noise so the tests never flake.
function makeRng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296 - 0.5
  }
}

interface Part {
  from: number
  to: number
  kind: 'voice' | 'click'
  amp?: number
}

/** A clip of `duration` seconds of room noise at `noiseAmp`, with parts laid on top. */
function makeClip(duration: number, parts: Part[], noiseAmp = 0.002): Float32Array {
  const rng = makeRng()
  const out = new Float32Array(Math.round(duration * SR))
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 * noiseAmp
  for (const p of parts) {
    const amp = p.amp ?? 0.3
    for (let i = Math.round(p.from * SR); i < Math.round(p.to * SR) && i < out.length; i++) {
      out[i] +=
        p.kind === 'voice'
          ? amp * Math.sin((2 * Math.PI * 220 * i) / SR)
          : rng() * 2 * amp
    }
  }
  return out
}

describe('findSpeechBounds', () => {
  it('cuts the silence before and after the speech, keeping the padding', () => {
    const clip = makeClip(5, [{ from: 1, to: 3, kind: 'voice' }])
    const bounds = findSpeechBounds(clip, SR, 0.3, 0.4)
    expect(bounds).not.toBeNull()
    expect(bounds!.start).toBeCloseTo(0.7, 1)
    expect(bounds!.end).toBeCloseTo(3.4, 1)
  })

  it('ignores the record-button tap at the start and the stop tap at the end', () => {
    const clip = makeClip(5, [
      { from: 0.05, to: 0.12, kind: 'click', amp: 0.6 },
      { from: 1, to: 3, kind: 'voice' },
      { from: 4.8, to: 4.87, kind: 'click', amp: 0.6 },
    ])
    const bounds = findSpeechBounds(clip, SR, 0.3, 0.4)
    expect(bounds!.start).toBeCloseTo(0.7, 1)
    expect(bounds!.end).toBeCloseTo(3.4, 1)
  })

  it('does not let the padding reach back into an ignored tap', () => {
    const clip = makeClip(4, [
      { from: 0.3, to: 0.37, kind: 'click', amp: 0.6 },
      { from: 0.9, to: 3, kind: 'voice' },
    ])
    const bounds = findSpeechBounds(clip, SR, 0.8, 0.4)
    // 0.9 - 0.8 = 0.1 would include the tap at 0.3–0.37.
    expect(bounds!.start).toBeGreaterThan(0.37)
    expect(bounds!.start).toBeLessThan(0.9)
  })

  it('still finds the speech over room noise louder than a fixed threshold would allow', () => {
    // ~-36 dBFS of steady noise: the old fixed threshold called all of it speech.
    const clip = makeClip(5, [{ from: 1.5, to: 3.5, kind: 'voice' }], 0.03)
    const bounds = findSpeechBounds(clip, SR, 0.3, 0.4)
    expect(bounds!.start).toBeCloseTo(1.2, 1)
    expect(bounds!.end).toBeCloseTo(3.9, 1)
  })

  it('keeps a short last word that follows a brief pause', () => {
    const clip = makeClip(5, [
      { from: 1, to: 3, kind: 'voice' },
      { from: 3.3, to: 3.5, kind: 'voice' },
    ])
    const bounds = findSpeechBounds(clip, SR, 0.3, 0.4)
    expect(bounds!.end).toBeCloseTo(3.9, 1)
  })

  it('returns null when the speech already fills the clip', () => {
    const clip = makeClip(3, [{ from: 0, to: 3, kind: 'voice' }])
    expect(findSpeechBounds(clip, SR, 0.3, 0.4)).toBeNull()
  })

  it('returns null when there is no speech at all', () => {
    const clip = makeClip(3, [{ from: 0.1, to: 0.15, kind: 'click', amp: 0.6 }])
    expect(findSpeechBounds(clip, SR, 0.3, 0.4)).toBeNull()
  })
})
