import { describe, expect, it } from 'vitest'
import {
  bgmEnding,
  bgmEnvelope,
  DUCK_FADE_SECONDS,
  DUCK_LEVEL,
  punchlineStart,
  SOFT_END_FADE_SECONDS,
  STOP_FADE_SECONDS,
  STOP_GAP_SECONDS,
} from './bgmStop'
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

describe('bgmEnding', () => {
  it('is soft for the quiet genres only', () => {
    expect(bgmEnding('warmpiano', 65)).toEqual({ stopAt: 65, soft: true })
    expect(bgmEnding('musicbox', null)).toEqual({ stopAt: null, soft: true })
    expect(bgmEnding('pop', 65)).toEqual({ stopAt: 65, soft: false })
    expect(bgmEnding('lofi', 65).soft).toBe(false)
  })
})

describe('bgmEnvelope', () => {
  it('fades over the last second without a stop', () => {
    expect(bgmEnvelope(70)).toEqual({ duck: null, fadeOut: { start: 69, length: 1 } })
  })
  it('is gone a moment before the punchline', () => {
    const { duck, fadeOut } = bgmEnvelope(70, { stopAt: 65, soft: false })
    expect(duck).toBeNull()
    expect(fadeOut.length).toBe(STOP_FADE_SECONDS)
    expect(fadeOut.start + fadeOut.length).toBeCloseTo(65 - STOP_GAP_SECONDS)
  })
  it('keeps the usual fade when the stop would cut into the fade in or come too late', () => {
    expect(bgmEnvelope(70, { stopAt: 1, soft: false }).fadeOut).toEqual({ start: 69, length: 1 })
    expect(bgmEnvelope(70, { stopAt: 69.9, soft: false }).fadeOut).toEqual({ start: 69, length: 1 })
  })

  describe('soft', () => {
    it('fades slowly over the last seconds without a stop', () => {
      expect(bgmEnvelope(70, { stopAt: null, soft: true })).toEqual({
        duck: null,
        fadeOut: { start: 70 - SOFT_END_FADE_SECONDS, length: SOFT_END_FADE_SECONDS },
      })
    })
    it('is lowered, not stopped, just before the punchline, then fades slowly', () => {
      const { duck, fadeOut } = bgmEnvelope(70, { stopAt: 63, soft: true })
      expect(duck).not.toBeNull()
      expect(duck!.level).toBe(DUCK_LEVEL)
      expect(duck!.length).toBe(DUCK_FADE_SECONDS)
      expect(duck!.start + duck!.length).toBeCloseTo(63 - STOP_GAP_SECONDS)
      expect(fadeOut).toEqual({ start: 70 - SOFT_END_FADE_SECONDS, length: SOFT_END_FADE_SECONDS })
    })
    it('starts the slow fade once lowered when the punchline is shorter than it', () => {
      const { duck, fadeOut } = bgmEnvelope(70, { stopAt: 68, soft: true })
      expect(fadeOut.start).toBeCloseTo(duck!.start + duck!.length)
      expect(fadeOut.start + fadeOut.length).toBeCloseTo(70)
    })
    it('skips the lowering when it would cut into the fade in or leave too short a fade', () => {
      expect(bgmEnvelope(70, { stopAt: 1, soft: true }).duck).toBeNull()
      expect(bgmEnvelope(70, { stopAt: 69.5, soft: true })).toEqual({
        duck: null,
        fadeOut: { start: 70 - SOFT_END_FADE_SECONDS, length: SOFT_END_FADE_SECONDS },
      })
    })
  })
})

describe('buildMixFilterComplex with a stop', () => {
  it('fades the BGM out before the punchline', () => {
    expect(buildMixFilterComplex(70, 0.3, { stopAt: 65, soft: false })).toContain('afade=t=out:st=64.350:d=0.5')
  })
  it('is unchanged without one', () => {
    expect(buildMixFilterComplex(70, 0.3)).toContain('afade=t=out:st=69.000:d=1')
  })
  it('lowers a soft BGM under the punchline and fades it out slowly', () => {
    const filter = buildMixFilterComplex(70, 0.3, { stopAt: 63, soft: true })
    expect(filter).toContain("volume='if(lt(t,62.050),1,if(lt(t,62.850),1-0.65*(t-62.050)/0.8,0.35))':eval=frame")
    expect(filter).toContain('afade=t=out:st=67.000:d=3')
  })
})
