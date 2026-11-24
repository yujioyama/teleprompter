import { describe, expect, it } from 'vitest'
import { layoutOpening, openingCardPlanOf, openingTimingOf, phraseRangeOf } from './openingCard'
import { TAG_POP_S, layoutStarsOpening, phraseTagScaleAt } from './openingStars'
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

  it('keeps the phrase as written in the sentence, without making the card longer', () => {
    const plan = openingCardPlanOf({ text: TEXT, phrase: "i'm down" }, { key: 'v', timing: { seconds: 2.6 } }, 'stars')!
    expect(plan.phrase).toBe("I'm down")
    expect(plan.timing).toEqual(openingTimingOf(TEXT, { seconds: 2.6 }, 'stars'))
    const missing = openingCardPlanOf({ text: TEXT, phrase: 'sushi' }, null, 'stars')!
    expect(missing.phrase).toBeUndefined()
  })

  it('keeps the phrase on one line, its tag clear above the band', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure, '今夜ラーメン行かない？行く行く。', "I'm down")
    const ours = layout.letters.filter(l => l.phrase)
    expect(ours.map(l => l.ch).join('')).toBe("I'MDOWN")
    expect(new Set(ours.map(l => l.y)).size).toBe(1)
    const { tag, rows } = layout.phrase!
    expect(rows).toHaveLength(1)
    // The tag's bottom is above the band's top (the band is a font size tall around the line's middle).
    expect(tag.y + tag.height / 2).toBeLessThan(rows[0].y - layout.fontPx / 2)
    // …and below the line above it.
    const above = Math.max(...layout.letters.filter(l => l.y < rows[0].y).map(l => l.y))
    expect(tag.y - tag.height / 2).toBeGreaterThan(above + layout.fontPx / 2)
  })

  it('lays out as before without a phrase', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure, 'ja', 'sushi')
    expect(layout.phrase).toBeUndefined()
    expect(layout).toEqual(layoutStarsOpening(TEXT, 1080, 1920, measure, 'ja'))
  })

  it('marks the phrase on the 暖簾 too', () => {
    const layout = layoutOpening(TEXT, 1080, 1920, measure, '今夜ラーメン行かない？', "I'm down")
    expect(layout.phrase).toEqual({ from: 26, to: 34 })
  })
})

describe('openingToKeep', () => {
  it('drops empty parts', () => {
    expect(openingToKeep({ text: ' Hi. ', ja: '', phrase: ' ' })).toEqual({ text: 'Hi.' })
    expect(openingToKeep({ text: 'Hi.', phrase: ' Hi ' })).toEqual({ text: 'Hi.', phrase: 'Hi' })
    expect(openingToKeep({ text: '  ' })).toBeNull()
    expect(openingToKeep(undefined)).toBeNull()
  })
})

describe("the TODAY'S PHRASE tag", () => {
  it('pops in with the phrase: nothing before, past full size, then settled', () => {
    expect(phraseTagScaleAt(-0.1)).toBe(0)
    expect(phraseTagScaleAt(0)).toBe(0)
    expect(phraseTagScaleAt(TAG_POP_S * 0.55)).toBeGreaterThan(1.2)
    expect(phraseTagScaleAt(TAG_POP_S)).toBe(1)
    expect(phraseTagScaleAt(5)).toBe(1)
  })
})
