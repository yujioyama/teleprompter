import { describe, it, expect } from 'vitest'
import { buildMixFilterComplex } from './mixMusic'

describe('buildMixFilterComplex', () => {
  it('loops the track, fades in/out around the exact video duration, applies volume, then mixes with the original audio', () => {
    const result = buildMixFilterComplex(30, 0.5)
    expect(result).toBe(
      "[1:a]aloop=loop=-1:size=2e9,atrim=0:30.000,afade=t=in:d=1,afade=t=out:st=29.000:d=1,volume=0.5[bgm];" +
      "[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]"
    )
  })

  it('formats a fractional duration to 3 decimal places', () => {
    const result = buildMixFilterComplex(12.3456, 0.8)
    expect(result).toContain('atrim=0:12.346')
    expect(result).toContain('afade=t=out:st=11.346:d=1')
  })

  it('clamps the fade-out start at 0 for a very short video (under 1s)', () => {
    const result = buildMixFilterComplex(0.5, 1)
    expect(result).toContain('afade=t=out:st=0.000:d=1')
  })
})
