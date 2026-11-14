import { describe, expect, it } from 'vitest'
import type { Shot } from '../types'
import { withSpeakerVoice } from './speakerVoice'

const shot = (id: string, extra: Partial<Shot> = {}) => ({ id, text: id, ...extra }) as Shot

describe('withSpeakerVoice', () => {
  it("gives every line of the same person the voice, and leaves the others' alone", () => {
    const shots = [
      shot('1', { heard: true, speaker: '👦', voice: 'kid' }),
      shot('2'),
      shot('3', { heard: true, speaker: '👩', voice: 'high' }),
      shot('4', { heard: true, speaker: '👦', voice: 'kid' }),
    ]
    const out = withSpeakerVoice(shots, '4', 'phoneKid')
    expect(out.map(s => s.voice)).toEqual(['phoneKid', undefined, 'high', 'phoneKid'])
  })

  it('treats lines without an icon as one person', () => {
    const shots = [shot('1', { heard: true }), shot('2'), shot('3', { heard: true, voice: 'low' })]
    expect(withSpeakerVoice(shots, '1', 'phoneHigh').map(s => s.voice)).toEqual(['phoneHigh', undefined, 'phoneHigh'])
  })

  it('stores the natural voice as no voice', () => {
    const shots = [shot('1', { heard: true, voice: 'kid' }), shot('2', { heard: true, voice: 'kid' })]
    expect(withSpeakerVoice(shots, '1', 'natural').map(s => s.voice)).toEqual([undefined, undefined])
  })
})
