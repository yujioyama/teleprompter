import { describe, it, expect } from 'vitest'
import { cuesFromWhisperChunks } from './transcribeSpeech'

describe('cuesFromWhisperChunks', () => {
  it('maps each chunk to a cue with start/end from the timestamp tuple', () => {
    const cues = cuesFromWhisperChunks([
      { text: ' Hello there', timestamp: [0, 1.5] },
      { text: ' This is a test', timestamp: [1.5, 3.2] },
    ])
    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ start: 0, end: 1.5, en: 'Hello there', ja: null })
    expect(cues[1]).toMatchObject({ start: 1.5, end: 3.2, en: 'This is a test', ja: null })
  })

  it('trims leading/trailing whitespace Whisper commonly emits around words', () => {
    const cues = cuesFromWhisperChunks([{ text: '  Hello   ', timestamp: [0, 1] }])
    expect(cues[0].en).toBe('Hello')
  })

  it('falls back to start + 2s when the final chunk has a null end timestamp', () => {
    // Whisper's chunking can leave the last segment's end timestamp null
    // when the audio cuts off mid-word.
    const cues = cuesFromWhisperChunks([{ text: 'Cut off', timestamp: [10, null] }])
    expect(cues[0].start).toBe(10)
    expect(cues[0].end).toBe(12)
  })

  it('assigns stable, unique ids in order', () => {
    const cues = cuesFromWhisperChunks([
      { text: 'a', timestamp: [0, 1] },
      { text: 'b', timestamp: [1, 2] },
    ])
    expect(cues[0].id).not.toBe(cues[1].id)
  })

  it('returns an empty array for empty input', () => {
    expect(cuesFromWhisperChunks([])).toEqual([])
  })
})
