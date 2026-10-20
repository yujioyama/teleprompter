import { describe, it, expect } from 'vitest'
import { COVER_TEXT_WIDTH, GRID_BOTTOM, GRID_TOP, coverLines, coverWordsOf, fitFontPx, type MeasureWidth } from './coverImage'
import { EMPHASIS_COLOR, WORD_COLOR } from './subtitleEmphasis'

// Every character is 0.6em wide.
const measure: MeasureWidth = (text, font) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.6

describe('coverWordsOf', () => {
  it('takes the first *phrase* and {word} from the shots, and the kana from the Japanese lines', () => {
    const words = coverWordsOf(
      ['Every time an Australian says *reckon*,', 'I see {renkon}. That is lotus root.', 'And *later* {again}'],
      ['オーストラリア人が「reckon」と言うたびに', '{レンコン}が見える。'],
    )
    expect(words).toEqual({ en: 'reckon', ja: 'renkon レンコン' })
  })

  it('leaves out the kana when there are no Japanese lines yet', () => {
    expect(coverWordsOf(['*turmeric* is {ukon}'])).toEqual({ en: 'turmeric', ja: 'ukon' })
  })

  it('does not repeat the word when the translation kept it in romaji', () => {
    expect(coverWordsOf(['{ukon}'], ['{ukon}だ'])).toEqual({ en: '', ja: 'ukon' })
  })

  it('gives empty strings for a script without markers', () => {
    expect(coverWordsOf(['5 * 3 * 2', 'plain'])).toEqual({ en: '', ja: '' })
  })
})

describe('fitFontPx', () => {
  it('keeps the largest size for a short word', () => {
    expect(fitFontPx('clam', 200, 72, measure)).toBe(200)
  })

  it('shrinks a long phrase until it fits the width', () => {
    const text = 'happy as a clam'
    const px = fitFontPx(text, 200, 72, measure)
    expect(measure(text, `800 ${px}px x`)).toBeLessThanOrEqual(COVER_TEXT_WIDTH)
    expect(measure(text, `800 ${px + 4}px x`)).toBeGreaterThan(COVER_TEXT_WIDTH)
  })

  it('stops at the minimum size', () => {
    expect(fitFontPx('a'.repeat(200), 200, 72, measure)).toBe(72)
  })
})

describe('coverLines', () => {
  it('stacks the English phrase (yellow) over the Japanese word (mint) inside the grid window', () => {
    const lines = coverLines({ en: 'reckon', ja: 'renkon レンコン' }, measure)
    expect(lines.map(l => [l.text, l.color])).toEqual([
      ['reckon', EMPHASIS_COLOR],
      ['renkon レンコン', WORD_COLOR],
    ])
    expect(lines[0].y).toBeLessThan(lines[1].y)
    expect(lines[0].y - lines[0].px).toBeGreaterThan(GRID_TOP)
    expect(lines[1].y).toBeLessThan(GRID_BOTTOM)
  })

  it('skips an empty line', () => {
    expect(coverLines({ en: '  ', ja: 'ukon' }, measure).map(l => l.text)).toEqual(['ukon'])
    expect(coverLines({ en: '', ja: '' }, measure)).toEqual([])
  })
})
