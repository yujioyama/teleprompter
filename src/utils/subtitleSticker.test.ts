import { describe, it, expect } from 'vitest'
import { findSticker, reapplySticker, stickerOf, stripStickers } from './subtitleSticker'

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

describe('reapplySticker', () => {
  it('puts the first script line\'s emoji on the first transcribed cue', () => {
    const cues = [{ en: 'I put Vaseline on', id: 'a' }, { en: 'every night', id: 'b' }]
    expect(reapplySticker(cues, ['I put *Vaseline*🧴 on', 'Every night'])).toEqual([
      { en: 'I put Vaseline on🧴', id: 'a' },
      { en: 'every night', id: 'b' },
    ])
  })

  it('leaves the cues alone without an emoji, or when the first cue has one', () => {
    const cues = [{ en: 'Hi' }]
    expect(reapplySticker(cues, ['Hi'])).toBe(cues)
    const withOne = [{ en: 'Hi 🐈' }]
    expect(reapplySticker(withOne, ['Hi 🧴'])).toBe(withOne)
    expect(reapplySticker([], ['Hi 🧴'])).toEqual([])
  })
})
