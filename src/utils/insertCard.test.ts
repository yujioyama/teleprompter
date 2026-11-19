import { describe, expect, it } from 'vitest'
import {
  CARD_SECONDS,
  TILT_MAX_DEGREES,
  TILT_MIN_DEGREES,
  TILT_SECONDS,
  camShotsOf,
  cardAfterShot,
  cardBackgroundOf,
  cardLinesOf,
  letterCutsOf,
  cardClipId,
  cardRecordsOf,
  cardSpansOf,
  cardsInOrder,
  cardsOfInbox,
  isCardClip,
  letterScale,
  letterTilt,
  thoughtLinesOfShots,
  wobblesOf,
} from './insertCard'
import { withCardClips, type CardClip } from './cardClips'
import { cardPopSamples, layoutCardText } from './drawInsertCard'
import type { Script, Shot } from '../types'

const shots: Shot[] = [
  { id: 'a', text: 'Line one' },
  { id: 'b', text: 'Line two', heard: true },
  { id: 'c', text: 'Line three', thought: true },
  { id: 'd', text: 'Line four' },
]
const script = (cards: Script['cards'], oneTake = false) => ({ shots, cards, oneTake })

describe('letter pop', () => {
  it('pops each letter in a little after the one before, past full size, then settles', () => {
    expect(letterScale(0, 0)).toBe(0)
    expect(letterScale(3, 0.05)).toBe(0)
    const peak = Math.max(...Array.from({ length: 30 }, (_, i) => letterScale(0, i / 100)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.1)
    expect(letterScale(0, 1)).toBe(1)
    expect(letterScale(9, 1)).toBe(1)
  })
})

describe('wobblesOf', () => {
  const wobbles = wobblesOf('2 days later')

  it('tilts one or two letters at a time, never a space, the whole time the card is up', () => {
    expect(wobbles.length).toBeGreaterThanOrEqual(4)
    for (const wobble of wobbles) {
      expect(wobble.letters.length).toBeGreaterThanOrEqual(1)
      expect(wobble.letters.length).toBeLessThanOrEqual(2)
      for (const i of wobble.letters) expect('2 days later'[i]).not.toBe(' ')
      expect(wobble.start + TILT_SECONDS).toBeLessThanOrEqual(CARD_SECONDS)
    }
  })

  it('picks other letters each time', () => {
    for (let i = 1; i < wobbles.length; i++) {
      expect(wobbles[i].letters.some(l => wobbles[i - 1].letters.includes(l))).toBe(false)
    }
  })

  it('tilts 8-12 degrees either way, out and back', () => {
    for (const wobble of wobbles) {
      for (const angle of wobble.angles) {
        expect(Math.abs(angle)).toBeGreaterThanOrEqual(TILT_MIN_DEGREES)
        expect(Math.abs(angle)).toBeLessThanOrEqual(TILT_MAX_DEGREES)
      }
    }
    const first = wobbles[0]
    const letter = first.letters[0]
    expect(letterTilt(wobbles, letter, first.start)).toBeCloseTo(0)
    expect(Math.abs(letterTilt(wobbles, letter, first.start + TILT_SECONDS / 2))).toBeCloseTo(Math.abs(first.angles[0]))
    expect(letterTilt(wobbles, letter, first.start + TILT_SECONDS)).toBeCloseTo(0)
  })

  it('is the same for the same text, so the preview and the burn agree', () => {
    expect(wobblesOf('2 days later')).toEqual(wobbles)
    expect(wobblesOf('That night')).not.toEqual(wobbles)
    expect(wobblesOf('   ')).toEqual([])
  })
})

describe('the card text', () => {
  const measure = (text: string, font: string) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.6

  it('is in capitals, on two lines split near the middle when it is long', () => {
    expect(cardLinesOf('2 days later')).toEqual(['2 DAYS', 'LATER'])
    expect(cardLinesOf('That night')).toEqual(['THAT', 'NIGHT'])
    expect(cardLinesOf('Later')).toEqual(['LATER'])
    expect(cardLinesOf('Meanwhile...')).toEqual(['MEANWHILE...'])
  })

  it('cuts each letter its own way, the same way every time', () => {
    const cuts = letterCutsOf('2DAYSLATER')
    expect(new Set(cuts.map(c => c.rotate.toFixed(2))).size).toBeGreaterThan(5)
    for (const cut of cuts) {
      expect(Math.abs(cut.rotate)).toBeLessThanOrEqual(7)
      expect(cut.scaleY).toBeGreaterThan(1)
    }
    expect(letterCutsOf('2DAYSLATER')).toEqual(cuts)
  })

  it('fits every line within the width, each centered, the lines around the middle', () => {
    const layout = layoutCardText('Two days later....', 1080, measure)
    const rows = [...new Set(layout.letters.map(l => l.y))]
    expect(rows).toHaveLength(2)
    expect((rows[0] + rows[1]) / 2).toBeCloseTo(960)
    for (const y of rows) {
      const row = layout.letters.filter(l => l.y === y)
      const left = row[0].x
      const right = row.at(-1)!.x + row.at(-1)!.width
      expect(left).toBeGreaterThan(0)
      expect(right).toBeLessThan(1080)
      expect(left).toBeCloseTo(1080 - right)
    }
  })
})

describe('cardPopSamples', () => {
  it('is a short pop that starts and ends quietly', () => {
    const pop = cardPopSamples(48000)
    expect(pop.length).toBe(14400)
    const peak = Math.max(...pop.map(Math.abs))
    expect(peak).toBeGreaterThan(0.2)
    expect(peak).toBeLessThan(1)
    expect(Math.abs(pop[0])).toBeLessThan(0.01)
    expect(Math.abs(pop.at(-1)!)).toBeLessThan(0.01)
  })
})

describe('cardBackgroundOf', () => {
  it('is grape unless one of the others or an https picture is named', () => {
    expect(cardBackgroundOf(undefined)).toEqual({ kind: 'named', name: 'grape' })
    expect(cardBackgroundOf('peach')).toEqual({ kind: 'named', name: 'peach' })
    expect(cardBackgroundOf('neon')).toEqual({ kind: 'named', name: 'grape' })
    expect(cardBackgroundOf('https://x.test/a.jpg')).toEqual({ kind: 'image', url: 'https://x.test/a.jpg' })
    expect(cardBackgroundOf('http://x.test/a.jpg')).toEqual({ kind: 'named', name: 'grape' })
  })
})

describe('cardsInOrder', () => {
  it('puts the cards in line order, each with the line it follows', () => {
    const cards = [
      { id: '2', afterShotId: 'c', text: 'That night' },
      { id: '1', afterShotId: 'a', text: '2 days later' },
    ]
    expect(cardsInOrder(script(cards)).map(c => [c.card.id, c.afterLine])).toEqual([['1', 1], ['2', 3]])
  })

  it('leaves out a card after the last line or a line that is gone, and all of them in 一発撮り', () => {
    const cards = [
      { id: '1', afterShotId: 'd', text: 'x' },
      { id: '2', afterShotId: 'gone', text: 'y' },
      { id: '3', afterShotId: 'a', text: 'z' },
    ]
    expect(cardsInOrder(script(cards)).map(c => c.card.id)).toEqual(['3'])
    expect(cardsInOrder(script(cards, true))).toEqual([])
    expect(cardsInOrder(script(undefined))).toEqual([])
  })
})

describe('cardsOfInbox', () => {
  it('puts each card Claude sent after its line, and drops one after the last line', () => {
    let n = 0
    const cards = cardsOfInbox(
      [{ afterLine: 2, text: '2 days later', background: 'mint' }, { afterLine: 4, text: 'never' }],
      shots,
      () => `id-${++n}`,
    )
    expect(cards).toEqual([{ id: 'id-1', afterShotId: 'b', text: '2 days later', background: 'mint' }])
  })
})

describe('the camera app and the record', () => {
  const cards = [{ id: '1', afterShotId: 'b', text: '2 days later' }]

  it('tells the camera app which line a card follows', () => {
    expect(camShotsOf(script(cards)).map(s => s.cardAfter)).toEqual([undefined, '2 days later', undefined, undefined])
    expect(cardAfterShot(script(cards), 'b')).toBe('2 days later')
    expect(cardAfterShot(script(cards), 'a')).toBeUndefined()
  })

  it('records each card by the line it follows, and the 心の声 lines', () => {
    expect(cardRecordsOf(script(cards))).toEqual([{ afterLine: 2, text: '2 days later' }])
    expect(thoughtLinesOfShots(shots)).toEqual([3])
  })
})

describe('card clips on the joined timeline', () => {
  const clip = (shotId: string, end: number) => ({ shotId, blob: new Blob([shotId]), start: 0, end })
  const card: CardClip = { afterShotId: 'b', clip: clip(cardClipId('1'), CARD_SECONDS), signature: 'card:x' }

  it('goes right after the take of the line it follows, never last', () => {
    const joined = withCardClips([clip('a', 2), clip('b', 3), clip('c', 1)], [card], c => c.clip)
    expect(joined.map(c => c.shotId)).toEqual(['a', 'b', 'card-1', 'c'])
    expect(withCardClips([clip('a', 2), clip('b', 3)], [card], c => c.clip).map(c => c.shotId)).toEqual(['a', 'b'])
    expect(isCardClip(joined[2])).toBe(true)
    expect(isCardClip(joined[1])).toBe(false)
  })

  it('knows where each card is up', () => {
    const joined = withCardClips([clip('a', 2), clip('b', 3), clip('c', 1)], [card], c => c.clip)
    expect(cardSpansOf(joined)).toEqual([{ start: 5, end: 5 + CARD_SECONDS }])
  })
})
