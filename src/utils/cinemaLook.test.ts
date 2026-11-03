import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  LOOK_GRAIN,
  LOOK_HAS_DUST,
  buildLut,
  dustSpecs,
  fastTableBuilds,
  glitchParams,
  glitchPixels,
  gradePixels,
  grainNoise,
  lookColor,
  lookStep,
  lutApply,
  releaseLookTables,
  vignetteMask,
} from './cinemaLook'

const COLOR_LOOKS = ['hollywood', 'oldFilm', 'nightBlue', 'mono'] as const

describe('lookColor', () => {
  it('turns everything gray for mono', () => {
    const [r, g, b] = lookColor('mono', 1, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('lifts the blacks of the old film, a little', () => {
    for (const c of lookColor('oldFilm', 0, 0, 0)) expect(c).toBeGreaterThanOrEqual(0.05)
    for (const c of lookColor('oldFilm', 0, 0, 0)) expect(c).toBeLessThan(0.14)
  })

  it('turns a gray blue at night', () => {
    const [r, , b] = lookColor('nightBlue', 0.5, 0.5, 0.5)
    expect(b).toBeGreaterThan(r)
  })

  it('darkens hollywood without tinting it, the shadows most', () => {
    const [r, g, b] = lookColor('hollywood', 0.5, 0.5, 0.5)
    expect(r).toBeCloseTo(g)
    expect(g).toBeCloseTo(b)
    expect(r).toBeLessThan(0.5)
    expect(lookColor('hollywood', 0.2, 0.2, 0.2)[0] / 0.2).toBeLessThan(lookColor('hollywood', 0.8, 0.8, 0.8)[0] / 0.8)
  })
})

describe('the look table', () => {
  it('stays within 2/255 of the look itself', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (const look of COLOR_LOOKS) {
      const lut = buildLut(look)
      for (let i = 0; i < 200; i++) {
        const rgb = [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]
        const got = lutApply(lut, rgb[0], rgb[1], rgb[2])
        const want = lookColor(look, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
        for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - Math.min(1, Math.max(0, want[c])) * 255)).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('vignetteMask', () => {
  it('keeps the middle and darkens the corners by 0.6 × 0.75', () => {
    const m = vignetteMask(1080, 1920)
    expect(m[864 * 1080 + 540]).toBe(1)
    expect(m[0]).toBeCloseTo(1 - 0.6 * 0.75, 2)
  })

  it('is made once per size', () => {
    expect(vignetteMask(1080, 1920)).toBe(vignetteMask(1080, 1920))
    expect(vignetteMask(540, 960)).not.toBe(vignetteMask(1080, 1920))
  })
})

describe('gradePixels', () => {
  it('runs the table then the vignette, and leaves alpha alone', () => {
    const w = 8
    const h = 8
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) data.set([200, 120, 40, 77], i)
    const mask = vignetteMask(w, h)
    const lut = buildLut('nightBlue')
    gradePixels(data, w, h, lut, mask)
    const [r, g, b] = lutApply(lut, 200, 120, 40)
    const p = 3 * w + 4
    // The frame reads a coarser table than lutApply's, so a level or two apart.
    expect(Math.abs(data[p * 4] - r * mask[p])).toBeLessThanOrEqual(2)
    expect(Math.abs(data[p * 4 + 1] - g * mask[p])).toBeLessThanOrEqual(2)
    expect(Math.abs(data[p * 4 + 2] - b * mask[p])).toBeLessThanOrEqual(2)
    expect(data[p * 4 + 3]).toBe(77)
  })
})

describe('gradePixels accuracy', () => {
  it('stays within 2/255 of the look itself, whole frame at once', () => {
    let seed = 11
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const count = 4000
    for (const look of COLOR_LOOKS) {
      const data = new Uint8ClampedArray(count * 4)
      for (let i = 0; i < data.length; i += 4) data.set([rand() * 256, rand() * 256, rand() * 256, 255], i)
      const before = data.slice()
      gradePixels(data, count, 1, buildLut(look), new Float32Array(count).fill(1))
      for (let i = 0; i < data.length; i += 4) {
        const want = lookColor(look, before[i] / 255, before[i + 1] / 255, before[i + 2] / 255)
        for (let c = 0; c < 3; c++) expect(Math.abs(data[i + c] - Math.min(1, Math.max(0, want[c])) * 255)).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('gradePixels with two looks at once', () => {
  let now = 0
  beforeEach(() => {
    releaseLookTables()
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })
  afterEach(() => vi.restoreAllMocks())

  const frame = (seed: number, count: number) => {
    let s = seed
    const data = new Uint8ClampedArray(count * 4)
    for (let i = 0; i < data.length; i += 4) {
      const v: number[] = []
      for (let c = 0; c < 3; c++) {
        s = (s * 1664525 + 1013904223) % 4294967296
        v.push((s / 4294967296) * 256)
      }
      data.set([...v, 255], i)
    }
    return data
  }

  it('builds the fast table once, not every frame, while the looks alternate within a second', () => {
    const before = fastTableBuilds()
    for (let n = 0; n < 40; n++) {
      now = n * 20
      gradePixels(frame(n, 64), 64, 1, buildLut(n % 2 ? 'mono' : 'hollywood'), new Float32Array(64).fill(1))
    }
    expect(fastTableBuilds() - before).toBe(1)
    // a miss a second after the last build rebuilds for the other look
    now = 1500
    gradePixels(frame(1, 64), 64, 1, buildLut('mono'), new Float32Array(64).fill(1))
    expect(fastTableBuilds() - before).toBe(2)
  })

  it('stays within 2/255 of the look while it is graded through the LUT instead', () => {
    const count = 4000
    const mask = new Float32Array(count).map((_, i) => 0.4 + 0.6 * (i / count))
    gradePixels(frame(3, 16), 16, 1, buildLut('hollywood'), new Float32Array(16).fill(1)) // takes the table
    for (const look of ['oldFilm', 'nightBlue', 'mono'] as const) {
      const data = frame(7, count)
      const before = data.slice()
      now += 10
      const builds = fastTableBuilds()
      gradePixels(data, count, 1, buildLut(look), mask)
      expect(fastTableBuilds()).toBe(builds)
      for (let p = 0; p < count; p++) {
        const i = p * 4
        const want = lookColor(look, before[i] / 255, before[i + 1] / 255, before[i + 2] / 255)
        for (let c = 0; c < 3; c++) expect(Math.abs(data[i + c] - Math.min(1, Math.max(0, want[c])) * 255 * mask[p])).toBeLessThanOrEqual(2)
        expect(data[i + 3]).toBe(255)
      }
    }
  })
})

describe('glitch', () => {
  it('is the same for the same step and different for the next', () => {
    expect(glitchParams(5, 1080, 1920)).toEqual(glitchParams(5, 1080, 1920))
    expect(glitchParams(5, 1080, 1920)).not.toEqual(glitchParams(6, 1080, 1920))
  })

  it('rolls the reference’s ranges, scaled to the frame’s width', () => {
    for (let step = 0; step < 50; step++) {
      const { split, bands } = glitchParams(step, 1080, 1920)
      expect(split).toBeGreaterThanOrEqual(12)
      expect(split).toBeLessThanOrEqual(32)
      expect(bands.length).toBeGreaterThanOrEqual(3)
      expect(bands.length).toBeLessThanOrEqual(6)
      for (const band of bands) expect(Math.abs(band.dx)).toBeLessThanOrEqual(120)
    }
  })

  it('only pushes the saturation when nothing is torn or split', () => {
    const w = 4
    const h = 4
    const src = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < src.length; i += 4) src.set([128, 128, 128, 255], i)
    const out = new Uint8ClampedArray(src.length)
    glitchPixels(src, out, w, h, { split: 0, bands: [] }, new Float32Array(w * h).fill(1))
    for (let i = 0; i < out.length; i += 16) {
      expect(out[i]).toBe(out[i + 1])
      expect(out[i + 1]).toBe(out[i + 2])
      expect(out[i + 3]).toBe(255)
    }
  })

  it('pulls red and blue apart by the split, and tears a band sideways', () => {
    const w = 8
    const h = 2
    const src = new Uint8ClampedArray(w * h * 4)
    // A white pixel in column 3 of both rows, black elsewhere.
    for (let y = 0; y < h; y++) src.set([255, 255, 255, 255], (y * w + 3) * 4)
    const out = new Uint8ClampedArray(src.length)
    const mask = new Float32Array(w * h).fill(1)
    glitchPixels(src, out, w, h, { split: 1, bands: [{ y0: 1, h: 1, dx: 2, tint: 0 }] }, mask)
    // Row 0: red is read from x + 1, blue from x - 1, so red shows at 2 and blue at 4.
    expect(out[2 * 4]).toBeGreaterThan(200)
    expect(out[2 * 4 + 2]).toBe(0)
    expect(out[4 * 4 + 2]).toBeGreaterThan(200)
    // Row 1 is shifted: green is read from x + 2, so green shows at 1.
    expect(out[(w + 1) * 4 + 1]).toBeGreaterThan(100)
    expect(out[(w + 3) * 4 + 1]).toBe(0)
  })
})

describe('grainNoise', () => {
  it('is 270×480 mid-gray noise, the same for the same frame', () => {
    const g = grainNoise(0)
    expect(g.length).toBe(270 * 480 * 4)
    let sum = 0
    for (let i = 0; i < g.length; i += 4) sum += g[i]
    expect(Math.abs(sum / (270 * 480) - 128)).toBeLessThan(4)
    expect(Array.from(grainNoise(0).slice(0, 400))).toEqual(Array.from(g.slice(0, 400)))
    expect(Array.from(grainNoise(1).slice(0, 400))).not.toEqual(Array.from(g.slice(0, 400)))
  })
})

describe('dustSpecs', () => {
  it('has 26 specks, 2 hairs and 1-2 scratches', () => {
    for (let frame = 0; frame < 12; frame++) {
      const specs = dustSpecs(frame, 1080, 1920)
      expect(specs.filter(s => s.kind === 'speck')).toHaveLength(26)
      expect(specs.filter(s => s.kind === 'hair')).toHaveLength(2)
      const scratches = specs.filter(s => s.kind === 'scratch').length
      expect(scratches).toBeGreaterThanOrEqual(1)
      expect(scratches).toBeLessThanOrEqual(2)
    }
  })

  it('scales the sizes with the frame’s width, and is the same for the same frame', () => {
    const big = dustSpecs(0, 1080, 1920)[0]
    const small = dustSpecs(0, 540, 960)[0]
    if (big.kind !== 'speck' || small.kind !== 'speck') throw new Error('first spec is a speck')
    expect(big.rx).toBeCloseTo(small.rx * 2, 10)
    expect(big.ry).toBeCloseTo(small.ry * 2, 10)
    expect(dustSpecs(3, 1080, 1920)).toEqual(dustSpecs(3, 1080, 1920))
    expect(dustSpecs(3, 1080, 1920)).not.toEqual(dustSpecs(4, 1080, 1920))
  })
})

describe('lookStep', () => {
  it('changes 12 times a second', () => {
    expect(lookStep(0)).toBe(0)
    expect(lookStep(0.08)).toBe(0)
    expect(lookStep(0.09)).toBe(1)
    expect(lookStep(2)).toBe(24)
  })
})

describe('which looks get grain and dust', () => {
  it('gives grain to the old film, night and mono, and dust only to the old film', () => {
    expect(LOOK_GRAIN).toEqual({ hollywood: 0, oldFilm: 0.4, nightBlue: 0.25, mono: 0.5, glitch: 0 })
    expect(LOOK_HAS_DUST('oldFilm')).toBe(true)
    expect(LOOK_HAS_DUST('mono')).toBe(false)
  })
})
