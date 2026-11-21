import { describe, expect, it } from 'vitest'
import {
  OPENING_HOLD_S,
  OPENING_SECONDS_PER_CHAR,
  OPENING_TARGET_S,
  OPENING_TYPE_BEFORE_END_S,
  OPENING_VOICE_AT_S,
  OPENING_WIPE_S,
  charTimesFromWords,
  cursorShows,
  layoutOpening,
  matchWords,
  openingCardPlanOf,
  openingTimingOf,
  typedCount,
  wipeProgress,
  wordSpansOf,
} from './openingCard'

const TEXT = 'My mom called me at 3 a.m.'
// Every character as wide as the font's size × 0.6: a monospace stand-in.
const measure = (text: string, font: string) => [...text].length * Number(/(\d+)px/.exec(font)![1]) * 0.6

describe('openingTimingOf', () => {
  it('types a letter every 40 ms without a voice, and stays within about 4 seconds', () => {
    const timing = openingTimingOf(TEXT)
    expect(timing.voiceAt).toBeNull()
    expect(timing.charTimes[1] - timing.charTimes[0]).toBeCloseTo(OPENING_SECONDS_PER_CHAR, 5)
    expect(timing.wipeAt).toBeCloseTo(timing.typedEnd + OPENING_HOLD_S, 3)
    expect(timing.seconds).toBeGreaterThanOrEqual(timing.wipeAt + OPENING_WIPE_S - 1e-6)
    expect(timing.seconds).toBeLessThanOrEqual(OPENING_TARGET_S)
    // On the 30 fps grid.
    expect(Math.abs(timing.seconds * 30 - Math.round(timing.seconds * 30))).toBeLessThan(1e-6)
  })

  it('spreads the letters over a voice with no word times, the last 0.2 s before it ends', () => {
    const timing = openingTimingOf(TEXT, { seconds: 2 })
    expect(timing.voiceAt).toBe(OPENING_VOICE_AT_S)
    expect(timing.charTimes[0]).toBeCloseTo(OPENING_VOICE_AT_S, 5)
    expect(timing.typedEnd).toBeCloseTo(OPENING_VOICE_AT_S + 2 - OPENING_TYPE_BEFORE_END_S, 3)
    // The curtain waits for the voice to end.
    expect(timing.wipeAt).toBeGreaterThanOrEqual(OPENING_VOICE_AT_S + 2)
  })

  it('grows with a long voice', () => {
    expect(openingTimingOf(TEXT, { seconds: 5 }).seconds).toBeGreaterThan(OPENING_TARGET_S)
  })

  it('types each word as it is heard', () => {
    const words = [
      { word: 'My', start: 0.1, end: 0.25 },
      { word: 'mom', start: 0.3, end: 0.5 },
      { word: 'called', start: 0.55, end: 0.9 },
      { word: 'me', start: 0.95, end: 1.05 },
      { word: 'at', start: 1.1, end: 1.2 },
      { word: '3', start: 1.3, end: 1.5 },
      { word: 'AM', start: 1.55, end: 1.9 },
    ]
    const timing = openingTimingOf(TEXT, { seconds: 2.2, words })
    const at = (i: number) => timing.charTimes[i]
    // "c" of "called" is at its heard start.
    expect(at(TEXT.indexOf('called'))).toBeCloseTo(OPENING_VOICE_AT_S + 0.55, 3)
    // "3" is at its heard start.
    expect(at(TEXT.indexOf('3'))).toBeCloseTo(OPENING_VOICE_AT_S + 1.3, 3)
    // "a.m." matched "AM".
    expect(at(TEXT.indexOf('a.m.'))).toBeCloseTo(OPENING_VOICE_AT_S + 1.55, 3)
    // In order throughout.
    for (let i = 1; i < timing.charTimes.length; i++) expect(at(i)).toBeGreaterThanOrEqual(at(i - 1))
  })
})

describe('charTimesFromWords', () => {
  it('fills a missed word in between the words around it', () => {
    const times = charTimesFromWords('one two three', [{ word: 'one', start: 0, end: 0.3 }, { word: 'three', start: 1, end: 1.4 }], 0, 1.6)!
    const two = times['one '.length]
    expect(two).toBeGreaterThanOrEqual(0.3)
    expect(two).toBeLessThan(1)
  })

  it('gives up when no word matched', () => {
    expect(charTimesFromWords('one two', [{ word: 'banana', start: 0, end: 1 }], 0, 1)).toBeNull()
  })

  it('never types later than 0.2 s before the voice ends', () => {
    const times = charTimesFromWords('one two', [{ word: 'one', start: 0, end: 0.2 }, { word: 'two', start: 1.9, end: 2.5 }], 0, 2)!
    expect(Math.max(...times)).toBeLessThanOrEqual(2 - OPENING_TYPE_BEFORE_END_S + 1e-6)
  })
})

describe('matchWords', () => {
  it('skips a word recognition heard that is not in the text', () => {
    const spans = wordSpansOf('I said no')
    const matched = matchWords(spans, [{ word: 'I', start: 0, end: 0.1 }, { word: 'uh', start: 0.2, end: 0.3 }, { word: 'said', start: 0.4, end: 0.6 }, { word: 'no', start: 0.7, end: 0.9 }])
    expect(matched.map(m => m?.word)).toEqual(['I', 'said', 'no'])
  })
})

describe('the card over time', () => {
  const timing = openingTimingOf('Hi there')

  it('shows the letters as they come', () => {
    expect(typedCount(timing, 0)).toBe(0)
    expect(typedCount(timing, timing.typedEnd)).toBe(8)
  })

  it('lifts the curtain only at the end', () => {
    expect(wipeProgress(timing, timing.wipeAt - 0.1)).toBe(0)
    expect(wipeProgress(timing, timing.wipeAt + OPENING_WIPE_S)).toBe(1)
    expect(cursorShows(timing, timing.wipeAt + 0.1)).toBe(false)
  })

  it('keeps the cursor steady while typing', () => {
    expect(cursorShows(timing, (timing.charTimes[0] + timing.typedEnd) / 2)).toBe(true)
  })
})

describe('layoutOpening', () => {
  it('puts every character of the text in place, within the safe width', () => {
    const layout = layoutOpening('I told my boss I was sick, but he saw me at the beach.', 1080, 1920, measure, '上司にはウソがばれた')
    expect(layout.chars.length).toBe([...'I told my boss I was sick, but he saw me at the beach.'].length)
    for (const c of layout.chars) {
      expect(c.x).toBeGreaterThanOrEqual(1080 * 0.1 - 1)
      expect(c.x).toBeLessThanOrEqual(1080 * 0.9)
    }
    expect(layout.ja!.y).toBeGreaterThan(Math.max(...layout.chars.map(c => c.y)))
  })
})

describe('openingCardPlanOf', () => {
  it('is null without a sentence', () => {
    expect(openingCardPlanOf(undefined)).toBeNull()
    expect(openingCardPlanOf({ text: '  ' })).toBeNull()
  })

  it('carries the voice by its key', () => {
    const plan = openingCardPlanOf({ text: 'Hi', ja: 'やあ' }, { key: 'v1', timing: { seconds: 1 } })!
    expect(plan).toMatchObject({ text: 'Hi', ja: 'やあ', voiceKey: 'v1' })
    expect(plan.timing.voiceAt).toBe(OPENING_VOICE_AT_S)
  })
})
