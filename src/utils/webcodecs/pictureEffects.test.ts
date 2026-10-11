import { describe, it, expect, vi } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { drawZoomed } from './pictureEffects'

function recordingSample() {
  const draws: { x: number; y: number; w: number; h: number }[] = []
  const sample = {
    draw: vi.fn((_ctx: unknown, x: number, y: number, w: number, h: number) => draws.push({ x, y, w, h })),
  }
  return { sample: sample as unknown as VideoSample, draws }
}

describe('drawZoomed', () => {
  it('scales about (50%, 40%)', () => {
    const { sample, draws } = recordingSample()
    drawZoomed({} as never, sample, 1.25, 1080, 1920)
    expect(draws[0]).toEqual({ x: (1080 - 1350) / 2, y: 0.4 * (1920 - 2400), w: 1350, h: 2400 })
  })
})
