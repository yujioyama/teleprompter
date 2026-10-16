import { describe, expect, it } from 'vitest'
import { fairiesForShot, planFairies } from './fairyPlan'

const HOOK = { sticker: 'right' as const, stickerRoute: 0, fairies: true }
const shots = (...lines: [string, number][]) => lines.map(([text, duration]) => ({ text, duration }))
const V = shots(['I put *Vaseline*🧴 on', 2], ['It keeps them 💡 neat', 3], ['No emoji here', 2], ['Try it tonight', 2.5])

describe('planFairies', () => {
  it('gives a cameo to middle lines with an emoji and the finale to the last shot', () => {
    const plan = planFairies(V, HOOK)
    expect(plan.map(f => [f.kind, f.emoji])).toEqual([['cameo', '💡'], ['finale', '🧴']])
    expect(plan[0].start).toBeCloseTo(2 + 0.3) // CAMEO_DELAY into shot 1
    expect(plan[0].scale).toBe(0.62)
    expect(plan[1]).toMatchObject({ start: 7, end: expect.closeTo(9.4), scale: 1 })
  })
  it("ignores an emoji on the last line and makes no finale without line 1's", () => {
    expect(planFairies(shots(['Hi', 2], ['Bye 👋', 2]), HOOK)).toEqual([])
  })
  it('needs two shots for a finale', () => expect(planFairies(shots(['Hi 🧴', 3]), HOOK)).toEqual([]))
  it.each([{ sticker: 'off' as const }, { fairies: false }])('makes nothing with %o', over => {
    expect(planFairies(V, { ...HOOK, ...over })).toEqual([])
  })
  it('compresses a cameo that does not fit, and skips one under 0.8 s', () => {
    const tight = planFairies(shots(['A🧴', 2], ['B 💡', 1.3], ['C', 2]), HOOK)[0]
    expect(tight.end - tight.start).toBeCloseTo(0.9) // 1.3 − 0.3 − 0.1
    expect(planFairies(shots(['A🧴', 2], ['B 💡', 1.19], ['C', 2]), HOOK).map(f => f.kind)).toEqual(['finale'])
  })
  it('keeps every appearance and every sparkle inside its shot, 0.1 s before the cut', () => {
    for (const f of planFairies(V, HOOK)) {
      const shotEnd = f.kind === 'finale' ? 9.5 : 5
      expect(f.end).toBeLessThanOrEqual(shotEnd - 0.1 + 1e-9)
      for (const s of f.sparkles) expect(s.born + s.life).toBeLessThanOrEqual(f.end + 1e-9)
    }
  })
  it('is fixed per video and re-rolled by stickerRoute', () => {
    const many = shots(['A🧴', 2], ...Array.from({ length: 8 }, (_, i) => [`line ${i} 💡`, 3] as [string, number]), ['Z', 2])
    expect(planFairies(many, HOOK).map(f => f.key)).toEqual(planFairies(many, HOOK).map(f => f.key))
    expect(planFairies(many, { ...HOOK, stickerRoute: 1 }).map(f => f.key)).not.toEqual(planFairies(many, HOOK).map(f => f.key))
  })
  it('flies a ZWJ or skin-toned emoji as one glyph, the first of two', () => {
    const plan = planFairies(shots(['A🧴', 2], ['Chef 👨‍🍳 and 👍🏽', 3], ['Z', 2]), HOOK)
    expect(plan[0].emoji).toBe('👨‍🍳')
  })
})

describe('fairiesForShot', () => {
  it("moves a shot's appearances into its own timeline", () => {
    const [cameo] = fairiesForShot(planFairies(V, HOOK), 2, 3)
    expect(cameo.start).toBeCloseTo(0.3)
    expect(cameo.path(cameo.start)).toEqual(planFairies(V, HOOK)[0].path(2.3))
    expect(cameo.sparkles[0].born).toBeCloseTo(planFairies(V, HOOK)[0].sparkles[0].born - 2)
    expect(fairiesForShot(planFairies(V, HOOK), 5, 2)).toEqual([])
  })
})
