import { describe, it, expect } from 'vitest'
import { hookOptionsOf, styleCues } from './subtitleHook'
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
  it('reads the hook settings', () => {
    expect(hookOptionsOf({ hookStyleEnabled: false, hookPosition: 40 })).toEqual({ style: false, position: 40 })
  })
})
