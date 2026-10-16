import { describe, expect, it } from 'vitest'
import { drawSparkles, emitSparkles } from './sparkles'

const still = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1 })
const base = { path: still, start: 1, end: 3, seed: 7, spread: 0.1, bursts: [], moving: () => true }

describe('emitSparkles', () => {
  it('is the same for the same seed and differs for another', () => {
    expect(emitSparkles(base)).toEqual(emitSparkles(base))
    expect(emitSparkles({ ...base, seed: 8 })).not.toEqual(emitSparkles(base))
  })
  it('dies by the end: born + life ≤ end, life ≥ 0.1, none born after end − 0.1', () => {
    for (const s of emitSparkles(base)) {
      expect(s.born + s.life).toBeLessThanOrEqual(3 + 1e-9)
      expect(s.life).toBeGreaterThanOrEqual(0.1)
      expect(s.born).toBeLessThanOrEqual(2.9 + 1e-9)
    }
  })
  it('trails about 120 per second while moving, twinkles about 7 per second while still', () => {
    expect(emitSparkles(base).length).toBeGreaterThan(200) // 1.9 s × 120, minus clipped tails
    const quiet = emitSparkles({ ...base, moving: () => false })
    expect(quiet.length).toBeGreaterThan(8)
    expect(quiet.length).toBeLessThan(20)
  })
  it('bursts 18 at once, flying outward', () => {
    const burst = emitSparkles({ ...base, moving: () => false, bursts: [2] }).filter(s => s.born === 2)
    expect(burst).toHaveLength(18)
    for (const s of burst) expect(Math.hypot(s.vx, s.vy / (1080 / 1920))).toBeGreaterThanOrEqual(0.18 - 1e-9)
  })
  it("is born on the sprite's edge, flying away from it, so a burst clears the sprite", () => {
    const burst = emitSparkles({ ...base, moving: () => false, bursts: [2] }).filter(s => s.born === 2)
    expect(burst).toHaveLength(18)
    for (const s of burst) {
      const ox = s.x - 0.5
      const oy = (s.y - 0.5) / (1080 / 1920)
      expect(Math.hypot(ox, oy)).toBeCloseTo(0.1, 9)
      expect(ox * s.vx + oy * (s.vy / (1080 / 1920))).toBeGreaterThan(0)
    }
  })
  it.each([[NaN, 3], [1, Infinity], [-Infinity, 3]])('emits nothing for a non-finite span (%s, %s) instead of looping forever', (start, end) => {
    expect(emitSparkles({ ...base, start, end })).toEqual([])
  })
  it('uses only white and gold, radius 10-28', () => {
    for (const s of emitSparkles(base)) {
      expect(['#FFFFFF', '#FAC775']).toContain(s.color)
      expect(s.radius).toBeGreaterThanOrEqual(10)
      expect(s.radius).toBeLessThanOrEqual(28)
    }
  })
})

describe('drawSparkles', () => {
  it('draws only the sparkles alive at t', () => {
    const fills: number[] = []
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, fill() { fills.push(1) }, globalAlpha: 1, fillStyle: '' }
    const s = { born: 1, life: 0.5, x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 10, color: '#FFFFFF' }
    drawSparkles(ctx as never, [s, { ...s, born: 2 }], 1.2, 1080, 1920)
    expect(fills).toHaveLength(1)
  })
})
