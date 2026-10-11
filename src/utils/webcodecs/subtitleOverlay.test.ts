import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { createOverlayProcess } from './subtitleOverlay'

// jsdom has no OffscreenCanvas; the process only needs one to draw into.
const canvases: FakeCanvas[] = []
class FakeCanvas {
  width: number
  height: number
  ctx: Record<string, unknown>
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.ctx = { canvas: this, drawImage: vi.fn() }
    canvases.push(this)
  }
  getContext() {
    return this.ctx
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
  canvases.length = 0
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 900, height: 100, close: vi.fn() })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PLAN = { punchIn: { zoom: 1.25 as const, direction: 'in' as const, at: 0.4 }, until: 2 }

describe('createOverlayProcess zoom in', () => {
  it('draws the zoom so far about (50%, 40%)', async () => {
    const { process } = await createOverlayProcess([], { punchIn: PLAN })
    // Halfway from 0.4 to 2: 1 + 0.25 * 0.5.
    const { sample, draw } = frameAt(1.2)

    expect(process(sample)).toBeInstanceOf(FakeCanvas)
    const [, x, y, w, h] = draw.mock.calls[0]
    expect(w).toBeCloseTo(1080 * 1.125)
    expect(h).toBeCloseTo(1920 * 1.125)
    expect(x).toBeCloseTo((1080 - 1080 * 1.125) / 2)
    expect(y).toBeCloseTo(0.4 * (1920 - 1920 * 1.125))
  })

  it('passes frames before the zoom and after the first shot through untouched', async () => {
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

  it('composites the subtitles after the zoom, untouched', async () => {
    const overlay = { start: 0, end: 2, image: new Blob(['png']), y: 300 }
    const { process } = await createOverlayProcess([overlay], { punchIn: PLAN })
    process(frameAt(1.2).sample)
    const drawImage = canvases[0].ctx.drawImage as ReturnType<typeof vi.fn>
    expect(drawImage.mock.calls[drawImage.mock.calls.length - 1]).toEqual([expect.objectContaining({ width: 900 }), 90, 300])
  })
})
