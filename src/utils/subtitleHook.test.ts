import { describe, it, expect } from 'vitest'
import {
  hasFirstShotExtras,
  hookOptionsOf,
  punchInPlan,
  snapZoomScale,
  SNAP_DURATION,
  startsInFirstShot,
  styleCues,
  type HookOptions,
} from './subtitleHook'
import type { SubtitleCue } from './subtitleCues'

const cue = (id: string, start: number, end: number): SubtitleCue => ({ id, start, end, en: id, ja: `${id}-ja` })

describe('styleCues', () => {
  it('marks the cues starting within the first shot as hook cues', () => {
    const styled = styleCues([cue('a', 0, 1), cue('b', 1, 2.5), cue('c', 2.5, 4)], 2.5, true)
    expect(styled.map(c => c.variant)).toEqual(['hook', 'hook', 'normal'])
  })

  it('keeps a cue running on past the first shot a hook cue, end untouched', () => {
    expect(styleCues([cue('a', 0, 3)], 2, true)[0]).toMatchObject({ variant: 'hook', start: 0, end: 3 })
  })

  it('starts the first hook cue at 0 and leaves the others as timed', () => {
    const styled = styleCues([cue('a', 0.3, 1), cue('b', 1.1, 1.8), cue('c', 2.2, 3)], 2, true)
    expect(styled.map(c => [c.start, c.end])).toEqual([[0, 1], [1.1, 1.8], [2.2, 3]])
  })

  it('leaves every cue normal and as timed with the hook style off', () => {
    const cues = [cue('a', 0.3, 1)]
    expect(styleCues(cues, 2, false)).toEqual([{ ...cues[0], variant: 'normal' }])
  })

  it('has no hook cues without a first shot', () => {
    expect(styleCues([cue('a', 0.3, 1)], null, true)).toEqual([{ ...cue('a', 0.3, 1), variant: 'normal' }])
  })

  it('does not change the cues it was given', () => {
    const cues = [cue('a', 0.3, 1)]
    styleCues(cues, 2, true)
    expect(cues[0].start).toBe(0.3)
  })
})

describe('hookOptionsOf', () => {
  const settings = {
    hookStyleEnabled: false,
    hookPosition: 40,
    punchInEnabled: true,
    punchInZoom: 1.35 as const,
    punchInAt: 0.6,
    impactEnabled: true,
    impactStrength: 'strong' as const,
  }

  it('reads the hook settings into a punch-in with its impact', () => {
    expect(hookOptionsOf(settings)).toEqual({
      style: false,
      position: 40,
      punchIn: { zoom: 1.35, at: 0.6, impact: 'strong' },
    })
  })

  it('has no impact with the effect off, and no punch-in with the zoom off', () => {
    expect(hookOptionsOf({ ...settings, impactEnabled: false }).punchIn?.impact).toBeNull()
    expect(hookOptionsOf({ ...settings, punchInEnabled: false }).punchIn).toBeNull()
  })
})

describe('startsInFirstShot', () => {
  it('excludes a cue starting where the second shot does', () => {
    expect(startsInFirstShot(1.99, 2)).toBe(true)
    expect(startsInFirstShot(2, 2)).toBe(false)
  })
})

describe('snapZoomScale', () => {
  const punchIn = { zoom: 1.25 as const, at: 0.4 }

  it('stays at 1x until the snap starts', () => {
    expect(snapZoomScale(0, punchIn, 2)).toBe(1)
    expect(snapZoomScale(0.399, punchIn, 2)).toBe(1)
  })

  it('eases out (quint) to the zoom over SNAP_DURATION', () => {
    const half = 1 - (1 - 0.5) ** 5
    expect(snapZoomScale(0.4 + SNAP_DURATION / 2, punchIn, 2)).toBeCloseTo(1 + 0.25 * half)
    expect(snapZoomScale(0.4 + SNAP_DURATION, punchIn, 2)).toBeCloseTo(1.25)
  })

  it('holds the zoom until the first shot ends, then cuts back to 1x', () => {
    expect(snapZoomScale(1.9, punchIn, 2)).toBeCloseTo(1.25)
    expect(snapZoomScale(2, punchIn, 2)).toBe(1)
    expect(snapZoomScale(5, punchIn, 2)).toBe(1)
  })

  it('never zooms a first shot that ends before the snap', () => {
    expect(snapZoomScale(0.3, { zoom: 1.25, at: 0.5 }, 0.4)).toBe(1)
    expect(snapZoomScale(0.45, { zoom: 1.25, at: 0.5 }, 0.4)).toBe(1)
  })
})

describe('first-shot extras', () => {
  const punchIn = { zoom: 1.25 as const, at: 0.4, impact: null }
  const hook: HookOptions = { style: true, position: 50, punchIn: null }

  it('only apply to a video starting with the first shot', () => {
    expect(hasFirstShotExtras({ ...hook, punchIn }, 2)).toBe(true)
    expect(hasFirstShotExtras(hook, 2)).toBe(false)
    expect(hasFirstShotExtras({ ...hook, punchIn }, null)).toBe(false)
  })

  it('plan the punch-in until the end of the first shot', () => {
    expect(punchInPlan({ ...hook, punchIn }, 2)).toEqual({ punchIn, until: 2 })
    expect(punchInPlan(hook, 2)).toBeNull()
    expect(punchInPlan({ ...hook, punchIn }, null)).toBeNull()
  })
})
