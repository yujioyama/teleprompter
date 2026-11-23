import { describe, expect, it } from 'vitest'
import { cuesFromShotEntries } from './subtitleCues'
import { CARD_DUCK_LEVEL, CARD_RAMP_SECONDS, bgmEnding, cardDuckAt, delayEnding, sameEnding } from './bgmStop'
import { buildMixFilterComplex, cardFilters } from './mixMusic'
import { THOUGHT_TAIL_S, rms, thinkingVoice } from './voiceEffects'
import { THOUGHT_TEXT_WIDTH, cloudPath, layoutCue, SUBTITLE_REFERENCE_WIDTH } from './subtitleLayout'
import { isThought, speakerOf, withSpeakers } from './speakers'
import { hookOptionsOf } from './subtitleHook'
import { cardCueInput } from './insertCard'

const measure = (text: string, font: string) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.55

describe('subtitles around a 挿入カード', () => {
  it('gives the card no cue, moves the lines after it on, and keeps every cue id', () => {
    const without = cuesFromShotEntries([{ text: 'One', duration: 2 }, { text: 'Two', duration: 3 }])
    const withCard = cuesFromShotEntries([{ text: 'One', duration: 2 }, cardCueInput(1.8), { text: 'Two', duration: 3 }])
    expect(withCard.map(c => c.id)).toEqual(without.map(c => c.id))
    expect(withCard.map(c => [c.en, c.start, c.end])).toEqual([['One', 0, 2], ['Two', 3.8, 6.8]])
  })
})

describe('the BGM under a card', () => {
  const cards = [{ start: 4, end: 5.8 }]

  it('goes down to half over 0.2s as the card comes up and back up after it', () => {
    expect(cardDuckAt(3.9, cards)).toBe(1)
    expect(cardDuckAt(4 + CARD_RAMP_SECONDS / 2, cards)).toBeCloseTo((1 + CARD_DUCK_LEVEL) / 2)
    expect(cardDuckAt(5, cards)).toBeCloseTo(CARD_DUCK_LEVEL)
    expect(cardDuckAt(5.8 + CARD_RAMP_SECONDS / 2, cards)).toBeCloseTo((1 + CARD_DUCK_LEVEL) / 2)
    expect(cardDuckAt(6.1, cards)).toBe(1)
    expect(cardDuckAt(5, [])).toBe(1)
  })

  it('keeps the cards with the ending, moved along with the cover frames', () => {
    const ending = bgmEnding('lofi', 10, cards)
    expect(ending.cards).toEqual(cards)
    expect(delayEnding(ending, 0.5).cards).toEqual([{ start: 4.5, end: 6.3 }])
    // A spooky card stays silent once moved (after the opening card, it always is).
    expect(delayEnding(bgmEnding('lofi', 10, [{ start: 4, end: 5.8, silent: true }]), 3.2).cards).toEqual([{ start: 7.2, end: 9, silent: true }])
    expect(bgmEnding('lofi', 10)).not.toHaveProperty('cards')
    expect(sameEnding(ending, bgmEnding('lofi', 10, [{ start: 4, end: 5.8 }]))).toBe(true)
    expect(sameEnding(ending, bgmEnding('lofi', 10))).toBe(false)
  })

  it('softens and muffles the BGM there on the ffmpeg path too, and leaves the graph alone without cards', () => {
    expect(cardFilters([])).toBe('')
    const filters = cardFilters(cards)
    expect(filters).toContain("lowpass=f=900:enable='between(t,4.100,5.900)'")
    expect(filters).toContain('clip((t-4.000)/0.2,0,1)')
    expect(buildMixFilterComplex(10, 0.3, { stopAt: null, soft: false, cards })).toContain(filters)
    expect(buildMixFilterComplex(10, 0.3)).not.toContain('lowpass')
  })
})

describe('thinkingVoice', () => {
  const sampleRate = 16000
  const voice = Float32Array.from({ length: sampleRate / 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate))
  const tail = (out: Float32Array) => rms(out.subarray(voice.length + sampleRate * 0.05))

  it('rings on after the voice, longer by the echo tail', () => {
    const out = thinkingVoice(voice, sampleRate)
    expect(out.length).toBe(voice.length + Math.round(THOUGHT_TAIL_S * sampleRate))
    expect(tail(out)).toBeGreaterThan(0.005)
  })

  it('echoes more when set stronger', () => {
    expect(tail(thinkingVoice(voice, sampleRate, 'strong'))).toBeGreaterThan(tail(thinkingVoice(voice, sampleRate, 'light')))
  })

  it('keeps the voice as loud as it was, give or take', () => {
    const out = thinkingVoice(voice, sampleRate, 'medium')
    const level = rms(out.subarray(0, voice.length)) / rms(voice)
    expect(level).toBeGreaterThan(0.6)
    expect(level).toBeLessThan(1.4)
  })
})

describe('the 心の声 cloud', () => {
  it('wraps the line in a cloud with circles trailing down, and no icon', () => {
    const layout = layoutCue({ en: 'I should have flossed more', ja: null }, measure, { thought: true })
    expect(layout.bubble).toBeUndefined()
    const cloud = layout.cloud!
    expect(cloud.left).toBeCloseTo(SUBTITLE_REFERENCE_WIDTH - cloud.left - cloud.width)
    expect(layout.en.widths.every(w => w <= THOUGHT_TEXT_WIDTH)).toBe(true)
    // Each circle smaller and further down than the one before, all below the cloud.
    cloud.dots.forEach((dot, i) => {
      expect(dot.y).toBeGreaterThan(cloud.top + cloud.height)
      if (i > 0) {
        expect(dot.r).toBeLessThan(cloud.dots[i - 1].r)
        expect(dot.y).toBeGreaterThan(cloud.dots[i - 1].y)
      }
    })
    const last = cloud.dots.at(-1)!
    expect(layout.height).toBeGreaterThan(last.y + last.r)
    expect(cloudPath(cloud)).toMatch(/^M[\d. ]+( A[\d. ]+0 0 1 [\d. ]+)+ Z$/)
  })

  it('leaves the other cues as they were', () => {
    expect(layoutCue({ en: 'Hi', ja: null }, measure).cloud).toBeUndefined()
  })

  it("marks the thought's cues, and gives them no speaker", () => {
    const hook = hookOptionsOf({ hookStyleEnabled: false, hookPosition: 20, punchInEnabled: false } as never)
    const cues = [
      { id: 'shot-0', start: 0, end: 2, en: 'Open wide', ja: null },
      { id: 'shot-1', start: 2, end: 4, en: 'Oh no', ja: null },
    ]
    const marked = withSpeakers(hook, cues, [{ text: 'Open wide', duration: 2, speaker: '🧑‍⚕️' }, { text: 'Oh no', duration: 2, thought: true }])
    expect(isThought(marked, 'shot-1')).toBe(true)
    expect(isThought(marked, 'shot-0')).toBe(false)
    expect(speakerOf(marked, 'shot-1')).toBeUndefined()
    expect(withSpeakers(hook, cues, [{ text: 'a', duration: 2 }, { text: 'b', duration: 2 }])).toBe(hook)
  })
})
