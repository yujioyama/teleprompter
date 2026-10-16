import { describe, expect, it } from 'vitest'
import { CAMEO_LENGTHS, FAIRY_MOTIONS, cameoBursts, cameoHover, cameoPath, finalePath, finaleTiming } from './fairyMotion'
import { inButtonColumn, type StickerPath, type StickerPose } from './stickerMotion'

const sample = (path: StickerPath, length: number) => Array.from({ length: 121 }, (_, i) => path((i / 120) * length))
const onFrame = (p: StickerPose) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1

describe('cameo paths', () => {
  it.each(FAIRY_MOTIONS.flatMap(m => [[m, false], [m, true]] as const))('%s (mirror %s) starts and ends off-frame or at an edge, never in the button column on-frame', (m, mirror) => {
    const poses = sample(cameoPath(m, CAMEO_LENGTHS[m], mirror), CAMEO_LENGTHS[m])
    expect(onFrame(poses[0])).toBe(false)
    expect(onFrame(poses.at(-1)!) && poses.at(-1)!.y > 0.1).toBe(false) // peek leaves upward past the top
    for (const p of poses) if (onFrame(p)) expect(inButtonColumn(p)).toBe(false)
  })

  it('mirrors peek to the right and lifts it 0.16', () => {
    expect(cameoPath('peek', 1.6, true)(0.8)).toMatchObject({ x: expect.closeTo(0.78, 2), y: expect.closeTo(0.36, 2) })
    expect(cameoPath('peek', 1.6, false)(0.8)).toMatchObject({ x: expect.closeTo(0.22, 2), y: expect.closeTo(0.52, 2) })
  })

  it('reverses glide for the right entry', () => {
    const left = cameoPath('glide', 1.2, false)
    const right = cameoPath('glide', 1.2, true)
    expect(right(0).x).toBeCloseTo(left(1.2).x)
    expect(right(0).y).toBeCloseTo(left(1.2).y)
  })

  it('time-compresses: the compressed path at s·length equals the nominal at s·nominal', () => {
    expect(cameoPath('loop', 0.9, false)(0.45)).toEqual(cameoPath('loop', 1.4, false)(0.7))
  })

  it('peek bursts as it leaves', () => {
    expect(cameoBursts('peek', 1.6)).toEqual([1.15])
    expect(cameoBursts('glide', 1.2)).toEqual([])
  })

  it('peek hovers still for part of its length, the others never do', () => {
    expect(cameoHover('peek', 1.6)).toEqual([0.45, 1.15])
    const [from, to] = cameoHover('peek', 0.8)!
    expect(from).toBeCloseTo(0.225)
    expect(to).toBeCloseTo(0.575)
    expect(cameoHover('glide', 1.2)).toBeNull()
    expect(cameoHover('loop', 1.4)).toBeNull()
  })
})

describe('finale', () => {
  it.each([
    [3, { fly: 0.6, hover: 2.0, burst: 0.3 }],
    [1.2, { fly: 0.6, hover: 0.2, burst: 0.3 }],
    [1.1, { fly: 0.5, hover: 0.2, burst: 0.3 }],
    [1.0, { fly: 0.4, hover: 0.2, burst: 0.3 }],
  ])('fits the finale into a %s s shot', (d, timing) => {
    const t = finaleTiming(d)!
    expect(t.fly).toBeCloseTo(timing.fly)
    expect(t.hover).toBeCloseTo(timing.hover)
    expect(t.burst).toBeCloseTo(timing.burst)
    expect(t.fly + t.hover + t.burst).toBeCloseTo(d - 0.1)
  })

  it('has no finale under 1 s', () => expect(finaleTiming(0.99)).toBeNull())

  it('lands at home after the fly-in and fades out by the end', () => {
    const home = { x: 0.82, y: 0.42, rotation: 8 }
    const timing = finaleTiming(3)!
    const path = finalePath(home, timing)
    expect(path(timing.fly)).toMatchObject({ x: 0.82, y: expect.closeTo(0.42, 1), scale: expect.closeTo(1, 1) })
    expect(path(0).x).toBeGreaterThan(1) // right-side home enters from the right
    expect(path(0).y).toBeCloseTo(0.42 - 0.22)
    expect(path(timing.fly + timing.hover + timing.burst).opacity).toBeCloseTo(0)
    expect(finalePath({ x: 0.18, y: 0.42, rotation: -8 }, timing)(0).x).toBeLessThan(0)
  })
})
