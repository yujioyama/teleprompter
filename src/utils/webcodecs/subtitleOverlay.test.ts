import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { createOverlayProcess } from './subtitleOverlay'

// jsdom has no OffscreenCanvas; the process only needs one to draw into.
class FakeCanvas {
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  getContext() {
    return { drawImage: vi.fn() }
  }
}

/** A 1080x1920 frame whose midpoint is at `t` seconds. */
function frameAt(t: number) {
  const draw = vi.fn()
  const duration = 1 / 30
  const sample = { timestamp: t - duration / 2, duration, displayWidth: 1080, displayHeight: 1920, draw }
  return { sample: sample as unknown as VideoSample, draw }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PLAN = { punchIn: { zoom: 1.25 as const, at: 0.4, impact: null }, until: 2 }

describe('createOverlayProcess snap zoom', () => {
  it('draws the held zoom about (50%, 40%)', async () => {
    const { process } = await createOverlayProcess([], { punchIn: PLAN })
    const { sample, draw } = frameAt(1)

    expect(process(sample)).toBeInstanceOf(FakeCanvas)
    const [, x, y, w, h] = draw.mock.calls[0]
    expect(w).toBeCloseTo(1080 * 1.25)
    expect(h).toBeCloseTo(1920 * 1.25)
    expect(x).toBeCloseTo((1080 - 1080 * 1.25) / 2)
    expect(y).toBeCloseTo(0.4 * (1920 - 1920 * 1.25))
  })

  it('passes frames before the snap and after the first shot through untouched', async () => {
    const { process } = await createOverlayProcess([], { punchIn: PLAN })
    for (const t of [0.2, 2.5]) {
      const { sample, draw } = frameAt(t)
      expect(process(sample)).toBe(sample)
      expect(draw).not.toHaveBeenCalled()
    }
  })

  it('leaves the picture alone without a punch-in', async () => {
    const { process } = await createOverlayProcess([])
    const { sample } = frameAt(1)
    expect(process(sample)).toBe(sample)
  })
})
