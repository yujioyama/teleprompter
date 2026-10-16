import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VideoSample } from 'mediabunny'
import { createOverlayProcess } from './subtitleOverlay'

// jsdom has no OffscreenCanvas; the process only needs one to draw into.
const canvases: FakeCanvas[] = []
class FakeCanvas {
  width: number
  height: number
  ctx: Record<string, unknown>
  /** Drawing calls in order, for checking what is drawn under what. */
  calls: string[] = []
  /** ctx.globalAlpha at each drawImage. */
  alphasAtDraw: number[] = []
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    const log = (name: string) => vi.fn(() => void this.calls.push(name))
    this.ctx = {
      canvas: this,
      globalAlpha: 1,
      drawImage: vi.fn(() => {
        this.calls.push('drawImage')
        this.alphasAtDraw.push(this.ctx.globalAlpha as number)
      }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      fill: log('fill'),
    }
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

const PLAN = { punchIn: { zoom: 1.25 as const, direction: 'in' as const, at: 0.4, duration: null }, until: 2 }

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

describe('createOverlayProcess travelling sticker', () => {
  it('draws the shadow then the sprite centered on the pose, turned and scaled, the shadow kept below', async () => {
    const path = vi.fn(() => ({ x: 0.5, y: 0.25, rotation: 90, scale: 1.4 }))
    const sprite = { shadow: new Blob(['shadow']), path, resolution: 1.4 }
    const { process } = await createOverlayProcess([{ start: 0, end: 2, image: new Blob(['png']), y: 0, sprite }])
    process(frameAt(1).sample)
    expect(path).toHaveBeenCalledWith(1)
    const ctx = canvases[0].ctx as Record<string, ReturnType<typeof vi.fn>>
    expect(ctx.translate.mock.calls).toEqual([[540, 480 + 8 * 1.4], [540, 480]])
    expect(ctx.rotate.mock.calls).toEqual([[Math.PI / 2], [Math.PI / 2]])
    expect(ctx.scale.mock.calls).toEqual([[1, 1], [1, 1]])
    // Each bitmap centered on the origin it was moved to.
    expect(ctx.drawImage.mock.calls.slice(-2).map(c => c.slice(1))).toEqual([[-450, -50], [-450, -50]])
  })

  it('skips the sprite while it is shrunk away', async () => {
    const sprite = { shadow: new Blob(['shadow']), path: () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 0 }), resolution: 1.4 }
    const { process } = await createOverlayProcess([{ start: 0, end: 2, image: new Blob(['png']), y: 0, sprite }])
    process(frameAt(1).sample)
    expect(canvases[0].ctx.translate).not.toHaveBeenCalled()
  })

  it('draws a sprite\'s sparkles under it, at its scale, with its opacity', async () => {
    const path = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1, opacity: 0.5 })
    const sparkles = [{ born: 0, life: 1, x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 10, color: '#FFFFFF' }]
    const sprite = { shadow: new Blob(['shadow']), path, resolution: 1.4, scale: 0.62, sparkles }
    const { process } = await createOverlayProcess([{ start: 0, end: 1, image: new Blob(['png']), y: 0, sprite }])
    process(frameAt(0.5).sample)
    const { calls, alphasAtDraw, ctx } = canvases[0]
    // The stars are filled before the shadow and the sprite are drawn.
    expect(calls.indexOf('fill')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('fill')).toBeLessThan(calls.indexOf('drawImage'))
    expect((ctx.scale as ReturnType<typeof vi.fn>).mock.calls).toEqual([[0.62 / 1.4, 0.62 / 1.4], [0.62 / 1.4, 0.62 / 1.4]])
    // Shadow and sprite both fade, and the alpha is back to 1 for what comes next.
    expect(alphasAtDraw).toEqual([0.5, 0.5])
    expect(ctx.globalAlpha).toBe(1)
  })

  it('draws a sprite without the new fields as before', async () => {
    const path = () => ({ x: 0.5, y: 0.5, rotation: 0, scale: 1 })
    const sprite = { shadow: new Blob(['shadow']), path, resolution: 1 }
    const { process } = await createOverlayProcess([{ start: 0, end: 1, image: new Blob(['png']), y: 0, sprite }])
    process(frameAt(0.5).sample)
    expect(canvases[0].calls).toEqual(['drawImage', 'drawImage'])
    expect(canvases[0].alphasAtDraw).toEqual([1, 1])
  })
})
