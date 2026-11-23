import { describe, expect, it } from 'vitest'
import { OPENING_WIPE_S, openingCardPlanOf, openingTimingOf } from './openingCard'
import { SHOOTING_SECONDS, STARS, drawStarsOpening, layoutStarsOpening, shootingStarsOf, starBrightness, starsSceneOf } from './openingStars'
import {
  FLICKER_DIP,
  FLICKER_EVERY_S,
  FLICKERS,
  FOG_PUFFS,
  SHIVER_SHARE,
  cardBackgroundOf,
  cardSpansOf,
  flickerAt,
  fogPuffAt,
  isSpookyCard,
  letterScale,
  letterShiver,
  popScaleAt,
  POP_STAGGER_SECONDS,
  spookyCardClipsOf,
} from './insertCard'
import { cardDuckAt, sameEnding, bgmEnding, CARD_RAMP_SECONDS } from './bgmStop'
import { cardFilters } from './mixMusic'
import { MIST_HUSH_LEVEL, MIST_VOICE_LEVEL, cardMistSamples, cardPopSamples } from './drawInsertCard'

const TEXT = 'I tried natto for the first time'
// Every character as wide as the font's size × 0.5.
const measure = (text: string, font: string) => [...text].length * Number(/(\d+)px/.exec(font)![1]) * 0.5

describe('the night-sky opening', () => {
  it('cuts to line 1 when the words are done, where the 暖簾 is walked through', () => {
    const stars = openingTimingOf(TEXT, null, 'stars')
    const noren = openingTimingOf(TEXT, null, 'noren')
    expect(stars.wipeAt).toBe(noren.wipeAt)
    expect(stars.seconds).toBeGreaterThanOrEqual(stars.wipeAt - 1e-6)
    expect(stars.seconds).toBeLessThan(stars.wipeAt + 1 / 30 + 1e-6)
    expect(noren.seconds).toBeGreaterThanOrEqual(noren.wipeAt + OPENING_WIPE_S - 1e-6)
    expect(Math.abs(stars.seconds * 30 - Math.round(stars.seconds * 30))).toBeLessThan(1e-6)
  })

  it('carries its style in the plan, the 暖簾 when none is said', () => {
    expect(openingCardPlanOf({ text: TEXT }, null, 'stars')?.style).toBe('stars')
    expect(openingCardPlanOf({ text: TEXT })?.style).toBe('noren')
    expect(openingCardPlanOf({ text: TEXT }, null, 'stars')?.timing.seconds).toBeLessThan(openingCardPlanOf({ text: TEXT })!.timing.seconds)
  })

  it('lays out every letter of the sentence in capitals, by its place in the sentence, within the safe width', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure, '初めて納豆を食べてみた')
    const letters = [...TEXT].flatMap((ch, i) => (ch === ' ' ? [] : [i]))
    expect(layout.letters.map(l => l.src)).toEqual(letters)
    expect(layout.letters.map(l => l.ch).join('')).toBe(TEXT.replace(/ /g, '').toUpperCase())
    expect(layout.shown).toHaveLength(TEXT.length)
    for (const l of layout.letters) {
      expect(l.x).toBeGreaterThan(1080 * 0.08)
      expect(l.x).toBeLessThan(1080 * 0.92)
    }
    // A few lines, the Japanese under the last.
    const rows = new Set(layout.letters.map(l => l.y))
    expect(rows.size).toBeGreaterThan(1)
    expect(rows.size).toBeLessThanOrEqual(4)
    expect(layout.ja!.y).toBeGreaterThan(Math.max(...rows))
  })

  it('types the Japanese alongside the English, not after it', () => {
    const JA = '初めて納豆を食べてみた'
    const timing = openingTimingOf(TEXT, null, 'stars')
    const scene = starsSceneOf(TEXT, layoutStarsOpening(TEXT, 1080, 1920, measure, JA), timing)
    const jaDrawnAt = (t: number) => {
      const drawn: string[] = []
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (target, key) =>
          key === 'fillText' ? (s: string) => drawn.push(s)
            : key in target ? target[key as string]
              : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} })
                : () => {},
        set: (target, key, value) => ((target[key as string] = value), true),
      })
      drawStarsOpening(ctx as unknown as CanvasRenderingContext2D, null, scene, t, 1080, 1920)
      // The Japanese is what's drawn in its characters.
      return [...new Set(drawn.filter(s => /[぀-鿿]/.test(s)))].join('').length
    }
    expect(jaDrawnAt(timing.charTimes[0] - 0.01)).toBe(0)
    const midway = jaDrawnAt((timing.charTimes[0] + timing.typedEnd) / 2)
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(JA.length)
    expect(jaDrawnAt(timing.typedEnd)).toBe(JA.length)
    // Each line starts where it will end up, so nothing shifts as it's typed.
    const { lefts, lines } = scene.layout.ja!
    expect(lefts).toHaveLength(lines.length)
  })

  it('keeps a word on one line', () => {
    const layout = layoutStarsOpening(TEXT, 1080, 1920, measure)
    const rowOf = new Map(layout.letters.map(l => [l.src, l.y]))
    // "natto" is source letters 8-12.
    expect(new Set([8, 9, 10, 11, 12].map(i => rowOf.get(i))).size).toBe(1)
  })

  it('twinkles its stars between dim and bright', () => {
    for (const star of STARS.slice(0, 20)) {
      for (const t of [0, 0.3, 1.1, 2.7]) {
        const a = starBrightness(star, t)
        expect(a).toBeGreaterThanOrEqual(0.25 - 1e-9)
        expect(a).toBeLessThanOrEqual(0.85 + 1e-9)
      }
    }
  })

  it('sends a shooting star now and then, the same for the same sentence, each gone before the cut', () => {
    const shots = shootingStarsOf(TEXT, 3)
    expect(shots.length).toBeGreaterThanOrEqual(2)
    expect(shots.length).toBeLessThanOrEqual(4)
    expect(shots[0].at).toBeCloseTo(0.4)
    for (const s of shots) expect(s.at + SHOOTING_SECONDS).toBeLessThanOrEqual(3)
    expect(shootingStarsOf(TEXT, 3)).toEqual(shots)
    expect(shootingStarsOf(TEXT, 0.5)).toEqual([])
  })
})

describe('the spooky card', () => {
  it('is the grape card only', () => {
    expect(isSpookyCard(cardBackgroundOf(undefined))).toBe(true)
    expect(isSpookyCard(cardBackgroundOf('grape'))).toBe(true)
    for (const name of ['night', 'paper', 'peach', 'mint']) expect(isSpookyCard(cardBackgroundOf(name))).toBe(false)
    expect(isSpookyCard(cardBackgroundOf('https://example.com/a.jpg'))).toBe(false)
  })

  it('flickers in short dips, round again on a longer card', () => {
    const [start, length] = FLICKERS[0]
    expect(flickerAt(start + length / 2)).toBe(FLICKER_DIP)
    expect(flickerAt(start - 0.01)).toBe(0)
    expect(flickerAt(FLICKER_EVERY_S + start + length / 2)).toBe(FLICKER_DIP)
    expect(flickerAt(0)).toBe(0)
  })

  it('shivers each letter a little, frame by frame, the same on every draw', () => {
    const a = letterShiver(3, 0.5)
    expect(letterShiver(3, 0.5)).toEqual(a)
    expect(letterShiver(3, 0.5 + 1 / 30)).not.toEqual(a)
    expect(Math.abs(a.dx)).toBeLessThanOrEqual(SHIVER_SHARE)
    expect(Math.abs(a.dy)).toBeLessThanOrEqual(SHIVER_SHARE)
  })

  it('drifts its fog across and up, coming round past the edge', () => {
    const puff = FOG_PUFFS[0]
    const early = fogPuffAt(puff, 0, 1080, 1920)
    const later = fogPuffAt(puff, 1, 1080, 1920)
    expect(later.y).toBeLessThan(early.y)
    for (const t of [0, 0.7, 1.8, 5]) {
      const { x, r } = fogPuffAt(puff, t, 1080, 1920)
      expect(x).toBeGreaterThanOrEqual(-r - 1e-6)
      expect(x).toBeLessThanOrEqual(1080 + r + 1e-6)
    }
  })

  it('pops its letters in as before', () => {
    expect(letterScale(4, 0.1)).toBe(popScaleAt(0.1 - 4 * POP_STAGGER_SECONDS))
    expect(popScaleAt(0)).toBe(0)
    expect(popScaleAt(1)).toBe(1)
  })

  it('sounds a quiet mist under the pop, fading out by the card’s end', () => {
    const rate = 8000
    const mist = cardMistSamples(rate, 1.8)
    expect(mist).toHaveLength(Math.round(1.8 * rate))
    const peak = mist.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const pop = cardPopSamples(rate).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(pop / 2)
    expect(peak).toBeLessThan(MIST_HUSH_LEVEL + MIST_VOICE_LEVEL)
    expect(Math.abs(mist[mist.length - 1])).toBeLessThan(1e-3)
    expect(cardMistSamples(rate, 1.8)).toEqual(mist)
  })
})

describe('the BGM through a spooky card', () => {
  const clips = [
    { shotId: 'a', start: 0, end: 4 },
    { shotId: 'card-k', start: 0, end: 1.8 },
    { shotId: 'b', start: 0, end: 3 },
    { shotId: 'card-m', start: 0, end: 1.8 },
    { shotId: 'c', start: 0, end: 3 },
  ]
  const script = { cards: [{ id: 'k', afterShotId: 'a', text: '2 days later' }, { id: 'm', afterShotId: 'b', text: 'Later', background: 'paper' }] }

  it('goes silent through it, and soft through the others', () => {
    const spans = cardSpansOf(clips, spookyCardClipsOf(script))
    expect(spans.map(s => s.silent)).toEqual([true, undefined])
    expect(spans[0]).toEqual({ start: 4, end: 5.8, silent: true })
    expect(spans[1].start).toBeCloseTo(8.8)
    expect(cardDuckAt(5, spans)).toBe(0)
    expect(cardDuckAt(9.5, spans)).toBeCloseTo(0.5)
    expect(cardDuckAt(5.8 + CARD_RAMP_SECONDS + 0.01, spans)).toBe(1)
    expect(cardFilters(spans)).toContain('(1-1*min(')
    expect(cardFilters(spans)).toContain('(1-0.5*min(')
  })

  it('tells a silent card from a soft one when comparing endings', () => {
    expect(sameEnding(bgmEnding('lofi', null, [{ start: 4, end: 5.8, silent: true }]), bgmEnding('lofi', null, [{ start: 4, end: 5.8 }]))).toBe(false)
  })
})
