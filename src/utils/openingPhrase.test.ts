import { describe, expect, it } from 'vitest'
import { OPENING_PHRASE_JA_DELAY_S, OPENING_PHRASE_JA_HOLD_S, layoutOpening, openingCardPlanOf, openingTimingOf, phraseRangeOf, phraseRunsOf } from './openingCard'
import { layoutStarsOpening } from './openingStars'
import { openingToKeep } from '../../shared/inbox'

// Every character as wide as the font's size × 0.5.
const measure = (text: string, font: string) => [...text].length * Number(/(\d+)px/.exec(font)![1]) * 0.5
const TEXT = "Wanna grab ramen tonight? I'm down."

describe('今日のフレーズ on the 冒頭カード', () => {
  it('finds the phrase in the sentence, ignoring case and curly apostrophes', () => {
    expect(phraseRangeOf(TEXT, 'i’m DOWN')).toEqual({ from: 26, to: 34 })
    expect(phraseRangeOf(TEXT, 'sushi')).toBeNull()
    expect(phraseRangeOf(TEXT, '  ')).toBeNull()
  })

  it('splits the meaning so its phrase can be colored', () => {
    expect(phraseRunsOf("I'm down = 乗り気だよ", "I'm down")).toEqual([
      { text: "I'm down", phrase: true },
      { text: ' = 乗り気だよ', phrase: false },
    ])
    expect(phraseRunsOf('乗り気だよ', "I'm down")).toEqual([{ text: '乗り気だよ', phrase: false }])
  })

  it('keeps the phrase as written in the sentence, and its meaning only with it', () => {
    const plan = openingCardPlanOf({ text: TEXT, phrase: "i'm down", phraseJa: ' 乗り気だよ ' }, null, 'stars')!
    expect(plan.phrase).toBe("I'm down")
    expect(plan.phraseJa).toBe('乗り気だよ')
    const missing = openingCardPlanOf({ text: TEXT, phrase: 'sushi', phraseJa: '寿司' }, null, 'stars')!
    expect(missing.phrase).toBeUndefined()
    expect(missing.phraseJa).toBeUndefined()
    expect(missing.timing).toEqual(openingTimingOf(TEXT, null, 'stars'))
  })

  it('shows the meaning a little after the Japanese, and holds it before the cut', () => {
    const plain = openingTimingOf(TEXT, { seconds: 2.6 }, 'stars')
    const timing = openingTimingOf(TEXT, { seconds: 2.6 }, 'stars', true)
    expect(plain.phraseJaAt).toBeUndefined()
    expect(timing.phraseJaAt).toBeCloseTo(timing.typedEnd + OPENING_PHRASE_JA_DELAY_S, 3)
    expect(timing.wipeAt).toBeGreaterThanOrEqual(timing.phraseJaAt! + OPENING_PHRASE_JA_HOLD_S - 1e-6)
    // Not much past the 4 s the card aims for.
    expect(timing.seconds).toBeLessThan(4.2)
  })

  it('keeps the phrase on one line, its tag clear above the band', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure, '今夜ラーメン行かない？行く行く。', { phrase: "I'm down", phraseJa: "I'm down = 乗り気だよ" })
    const ours = layout.letters.filter(l => l.phrase)
    expect(ours.map(l => l.ch).join('')).toBe("I'MDOWN")
    expect(new Set(ours.map(l => l.y)).size).toBe(1)
    const { tag, rows, meaning } = layout.phrase!
    expect(rows).toHaveLength(1)
    // The tag's bottom is above the band's top (the band is a font size tall around the line's middle).
    expect(tag.y + tag.height / 2).toBeLessThan(rows[0].y - layout.fontPx / 2)
    // …and below the line above it.
    const above = Math.max(...layout.letters.filter(l => l.y < rows[0].y).map(l => l.y))
    expect(tag.y - tag.height / 2).toBeGreaterThan(above + layout.fontPx / 2)
    expect(meaning!.runs.map(r => r.phrase)).toEqual([true, false])
    expect(meaning!.y).toBeGreaterThan(layout.ja!.y)
  })

  it('lays out as before without a phrase', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure, 'ja', { phrase: 'sushi' })
    expect(layout.phrase).toBeUndefined()
    expect(layout).toEqual(layoutStarsOpening(TEXT, 1080, 1920, measure, 'ja'))
  })

  it('marks the phrase on the 暖簾 too, with its meaning under the Japanese', () => {
    const layout = layoutOpening(TEXT, 1080, 1920, measure, '今夜ラーメン行かない？', { phrase: "I'm down", phraseJa: "I'm down = 乗り気だよ" })
    expect(layout.phrase).toEqual({ from: 26, to: 34 })
    expect(layout.meaning!.y).toBeGreaterThan(layout.ja!.y)
  })
})

describe('openingToKeep', () => {
  it('drops empty parts, and the meaning without a phrase', () => {
    expect(openingToKeep({ text: ' Hi. ', ja: '', phrase: ' ', phraseJa: '意味' })).toEqual({ text: 'Hi.' })
    expect(openingToKeep({ text: 'Hi.', phrase: 'Hi', phraseJa: ' やあ ' })).toEqual({ text: 'Hi.', phrase: 'Hi', phraseJa: 'やあ' })
    expect(openingToKeep({ text: '  ' })).toBeNull()
    expect(openingToKeep(undefined)).toBeNull()
  })
})
