import { describe, it, expect } from 'vitest'
import {
  followsFrames,
  hasFirstShotExtras,
  hookOptionsOf,
  punchInPlan,
  punchInScale,
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
    punchInDirection: 'in' as const,
    punchInAt: 0.6,
  }

  it('reads the hook settings into a punch-in', () => {
    expect(hookOptionsOf(settings)).toEqual({
      style: false,
      position: 40,
      punchIn: { zoom: 1.35, direction: 'in', at: 0.6 },
    })
  })

  it('has no punch-in with the zoom off', () => {
    expect(hookOptionsOf({ ...settings, punchInEnabled: false }).punchIn).toBeNull()
  })
})

describe('startsInFirstShot', () => {
  it('excludes a cue starting where the second shot does', () => {
    expect(startsInFirstShot(1.99, 2)).toBe(true)
    expect(startsInFirstShot(2, 2)).toBe(false)
  })
})

describe('punchInScale', () => {
  const punchIn = { zoom: 1.25 as const, direction: 'in' as const, at: 0.4 }

  it('stays at 1x until the zoom starts', () => {
    expect(punchInScale(0, punchIn, 2)).toBe(1)
    expect(punchInScale(0.399, punchIn, 2)).toBe(1)
    expect(punchInScale(0.4, punchIn, 2)).toBe(1)
  })

  it('pushes in steadily, reaching the zoom as the first shot ends', () => {
    expect(punchInScale(1.2, punchIn, 2)).toBeCloseTo(1.125)
    expect(punchInScale(1.6, punchIn, 2)).toBeCloseTo(1.1875)
    expect(punchInScale(1.999, punchIn, 2)).toBeCloseTo(1.25, 3)
  })

  it('cuts back to 1x when the first shot ends', () => {
    expect(punchInScale(2, punchIn, 2)).toBe(1)
    expect(punchInScale(5, punchIn, 2)).toBe(1)
  })

  it('never zooms a first shot that ends before the zoom starts', () => {
    expect(punchInScale(0.3, { zoom: 1.25, direction: 'in', at: 0.5 }, 0.4)).toBe(1)
    expect(punchInScale(0.45, { zoom: 1.25, direction: 'in', at: 0.5 }, 0.4)).toBe(1)
  })
})

describe('punchInScale zooming out', () => {
  const punchIn = { zoom: 1.25 as const, direction: 'out' as const, at: 0.4 }

  it('is already zoomed in on the first frame and holds until `at`', () => {
    expect(punchInScale(0, punchIn, 2)).toBe(1.25)
    expect(punchInScale(0.399, punchIn, 2)).toBe(1.25)
  })

  it('pulls back steadily, reaching 1x as the first shot ends', () => {
    expect(punchInScale(0.4, punchIn, 2)).toBeCloseTo(1.25)
    expect(punchInScale(1.2, punchIn, 2)).toBeCloseTo(1.125)
    expect(punchInScale(1.999, punchIn, 2)).toBeCloseTo(1, 3)
  })

  it('is 1x from the second shot on', () => {
    expect(punchInScale(2, punchIn, 2)).toBe(1)
    expect(punchInScale(5, punchIn, 2)).toBe(1)
  })
})

describe('first-shot extras', () => {
  const punchIn = { zoom: 1.25 as const, direction: 'in' as const, at: 0.4 }
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

describe('followsFrames', () => {
  const punchIn = { zoom: 1.25 as const, direction: 'in' as const, at: 0.4 }

  it('follows frames through the first shot and a short tail after it', () => {
    expect(followsFrames(0, punchIn, 2)).toBe(true)
    expect(followsFrames(2.05, punchIn, 2)).toBe(true)
    expect(followsFrames(2.1, punchIn, 2)).toBe(false)
    expect(followsFrames(30, punchIn, 2)).toBe(false)
  })

  it('does not follow without the zoom or a first shot', () => {
    expect(followsFrames(0.5, null, 2)).toBe(false)
    expect(followsFrames(0.5, punchIn, null)).toBe(false)
  })
})
