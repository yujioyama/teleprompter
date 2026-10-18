import { describe, expect, it } from 'vitest'
import { bgmFadeOut, punchlineStart, STOP_FADE_SECONDS, STOP_GAP_SECONDS } from './bgmStop'
import { buildMixFilterComplex } from './mixMusic'

describe('punchlineStart', () => {
  it('is where the last shot begins', () => {
    expect(punchlineStart([3, 4.5, 2], true)).toBeCloseTo(7.5)
  })
  it('is null when switched off or with a single shot', () => {
    expect(punchlineStart([3, 4.5, 2], false)).toBeNull()
    expect(punchlineStart([60], true)).toBeNull()
  })
})

describe('bgmFadeOut', () => {
  it('fades over the last second without a stop', () => {
    expect(bgmFadeOut(70)).toEqual({ start: 69, length: 1 })
  })
  it('is gone a moment before the punchline', () => {
    const fade = bgmFadeOut(70, 65)
    expect(fade.length).toBe(STOP_FADE_SECONDS)
    expect(fade.start + fade.length).toBeCloseTo(65 - STOP_GAP_SECONDS)
  })
  it('keeps the usual fade when the stop would cut into the fade in or come too late', () => {
    expect(bgmFadeOut(70, 1)).toEqual({ start: 69, length: 1 })
    expect(bgmFadeOut(70, 69.9)).toEqual({ start: 69, length: 1 })
  })
})

describe('buildMixFilterComplex with a stop', () => {
  it('fades the BGM out before the punchline', () => {
    expect(buildMixFilterComplex(70, 0.3, 65)).toContain('afade=t=out:st=64.350:d=0.5')
  })
  it('is unchanged without one', () => {
    expect(buildMixFilterComplex(70, 0.3)).toContain('afade=t=out:st=69.000:d=1')
  })
})
