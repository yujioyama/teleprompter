import { describe, expect, it } from 'vitest'
import { midZoomForShot, midZoomScale, planMidZoom, PEAK_ZOOM, PUNCHLINE_ZOOM, type MidZoomSegment } from './midZoom'

// One cue per shot, each shot 2s long.
function shots(texts: string[]) {
  return {
    cues: texts.map((en, i) => ({ start: i * 2, en })),
    durations: texts.map(() => 2),
  }
}

describe('planMidZoom', () => {
  it('drifts in on the middle shots with an emoji and punches in on the last one', () => {
    const { cues, durations } = shots(['A firefly🔥', 'Fire. Fly.', 'The butt🍑', 'Hotaru.', 'One sentence🔦'])
    expect(planMidZoom(cues, durations, {})).toEqual([
      { start: 4, end: 6, kind: 'drift' },
      { start: 8, end: 10, kind: 'punch' },
    ])
  })

  it('punches in on the punchline even without any peak', () => {
    const { cues, durations } = shots(['A firefly🔥', 'Nobody noticed.'])
    expect(planMidZoom(cues, durations, {})).toEqual([{ start: 2, end: 4, kind: 'punch' }])
  })

  it('does nothing for a one-shot video, or with the setting off', () => {
    expect(planMidZoom([{ start: 0, en: 'Only🔥' }], [2], {})).toEqual([])
    const { cues, durations } = shots(['A🔥', 'B✨', 'C'])
    expect(planMidZoom(cues, durations, { midZoom: false })).toEqual([])
  })

  it('counts a peak however short its shot (too short for a fairy)', () => {
    const plan = planMidZoom([{ start: 0, en: 'A' }, { start: 2, en: 'B✨' }, { start: 2.6, en: 'C' }], [2, 0.6, 2], {})
    expect(plan[0]).toEqual({ start: 2, end: 2.6, kind: 'drift' })
  })
})

describe('midZoomScale', () => {
  const plan: MidZoomSegment[] = [
    { start: 4, end: 6, kind: 'drift' },
    { start: 8, end: 10, kind: 'punch' },
  ]

  it('is 1x outside the segments', () => {
    expect(midZoomScale(1, plan)).toBe(1)
    expect(midZoomScale(6, plan)).toBe(1)
    expect(midZoomScale(7.9, plan)).toBe(1)
  })

  it('eases a drift from 1x to the peak zoom over its shot', () => {
    expect(midZoomScale(4, plan)).toBeCloseTo(1)
    expect(midZoomScale(5, plan)).toBeCloseTo(1 + (PEAK_ZOOM - 1) / 2)
    expect(midZoomScale(5.999, plan)).toBeCloseTo(PEAK_ZOOM, 3)
  })

  it('holds the punchline zoom from the cut to the end', () => {
    expect(midZoomScale(8, plan)).toBe(PUNCHLINE_ZOOM)
    expect(midZoomScale(9.99, plan)).toBe(PUNCHLINE_ZOOM)
  })
})

describe('midZoomForShot', () => {
  it('keeps the segments inside the shot, in its own time', () => {
    const plan: MidZoomSegment[] = [
      { start: 4, end: 6, kind: 'drift' },
      { start: 8, end: 10, kind: 'punch' },
    ]
    expect(midZoomForShot(plan, 4, 2)).toEqual([{ start: 0, end: 2, kind: 'drift' }])
    expect(midZoomForShot(plan, 2, 2)).toEqual([])
  })
})
