import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEAKER_ICON, onPhone, speakerOf, withSpeakers } from './speakers'
import type { HookOptions } from './subtitleHook'
import type { SubtitleCue } from './subtitleCues'

const HOOK = { style: true, position: 20, punchIn: null } as HookOptions
const cue = (id: string, start: number, end: number): SubtitleCue => ({ id, start, end, en: id, ja: id })

describe('withSpeakers', () => {
  const cues = [cue('a', 0, 2), cue('b', 2, 3), cue('c', 3, 5), cue('d', 5, 6)]

  it("puts the other person's icon on the cues of their shots", () => {
    const hook = withSpeakers(HOOK, cues, [
      { text: 'a', duration: 2, speaker: '👩‍🍳' },
      { text: 'b', duration: 1 },
      // Two subtitles in one shot (edited apart) are both theirs.
      { text: 'c d', duration: 3, speaker: DEFAULT_SPEAKER_ICON },
    ])
    expect(hook.speakers).toEqual([
      { cueId: 'a', icon: '👩‍🍳' },
      { cueId: 'c', icon: DEFAULT_SPEAKER_ICON },
      { cueId: 'd', icon: DEFAULT_SPEAKER_ICON },
    ])
    expect(speakerOf(hook, 'a')).toBe('👩‍🍳')
    expect(speakerOf(hook, 'b')).toBeUndefined()
  })

  it('marks the cues of someone on the phone', () => {
    const hook = withSpeakers(HOOK, cues, [
      { text: 'a', duration: 2, speaker: '🧑', phone: true },
      { text: 'b', duration: 1 },
      { text: 'c d', duration: 3, speaker: '👩' },
    ])
    expect(onPhone(hook, 'a')).toBe(true)
    expect(onPhone(hook, 'b')).toBe(false)
    expect(onPhone(hook, 'c')).toBe(false)
    expect(onPhone(undefined, 'a')).toBe(false)
  })

  it('leaves a script that is all one voice as it was', () => {
    expect(withSpeakers(HOOK, cues, [{ text: 'a', duration: 6 }])).toBe(HOOK)
    expect(speakerOf(undefined, 'a')).toBeUndefined()
  })
})
