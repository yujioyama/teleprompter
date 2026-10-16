import { describe, expect, it } from 'vitest'
import { fairiesForShot, planFairies, fairiesFromSubtitles } from './fairyPlan'

const HOOK = { style: true, sticker: 'right' as const, stickerRoute: 0, fairies: true }
/** The normal subtitles' center, as in the default bottom position; clear of the right finale. */
const POS = 72.29
const shots = (...lines: [string, number][]) => lines.map(([text, duration]) => ({ text, duration }))
const V = shots(['I put *Vaseline*🧴 on', 2], ['It keeps them 💡 neat', 3], ['No emoji here', 2], ['Try it tonight', 2.5])

describe('planFairies', () => {
  it('gives a cameo to middle lines with an emoji and the finale to the last shot', () => {
    const plan = planFairies(V, HOOK, POS)
    expect(plan.map(f => [f.kind, f.emoji])).toEqual([['cameo', '💡'], ['finale', '🧴']])
    expect(plan[0].start).toBeCloseTo(2 + 0.3) // CAMEO_DELAY into shot 1
    expect(plan[0].scale).toBe(0.62)
    expect(plan[1]).toMatchObject({ start: 7, end: expect.closeTo(9.4), scale: 1 })
  })
  it("ignores an emoji on the last line and makes no finale without line 1's", () => {
    expect(planFairies(shots(['Hi', 2], ['Bye 👋', 2]), HOOK, POS)).toEqual([])
  })
  it('needs two shots for a finale', () => expect(planFairies(shots(['Hi 🧴', 3]), HOOK, POS)).toEqual([]))
  it.each([{ sticker: 'off' as const }, { fairies: false }])('makes nothing with %o', over => {
    expect(planFairies(V, { ...HOOK, ...over }, POS)).toEqual([])
  })
  it('compresses a cameo that does not fit, and skips one under 0.8 s', () => {
    const tight = planFairies(shots(['A🧴', 2], ['B 💡', 1.3], ['C', 2]), HOOK, POS)[0]
    expect(tight.end - tight.start).toBeCloseTo(0.9) // 1.3 − 0.3 − 0.1
    expect(planFairies(shots(['A🧴', 2], ['B 💡', 1.19], ['C', 2]), HOOK, POS).map(f => f.kind)).toEqual(['finale'])
  })
  it('does not lose a cameo to floating point on a middle shot of exactly 1.2 s', () => {
    const [cameo] = planFairies(shots(['A🧴', 2], ['B 💡', 1.2], ['C', 2]), HOOK, POS)
    expect(cameo.kind).toBe('cameo')
    expect(cameo.end - cameo.start).toBeCloseTo(0.8)
  })
  it('keeps every appearance and every sparkle inside its shot, 0.1 s before the cut', () => {
    for (const f of planFairies(V, HOOK, POS)) {
      const shotEnd = f.kind === 'finale' ? 9.5 : 5
      expect(f.end).toBeLessThanOrEqual(shotEnd - 0.1 + 1e-9)
      for (const s of f.sparkles) expect(s.born + s.life).toBeLessThanOrEqual(f.end + 1e-9)
    }
  })
  it('is fixed per video and re-rolled by stickerRoute', () => {
    const many = shots(['A🧴', 2], ...Array.from({ length: 8 }, (_, i) => [`line ${i} 💡`, 3] as [string, number]), ['Z', 2])
    expect(planFairies(many, HOOK, POS).map(f => f.key)).toEqual(planFairies(many, HOOK, POS).map(f => f.key))
    expect(planFairies(many, { ...HOOK, stickerRoute: 1 }, POS).map(f => f.key)).not.toEqual(planFairies(many, HOOK, POS).map(f => f.key))
  })
  it('flies a ZWJ or skin-toned emoji as one glyph, the first of two', () => {
    const plan = planFairies(shots(['A🧴', 2], ['Chef 👨‍🍳 and 👍🏽', 3], ['Z', 2]), HOOK, POS)
    expect(plan[0].emoji).toBe('👨‍🍳')
  })
})

describe('the finale and the normal subtitles', () => {
  const T = shots(['A🧴', 2], ['Z', 3])
  /** Where the finale hovers: the end of its fly-in. */
  const landing = (sticker: 'chest' | 'left' | 'right', position: number) => {
    const [finale] = planFairies(T, { ...HOOK, sticker }, position)
    return finale.path(finale.start + 0.6).y
  }
  it('lands above subtitles that sit under or level with it', () => {
    expect(landing('chest', 72.29)).toBeCloseTo(0.5729)
    expect(landing('right', 50)).toBeCloseTo(0.35)
  })
  it('lands below subtitles that sit above it', () => expect(landing('left', 30)).toBeCloseTo(0.45))
  it('stays put when 0.15 or more clear of the subtitles', () => {
    expect(landing('right', 72.29)).toBeCloseTo(0.42)
    expect(landing('chest', 50)).toBeCloseTo(0.66)
  })
  it('stays inside 0.27-0.75', () => expect(landing('chest', 65)).toBeCloseTo(0.75))
  it('re-keys the finale when its home moves, and leaves the cameos alone', () => {
    const keys = (position: number) => planFairies(V, { ...HOOK, sticker: 'chest' }, position).map(f => f.key)
    expect(keys(72.29)[1]).not.toBe(keys(50)[1])
    expect(keys(72.29)[0]).toBe(keys(50)[0])
  })
})

describe('without the hook style', () => {
  it('makes no finale (there is no first-shot sticker to bring back) but keeps the cameos', () => {
    expect(planFairies(V, { ...HOOK, style: false }, POS).map(f => f.kind)).toEqual(['cameo'])
  })
})

describe('keys', () => {
  it("do not depend on earlier shots' durations", () => {
    const keysOf = (first: number) => planFairies(shots(['A🧴', first], ['B 💡', 3], ['C 💡', 3], ['Z', 2]), HOOK, POS).map(f => f.key)
    expect(keysOf(2.7)).toEqual(keysOf(2))
  })
})

describe('fairiesForShot', () => {
  it("moves a shot's appearances into its own timeline", () => {
    const [cameo] = fairiesForShot(planFairies(V, HOOK, POS), 2, 3)
    expect(cameo.start).toBeCloseTo(0.3)
    expect(cameo.path(cameo.start)).toEqual(planFairies(V, HOOK, POS)[0].path(2.3))
    expect(cameo.sparkles[0].born).toBeCloseTo(planFairies(V, HOOK, POS)[0].sparkles[0].born - 2)
    expect(fairiesForShot(planFairies(V, HOOK, POS), 5, 2)).toEqual([])
  })
})

describe('fairiesFromSubtitles', () => {
  const HOOK2 = { style: true, sticker: 'right' as const, stickerRoute: 0, fairies: true }
  const cue = (en: string, start: number) => ({ en, start })

  it('reads each shot\'s emoji from the subtitles starting in it', () => {
    const cues = [cue('I put Vaseline on🧴', 0.2), cue('every night', 1.1), cue('It keeps them', 2.2), cue('neat 💡', 3.4), cue('Try it', 5.2)]
    const plan = fairiesFromSubtitles(cues, [2, 3, 2.5], HOOK2, 72.29)
    expect(plan.map(f => [f.kind, f.emoji])).toEqual([['cameo', '💡'], ['finale', '🧴']])
    expect(plan[0].start).toBeCloseTo(2.3)
  })

  it('has no fairy for a shot whose subtitles have no emoji, whatever the script said', () => {
    const cues = [cue('I put Vaseline on', 0.2), cue('It keeps them neat', 2.2), cue('Try it', 5.2)]
    expect(fairiesFromSubtitles(cues, [2, 3, 2.5], HOOK2, 72.29)).toEqual([])
  })
})
