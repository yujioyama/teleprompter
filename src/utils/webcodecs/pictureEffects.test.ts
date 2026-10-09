import { describe, it, expect, vi } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { BLUR_LAYERS, drawImpactFrame, drawZoomed } from './pictureEffects'

/** A 2D context that records the state each draw happened in. */
function recordingCtx(name: string) {
  const ops: { op: string; ctx: string; alpha?: number; mode?: string; fill?: string }[] = []
  const ctx = {
    name,
    canvas: { name },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    fillRect() {
      ops.push({ op: 'fillRect', ctx: name, mode: this.globalCompositeOperation, fill: String(this.fillStyle) })
    },
    drawImage() {
      ops.push({ op: 'drawImage', ctx: name, mode: this.globalCompositeOperation })
    },
  }
  return { ctx, ops }
}

function recordingSample() {
  const draws: { ctx: string; alpha: number; x: number; y: number; w: number; h: number }[] = []
  const sample = {
    draw: vi.fn((ctx: { name: string; globalAlpha: number }, x: number, y: number, w: number, h: number) =>
      draws.push({ ctx: ctx.name, alpha: ctx.globalAlpha, x, y, w, h })),
  }
  return { sample: sample as unknown as VideoSample, draws }
}

describe('drawZoomed', () => {
  it('scales about (50%, 40%), shifted by dx', () => {
    const { ctx } = recordingCtx('out')
    const { sample, draws } = recordingSample()
    drawZoomed(ctx as never, sample, 1.25, 1080, 1920, 8)
    expect(draws[0]).toMatchObject({ x: (1080 - 1350) / 2 + 8, y: 0.4 * (1920 - 2400), w: 1350, h: 2400 })
  })
})

describe('drawImpactFrame', () => {
  const amounts = { blurSpread: 0.06, rgbShiftPx: 8 }

  it('draws the blur stack once per color channel on the scratch canvas, red left and blue right', () => {
    const out = recordingCtx('out')
    const scratch = recordingCtx('scratch')
    const { sample, draws } = recordingSample()
    drawImpactFrame(out.ctx as never, scratch.ctx as never, sample, 1.25, amounts, 1080, 1920)

    expect(draws).toHaveLength(3 * BLUR_LAYERS)
    expect(draws.every(d => d.ctx === 'scratch')).toBe(true)
    const firstOfEach = [0, BLUR_LAYERS, 2 * BLUR_LAYERS].map(i => draws[i].x - (1080 - 1350) / 2)
    expect(firstOfEach).toEqual([-8, 0, 8])
  })

  it('averages the blur layers evenly, each a little bigger', () => {
    const out = recordingCtx('out')
    const scratch = recordingCtx('scratch')
    const { sample, draws } = recordingSample()
    drawImpactFrame(out.ctx as never, scratch.ctx as never, sample, 1.25, amounts, 1080, 1920)

    const layers = draws.slice(0, BLUR_LAYERS)
    expect(layers.map(d => d.alpha)).toEqual([1, 1 / 2, 1 / 3, 1 / 4, 1 / 5])
    expect(layers[BLUR_LAYERS - 1].w).toBeCloseTo(1080 * 1.25 * 1.06)
  })

  it('keeps one channel per pass with multiply, and adds the three up with lighter', () => {
    const out = recordingCtx('out')
    const scratch = recordingCtx('scratch')
    const { sample } = recordingSample()
    drawImpactFrame(out.ctx as never, scratch.ctx as never, sample, 1.25, amounts, 1080, 1920)

    expect(scratch.ops.filter(o => o.op === 'fillRect').map(o => [o.mode, o.fill])).toEqual([
      ['multiply', '#f00'], ['multiply', '#0f0'], ['multiply', '#00f'],
    ])
    expect(out.ops.filter(o => o.op === 'drawImage').map(o => o.mode)).toEqual(['lighter', 'lighter', 'lighter'])
    expect(out.ctx.globalCompositeOperation).toBe('source-over')
    expect(out.ctx.globalAlpha).toBe(1)
  })
})
