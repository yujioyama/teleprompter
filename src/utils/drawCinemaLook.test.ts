import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CinemaLook } from '../../shared/cinemaLook'
import { GRAIN_HEIGHT, GRAIN_WIDTH } from './cinemaLook'

type Ctx = CanvasRenderingContext2D
type Draw = typeof import('./drawCinemaLook').drawCinemaLook
type DrawAt = typeof import('./drawCinemaLook').drawCinemaLookAtScale

/** A recording stand-in for a 2D context; jsdom has no canvas. */
class FakeCanvas {
  static all: FakeCanvas[] = []
  readonly id: number
  readonly ctx: Record<string, unknown>
  constructor(
    public width: number,
    public height: number,
  ) {
    this.id = FakeCanvas.all.push(this)
    this.ctx = fakeCtx(this)
  }
  getContext() {
    return this.ctx
  }
}

interface Event {
  call: string
  op: string
  alpha: number
  source?: FakeCanvas
  args: number[]
  data?: Uint8ClampedArray
}

let events: Event[] = []

function fakeCtx(canvas: { width: number; height: number }) {
  const ctx: Record<string, unknown> = { canvas, globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1 }
  const record = (call: string, extra: Partial<Event> = {}) =>
    events.push({ call, op: ctx.globalCompositeOperation as string, alpha: ctx.globalAlpha as number, args: [], ...extra })
  const imageData = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) data.set([128, 128, 128, 255], i)
    return { data, width: w, height: h }
  }
  for (const name of ['beginPath', 'fill', 'stroke', 'moveTo', 'lineTo', 'bezierCurveTo', 'ellipse']) {
    ctx[name] = (...args: number[]) => record(name, { args })
  }
  ctx.getImageData = (...args: number[]) => {
    record('getImageData', { args })
    return imageData(args[2], args[3])
  }
  ctx.createImageData = (w: number, h: number) => imageData(w, h)
  ctx.putImageData = (img: { data: Uint8ClampedArray }, ...args: number[]) => record('putImageData', { args, data: img.data })
  ctx.drawImage = (source: FakeCanvas, ...args: number[]) => record('drawImage', { source, args })
  return ctx
}

const W = 8
const H = 16

describe('drawCinemaLook', () => {
  let draw: Draw
  let drawAt: DrawAt
  let ctx: Ctx

  beforeEach(async () => {
    events = []
    FakeCanvas.all = []
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    vi.resetModules()
    ;({ drawCinemaLook: draw, drawCinemaLookAtScale: drawAt } = await import('./drawCinemaLook'))
    ctx = new FakeCanvas(W, H).ctx as unknown as Ctx
    events = []
  })

  const calls = (name: string) => events.filter(e => e.call === name)
  const grainDraws = () => calls('drawImage').filter(e => e.op === 'overlay')

  it('draws nothing at opacity 0', () => {
    draw(ctx, 'oldFilm', 0.3, 0, W, H)
    expect(events).toEqual([])
  })

  it('reads the picture through a scratch canvas, never from the caller', () => {
    ctx.getImageData = () => {
      throw new Error('read the caller')
    }
    draw(ctx, 'mono', 0, 1, W, H)
    expect(calls('getImageData')).toHaveLength(1)
    // picture -> scratch, then scratch -> picture
    const [into, back] = calls('drawImage')
    expect(into.source).toBe(ctx.canvas)
    expect(into.args).toEqual([0, 0, W, H, 0, 0, W, H])
    expect(back.source).not.toBe(into.source)
    expect(back.args).toEqual([0, 0, W, H, 0, 0, W, H])
  })

  it('grades, then lays grain (overlay) and dust (source-over) on the old film, and restores the context', () => {
    ctx.globalAlpha = 0.9
    ctx.globalCompositeOperation = 'multiply'
    draw(ctx, 'oldFilm', 0, 0.5, W, H)
    const order = events.map(e => e.call)
    expect(order.indexOf('getImageData')).toBeLessThan(order.indexOf('putImageData'))
    const put = calls('putImageData')[0]
    expect(put.data![0]).not.toBe(128)
    expect(put.data![3]).toBe(255)

    const [, back, grain, ...more] = calls('drawImage')
    expect(back.op).toBe('source-over')
    expect(back.alpha).toBe(0.5)
    expect(grain.op).toBe('overlay')
    expect(grain.alpha).toBeCloseTo(0.55 * 0.5)
    expect(grain.source!.width).toBe(GRAIN_WIDTH)
    expect(grain.source!.height).toBe(GRAIN_HEIGHT)
    expect(grain.args).toEqual([0, 0, W, H])
    expect(more).toEqual([])

    const specks = calls('ellipse')
    expect(specks.length).toBeGreaterThan(0)
    expect(specks.every(e => e.op === 'source-over' && e.alpha === 0.5)).toBe(true)
    expect(calls('stroke').length).toBeGreaterThan(0)
    // 2 hairs curve; scratches run to the bottom of the frame
    expect(calls('bezierCurveTo')).toHaveLength(2)
    expect(calls('lineTo').every(e => e.args[1] === H)).toBe(true)
    expect(order.indexOf('ellipse')).toBeGreaterThan(order.lastIndexOf('drawImage'))

    expect(ctx.globalAlpha).toBe(0.9)
    expect(ctx.globalCompositeOperation).toBe('multiply')
  })

  it('draws no grain or dust for hollywood', () => {
    draw(ctx, 'hollywood', 0, 1, W, H)
    expect(calls('drawImage')).toHaveLength(2)
    expect(grainDraws()).toEqual([])
    expect(calls('ellipse')).toEqual([])
  })

  it('gives each look the grain it is picked with', () => {
    const grained = (look: CinemaLook) => {
      events = []
      draw(ctx, look, 0, 1, W, H)
      return grainDraws().map(e => e.alpha)
    }
    expect(grained('nightBlue')[0]).toBeCloseTo(0.25 * 0.55)
    expect(grained('mono')[0]).toBeCloseTo(0.5 * 0.55)
    expect(grained('glitch')).toEqual([])
  })

  it('tears the glitch frame into a second buffer, with no grade', () => {
    draw(ctx, 'glitch', 0.5, 1, W, H)
    expect(calls('putImageData')).toHaveLength(1)
    expect(calls('putImageData')[0].data![3]).toBe(255)
  })

  it('holds a grain frame for a 1/12 s step and changes it on the next', () => {
    const grainOf = (t: number) => {
      events = []
      draw(ctx, 'oldFilm', t, 1, W, H)
      return grainDraws()[0].source
    }
    const a = grainOf(0.01)
    expect(grainOf(0.08)).toBe(a)
    const b = grainOf(0.09)
    expect(b).not.toBe(a)
    // six frames, cycled
    expect(grainOf(6 / 12 + 0.01)).toBe(a)
  })

  it('processes at half size and scales back up when asked', () => {
    drawAt(ctx, 'mono', 0, 1, W, H, 0.5)
    const [into, back] = calls('drawImage')
    expect(into.args).toEqual([0, 0, W, H, 0, 0, W / 2, H / 2])
    expect(calls('getImageData')[0].args).toEqual([0, 0, W / 2, H / 2])
    expect(back.args).toEqual([0, 0, W / 2, H / 2, 0, 0, W, H])
  })
})
