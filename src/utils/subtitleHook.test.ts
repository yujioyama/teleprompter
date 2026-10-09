import { describe, it, expect } from 'vitest'
import {
  HEADLINE_GAP,
  hasFirstShotExtras,
  headlineY,
  hookOptionsOf,
  punchInScale,
  punchInUntil,
  startsInFirstShot,
  styleCues,
  type HookOptions,
} from './subtitleHook'
import { clampedSubtitleY } from './subtitlePosition'
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
  const settings = { hookStyleEnabled: false, hookPosition: 40, hookHeadlineEnabled: true, punchInEnabled: true }

  it('reads the hook settings, with the headline trimmed', () => {
    expect(hookOptionsOf(settings, '  Wait  ')).toEqual({ style: false, position: 40, headline: 'Wait', punchIn: true })
  })

  it('has no headline when it is switched off or not given', () => {
    expect(hookOptionsOf({ ...settings, hookHeadlineEnabled: false }, 'Wait').headline).toBe('')
    expect(hookOptionsOf(settings).headline).toBe('')
  })
})

describe('startsInFirstShot', () => {
  it('excludes a cue starting where the second shot does', () => {
    expect(startsInFirstShot(1.99, 2)).toBe(true)
    expect(startsInFirstShot(2, 2)).toBe(false)
  })
})

describe('punchInScale', () => {
  it('zooms from 1x to 1.08x over the first shot, then stops', () => {
    expect(punchInScale(0, 2)).toBe(1)
    expect(punchInScale(1, 2)).toBeCloseTo(1.04)
    expect(punchInScale(1.999, 2)).toBeCloseTo(1.08, 3)
    expect(punchInScale(2, 2)).toBe(1)
    expect(punchInScale(5, 2)).toBe(1)
  })

  it('does nothing for a shot without length', () => {
    expect(punchInScale(0.5, 0)).toBe(1)
  })
})

describe('first-shot extras', () => {
  const hook: HookOptions = { style: true, position: 50, headline: '', punchIn: false }

  it('only apply to a video starting with the first shot', () => {
    expect(hasFirstShotExtras({ ...hook, headline: 'Hi' }, 2)).toBe(true)
    expect(hasFirstShotExtras({ ...hook, punchIn: true }, 2)).toBe(true)
    expect(hasFirstShotExtras(hook, 2)).toBe(false)
    expect(hasFirstShotExtras({ ...hook, headline: 'Hi', punchIn: true }, null)).toBe(false)
  })

  it('zoom until the end of the first shot when the punch-in is on', () => {
    expect(punchInUntil({ ...hook, punchIn: true }, 2)).toBe(2)
    expect(punchInUntil(hook, 2)).toBeNull()
    expect(punchInUntil({ ...hook, punchIn: true }, null)).toBeNull()
  })
})

describe('headlineY', () => {
  it('sits the headline just above the topmost first-shot box', () => {
    const boxes = [{ top: 900, bottom: 1000 }, { top: 800, bottom: 950 }]
    expect(headlineY(boxes, 100, 50)).toBe(800 - HEADLINE_GAP - 100)
  })

  it('centers it at the hook position with no box under it', () => {
    expect(headlineY([], 100, 50)).toBe(clampedSubtitleY(50, 100))
  })

  it('goes below the bottom-most box when there is no room above', () => {
    expect(headlineY([{ top: 117, bottom: 412 }], 142, 13.75)).toBe(412 + HEADLINE_GAP)
  })

  it('stays within the frame when it fits neither above nor below', () => {
    const y = headlineY([{ top: 10, bottom: 1900 }], 142, 50)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(1920 - 142)
  })
})
