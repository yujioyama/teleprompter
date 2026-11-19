import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Script } from '../types'
import { cardClipsOf } from './cardClips'
import { cardSecondsFor } from './insertCard'
import { rawCardClipWebCodecs } from './webcodecs/cardClip'
import { getCardVoice } from './cardVoiceStore'
import { prepareCardVoice } from './webcodecs/cardVoice'

vi.mock('./webcodecs/support', () => ({ hasWebCodecs: vi.fn(async () => true) }))
vi.mock('./webcodecs/cardClip', () => ({ rawCardClipWebCodecs: vi.fn(async () => new Blob(['card'])) }))
vi.mock('./cardVoiceStore', () => ({ getCardVoice: vi.fn(async () => null) }))
vi.mock('./webcodecs/cardVoice', () => ({ prepareCardVoice: vi.fn(async () => null) }))

// Each test its own card text: drawn cards are kept between calls by what they look like.
function script(text: string): Pick<Script, 'id' | 'cards' | 'cardAudio' | 'oneTake' | 'shots'> {
  return {
    id: 's1',
    shots: [{ id: 'a', text: 'Line one' }, { id: 'b', text: 'Line two' }],
    cards: [{ id: 'c1', afterShotId: 'a', text }],
  }
}

const voiceArg = () => vi.mocked(rawCardClipWebCodecs).mock.calls.at(-1)?.[4]

describe('cardClipsOf', () => {
  beforeEach(() => {
    vi.mocked(rawCardClipWebCodecs).mockClear()
    vi.mocked(getCardVoice).mockReset().mockResolvedValue(null)
    vi.mocked(prepareCardVoice).mockReset().mockResolvedValue(null)
  })

  it('draws a card with no voice as before: 1.8 s, no voice, the same signature', async () => {
    const [card] = await cardClipsOf(script('No voice'))
    expect(card.clip.end).toBe(1.8)
    expect(voiceArg()).toBeUndefined()
    expect(card.signature).toBe(`card:${JSON.stringify(['No voice', 'grape', true])}`)
    expect(getCardVoice).toHaveBeenCalledWith('s1', 'c1')
    expect(prepareCardVoice).not.toHaveBeenCalled()
  })

  it('reads the stored voice on the card, lasting as long as the voice needs', async () => {
    const [plain] = await cardClipsOf(script('Two weeks later'))
    const blob = new Blob(['voice'])
    const prepared = { samples: new Float32Array(48000 * 2), sampleRate: 48000 }
    vi.mocked(getCardVoice).mockResolvedValue({ blob, savedAt: '2026-11-19T10:00:00.000Z' })
    vi.mocked(prepareCardVoice).mockResolvedValue(prepared)
    const [voiced] = await cardClipsOf(script('Two weeks later'))
    expect(prepareCardVoice).toHaveBeenCalledWith(blob)
    expect(voiced.clip.end).toBeCloseTo(cardSecondsFor(2))
    expect(voiced.clip.end).toBeGreaterThan(1.8)
    expect(voiceArg()).toBe(prepared)
    expect(voiced.signature).not.toBe(plain.signature)
    expect(voiced.signature).toContain('2026-11-19T10:00:00.000Z')
  })

  it('draws a stored voice with no speech in it as a card with no voice, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getCardVoice).mockResolvedValue({ blob: new Blob(['hush']), savedAt: '2026-11-19T11:00:00.000Z' })
    const [card] = await cardClipsOf(script('Silent voice'))
    expect(card.clip.end).toBe(1.8)
    expect(voiceArg()).toBeUndefined()
    expect(card.signature).toBe(`card:${JSON.stringify(['Silent voice', 'grape', true])}`)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
