import { describe, it, expect } from 'vitest'
import { findSticker, reapplyStickers, stickerOf, stripStickers } from './subtitleSticker'

describe('findSticker', () => {
  it('finds the first emoji, keeping joiners, variation selectors and skin tones', () => {
    expect(findSticker('I put *Vaseline*🧴 on')).toBe('🧴')
    expect(findSticker('a 👨‍🍳 and a 🐈')).toBe('👨‍🍳')
    expect(findSticker('love ❤️')).toBe('❤️')
    expect(findSticker('ok 👍🏽')).toBe('👍🏽')
  })

  it('is null without one', () => {
    expect(findSticker('I thought *carry a torch* was romantic.')).toBeNull()
    expect(findSticker('5 * 3 = 15')).toBeNull()
  })
})

describe('stripStickers', () => {
  it('removes emoji and tidies the spaces they leave', () => {
    expect(stripStickers('I put *Vaseline*🧴 on')).toBe('I put *Vaseline* on')
    expect(stripStickers('🧴 Vaseline, every night 🌙.')).toBe('Vaseline, every night.')
    expect(stripStickers('No emoji here')).toBe('No emoji here')
  })
})

describe('stickerOf', () => {
  it('takes the first hook cue\'s emoji, ignoring normal cues', () => {
    expect(stickerOf([
      { en: 'Hi 👋', variant: 'normal' },
      { en: 'No emoji', variant: 'hook' },
      { en: 'Then 🧴', variant: 'hook' },
    ])).toBe('🧴')
    expect(stickerOf([{ en: 'Hi 👋', variant: 'normal' }])).toBeNull()
  })
})

describe('reapplyStickers', () => {
  const shots = [
    { text: 'I put *Vaseline*🧴 on', duration: 2 },
    { text: 'It keeps them 💡 neat', duration: 3 },
    { text: 'Try it', duration: 2 },
  ]

  it('puts each script line\'s emoji back on the first transcribed cue of its shot', () => {
    const cues = [
      { en: 'I put Vaseline on', start: 0.3, id: 'a' },
      { en: 'every night', start: 1.2, id: 'b' },
      { en: 'It keeps them neat', start: 2.4, id: 'c' },
      { en: 'Try it', start: 5.2, id: 'd' },
    ]
    expect(reapplyStickers(cues, shots)).toEqual([
      { en: 'I put Vaseline on🧴', start: 0.3, id: 'a' },
      { en: 'every night', start: 1.2, id: 'b' },
      { en: 'It keeps them neat💡', start: 2.4, id: 'c' },
      { en: 'Try it', start: 5.2, id: 'd' },
    ])
  })

  it('leaves a shot alone when its line has no emoji, its cues already have one, or it has no cue', () => {
    const cues = [{ en: 'Hi 🐈', start: 0 }, { en: 'Try it', start: 5.5 }]
    expect(reapplyStickers(cues, shots)).toBe(cues)
    expect(reapplyStickers([], shots)).toEqual([])
  })
})
