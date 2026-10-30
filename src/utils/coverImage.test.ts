import { describe, it, expect } from 'vitest'
import {
  COVER_TEXT_WIDTH,
  GRID_BOTTOM,
  GRID_TOP,
  clampStickerSpot,
  coverLines,
  coverStickerSpot,
  coverFitRect,
  coverWordsOf,
  fitFontPx,
  type MeasureWidth,
} from './coverImage'
import { STICKER_PLACEMENTS } from './subtitleSticker'
import { EMPHASIS_COLOR, WORD_COLOR } from './subtitleEmphasis'

// Every character is 0.6em wide.
const measure: MeasureWidth = (text, font) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.6

describe('coverWordsOf', () => {
  it('takes the first *phrase* and {word} from the shots, and the kana from the Japanese lines', () => {
    const words = coverWordsOf(
      ['Every time an Australian says *reckon*,', 'I see {renkon}. That is lotus root.', 'And *later* {again}'],
      ['オーストラリア人が「reckon」と言うたびに', '{レンコン}が見える。'],
    )
    expect(words).toEqual({ en: 'reckon', ja: 'renkon レンコン', sticker: '' })
  })

  it('leaves out the kana when there are no Japanese lines yet', () => {
    expect(coverWordsOf(['*turmeric* is {ukon}'])).toEqual({ en: 'turmeric', ja: 'ukon', sticker: '' })
  })

  it('does not repeat the word when the translation kept it in romaji', () => {
    expect(coverWordsOf(['{ukon}'], ['{ukon}だ'])).toEqual({ en: '', ja: 'ukon', sticker: '' })
  })

  it('gives empty strings for a script without markers', () => {
    expect(coverWordsOf(['5 * 3 * 2', 'plain'])).toEqual({ en: '', ja: '', sticker: '' })
  })

  it("takes the first line's emoji as the sticker", () => {
    expect(coverWordsOf(['I put *Vaseline*🧴 on', 'then 🤯']).sticker).toBe('🧴')
    expect(coverWordsOf(['no emoji here', 'then 🤯']).sticker).toBe('')
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
    const lines = coverLines({ en: 'reckon', ja: 'renkon レンコン', sticker: '' }, measure)
    expect(lines.map(l => [l.text, l.color])).toEqual([
      ['reckon', EMPHASIS_COLOR],
      ['renkon レンコン', WORD_COLOR],
    ])
    expect(lines[0].y).toBeLessThan(lines[1].y)
    expect(lines[0].y - lines[0].px).toBeGreaterThan(GRID_TOP)
    expect(lines[1].y).toBeLessThan(GRID_BOTTOM)
  })

  it('moves the block up and down with the position', () => {
    const words = { en: 'reckon', ja: 'renkon レンコン', sticker: '' }
    const top = coverLines(words, measure, 20)
    const bottom = coverLines(words, measure, 80)
    expect(top[0].y).toBeLessThan(bottom[0].y)
    expect(coverLines(words, measure)).toEqual(coverLines(words, measure, 68))
  })

  it('keeps the block inside the grid window at either end of the slider', () => {
    const words = { en: 'reckon', ja: 'renkon レンコン', sticker: '' }
    const top = coverLines(words, measure, 0)
    expect(top[0].y - top[0].px).toBeGreaterThan(GRID_TOP)
    const bottom = coverLines(words, measure, 100)
    expect(bottom[1].y).toBeLessThan(GRID_BOTTOM)
  })

  it('skips an empty line', () => {
    expect(coverLines({ en: '  ', ja: 'ukon', sticker: '' }, measure).map(l => l.text)).toEqual(['ukon'])
    expect(coverLines({ en: '', ja: '', sticker: '' }, measure)).toEqual([])
  })

  const fits = (l: { text: string; px: number }) => measure(l.text, `800 ${l.px}px x`) <= COVER_TEXT_WIDTH

  it('keeps a phrase on one line while it fits at the smallest size', () => {
    const lines = coverLines({ en: 'happy as a clam', ja: '', sticker: '' }, measure)
    expect(lines.map(l => l.text)).toEqual(['happy as a clam'])
  })

  it('breaks a phrase too long for one line into two even halves of one size', () => {
    const lines = coverLines({ en: 'as happy as a clam at high tide', ja: '', sticker: '' }, measure)
    expect(lines.map(l => l.text)).toEqual(['as happy as a', 'clam at high tide'])
    expect(lines.every(l => l.color === EMPHASIS_COLOR && l.px === lines[0].px)).toBe(true)
    expect(lines.every(fits)).toBe(true)
    expect(lines[1].y - lines[0].y).toBeGreaterThan(lines[0].px)
  })

  it('puts the romaji over the kana when the Japanese word is too long for one line', () => {
    const lines = coverLines({ en: 'thanks', ja: 'gochisousamadeshita ごちそうさまでした', sticker: '' }, measure)
    expect(lines.map(l => [l.text, l.color])).toEqual([
      ['thanks', EMPHASIS_COLOR],
      ['gochisousamadeshita', WORD_COLOR],
      ['ごちそうさまでした', WORD_COLOR],
    ])
    expect(lines.every(fits)).toBe(true)
  })

  it('shrinks past the smallest size when even two lines would not fit', () => {
    const word = coverLines({ en: 'a'.repeat(40), ja: '', sticker: '' }, measure)
    expect(word).toHaveLength(1)
    expect(word.every(fits)).toBe(true)
    const halves = coverLines({ en: '', ja: `${'a'.repeat(30)} ${'b'.repeat(30)}`, sticker: '' }, measure)
    expect(halves).toHaveLength(2)
    expect(halves.every(fits)).toBe(true)
  })

  it('keeps wrapped lines inside the grid window at either end of the slider', () => {
    const words = { en: 'as happy as a clam at high tide', ja: 'gochisousamadeshita ごちそうさまでした', sticker: '' }
    const top = coverLines(words, measure, 0)
    expect(top[0].y - top[0].px).toBeGreaterThan(GRID_TOP)
    const bottom = coverLines(words, measure, 100)
    expect(bottom[bottom.length - 1].y).toBeLessThan(GRID_BOTTOM)
  })
})

describe('coverStickerSpot', () => {
  it("puts the sticker where the video's first frame has it until it is dragged", () => {
    expect(coverStickerSpot('chest', null)).toEqual(STICKER_PLACEMENTS.chest)
    expect(coverStickerSpot('off', null)).toEqual(STICKER_PLACEMENTS.right)
  })

  it('goes where it was dragged, keeping the tilt', () => {
    expect(coverStickerSpot('left', { x: 0.7, y: 20 })).toEqual({ x: 0.7, y: 20, rotation: STICKER_PLACEMENTS.left.rotation })
  })

  it('keeps a dragged sticker on the cover', () => {
    expect(clampStickerSpot({ x: -0.2, y: 130 })).toEqual({ x: 0, y: 100 })
    expect(coverStickerSpot('right', { x: 1.5, y: -10 })).toMatchObject({ x: 1, y: 0 })
  })
})

describe('coverFitRect', () => {
  it('fills a tall frame from a wide picture, cropping its sides', () => {
    const rect = coverFitRect(1920, 1080, 1080, 1920)
    expect(rect.height).toBe(1920)
    expect(rect.y).toBe(0)
    expect(rect.width).toBeCloseTo(3413.33, 2)
    expect(rect.x).toBeCloseTo((1080 - rect.width) / 2, 6)
  })

  it('fills the frame from a taller picture, cropping top and bottom', () => {
    expect(coverFitRect(1000, 2000, 1080, 1920)).toEqual({ x: 0, y: -120, width: 1080, height: 2160 })
  })

  it('scales a picture of the same shape to fit exactly', () => {
    expect(coverFitRect(540, 960, 1080, 1920)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  })
})
