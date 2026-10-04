import { describe, it, expect } from 'vitest'
import { cuesFromWhisperWords, wordsFromSegments, WhisperWord } from './transcribeSpeech'

/** Words spoken back to back, `step` seconds each, starting at `from`. */
function spoken(text: string, from = 0, step = 0.3): WhisperWord[] {
  return text.split(' ').map((w, i) => ({
    text: ` ${w}`,
    timestamp: [from + i * step, from + (i + 1) * step],
  }))
}

describe('cuesFromWhisperWords', () => {
  it('ends a cue after each sentence, timed from its first word to its last', () => {
    const cues = cuesFromWhisperWords([...spoken('Thanks for the comment.'), ...spoken('So, here goes.', 3)])
    expect(cues.map(c => c.en)).toEqual(['Thanks for the comment.', 'So, here goes.'])
    expect(cues[0]).toMatchObject({ start: 0, end: 1.2, ja: null })
    expect(cues[1]).toMatchObject({ start: 3, end: 3 + 0.9 })
  })

  it('keeps each cue within about two lines when the speaker never stops', () => {
    const text =
      'and then I just kept going and going because nobody told me to stop and honestly I was having a great time talking about it'
    const cues = cuesFromWhisperWords(spoken(text))
    expect(cues.length).toBeGreaterThan(2)
    for (const cue of cues) expect(cue.en.length).toBeLessThanOrEqual(42)
    expect(cues.map(c => c.en).join(' ')).toBe(text)
  })

  it('cuts at a comma once the cue is long enough, but not right after a short opener', () => {
    const cues = cuesFromWhisperWords(spoken('So, I moved here for work, and I never really left'))
    expect(cues.map(c => c.en)).toEqual(['So, I moved here for work,', 'and I never really left'])
  })

  it('cuts where the speaker pauses, even mid-sentence', () => {
    const cues = cuesFromWhisperWords([...spoken('it was kind of'), ...spoken('I mean it was not planned', 3)])
    expect(cues.map(c => c.en)).toEqual(['it was kind of', 'I mean it was not planned'])
  })

  it('keeps a cue on screen across a short gap instead of blinking off before the next', () => {
    const cues = cuesFromWhisperWords([...spoken('First one.'), ...spoken('Second one.', 1.2)])
    expect(cues[0].end).toBe(1.2)
    // A long gap is left empty.
    const apart = cuesFromWhisperWords([...spoken('First one.'), ...spoken('Second one.', 5)])
    expect(apart[0].end).toBeCloseTo(0.6)
  })

  it('drops non-speech markers and empty words', () => {
    const cues = cuesFromWhisperWords([
      { text: ' [BLANK_AUDIO]', timestamp: [0, 2] },
      { text: ' ', timestamp: [2, 2.1] },
      ...spoken('Hello.', 2.2),
    ])
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({ en: 'Hello.', start: 2.2 })
  })

  it('gives a word with no end time a short duration instead of none', () => {
    const cues = cuesFromWhisperWords([{ text: ' Cut', timestamp: [10, null] }])
    expect(cues[0].start).toBe(10)
    expect(cues[0].end).toBeCloseTo(10.3)
  })

  it('assigns unique ids in order, and returns nothing for no words', () => {
    const cues = cuesFromWhisperWords([...spoken('One.'), ...spoken('Two.', 5)])
    expect(new Set(cues.map(c => c.id)).size).toBe(2)
    expect(cuesFromWhisperWords([])).toEqual([])
  })
})

describe('wordsFromSegments', () => {
  it("spreads each segment's time over its words by length", () => {
    const words = wordsFromSegments([{ text: ' Hi there', timestamp: [10, 11] }])
    // "Hi " is 3 of 9 characters, "there " the other 6.
    expect(words.map(w => w.text)).toEqual([' Hi', ' there'])
    expect(words[0].timestamp[0]).toBe(10)
    expect(words[0].timestamp[1]).toBeCloseTo(10 + 1 / 3)
    expect(words[1].timestamp[0]).toBeCloseTo(10 + 1 / 3)
    expect(words[1].timestamp[1]).toBe(11)
  })

  it('lets a long sentence be cut into short cues that stay in time', () => {
    const cues = cuesFromWhisperWords(
      wordsFromSegments([
        { text: ' Hey, thanks for the comment.', timestamp: [0, 2] },
        { text: ' I just got a job offer and I said yes before I could think about it.', timestamp: [9.8, 13.5] },
      ]),
    )
    expect(cues.map(c => c.en)).toEqual([
      'Hey, thanks for the comment.',
      'I just got a job offer and I said yes',
      'before I could think about it.',
    ])
    expect(cues[1].start).toBe(9.8)
    expect(cues[2].end).toBe(13.5)
    expect(cues[2].start).toBeGreaterThan(11)
    expect(cues[2].start).toBeLessThan(12.5)
  })

  it('skips empty segments and gives an open-ended one a short duration per word', () => {
    const words = wordsFromSegments([
      { text: '  ', timestamp: [0, 1] },
      { text: ' Cut off', timestamp: [5, null] },
    ])
    expect(words).toHaveLength(2)
    expect(words[1].timestamp[1]).toBeCloseTo(5.6)
  })
})
