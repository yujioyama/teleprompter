import { describe, it, expect } from 'vitest'
import { durationsMatch } from './finalAudio'

const RATE = 48000
const FRAME = 1024 / RATE

describe('durationsMatch', () => {
  it('accepts the few ms two encodes of the same cut can differ by', () => {
    expect(durationsMatch(12.0, 12.0, RATE)).toBe(true)
    expect(durationsMatch(12.03, 12.0, RATE)).toBe(true)
    expect(durationsMatch(11.96, 12.0, RATE)).toBe(true)
  })

  it('accepts the final encode\'s tail padding on top of the tolerance', () => {
    // 31-36 ms of padding measured over a cut that already differs by a frame.
    expect(durationsMatch(12.036 + FRAME, 12.0, RATE)).toBe(true)
  })

  it('pins the tolerance edge, one AAC frame wider on the long side', () => {
    expect(durationsMatch(12.0 + 0.05 + FRAME - 0.001, 12.0, RATE)).toBe(true)
    expect(durationsMatch(12.0 + 0.05 + FRAME + 0.001, 12.0, RATE)).toBe(false)
    expect(durationsMatch(11.951, 12.0, RATE)).toBe(true)
    expect(durationsMatch(11.949, 12.0, RATE)).toBe(false)
  })

  it('sizes the frame by the audio track\'s sample rate', () => {
    // 1024 samples are 23.2 ms at 44.1 kHz, 21.3 ms at 48 kHz.
    expect(durationsMatch(12.0 + 0.05 + 0.022, 12.0, 44100)).toBe(true)
    expect(durationsMatch(12.0 + 0.05 + 0.022, 12.0, 48000)).toBe(false)
  })

  it('rejects audio built for a differently cut video', () => {
    expect(durationsMatch(12.2, 12.0, RATE)).toBe(false)
    expect(durationsMatch(11.0, 12.0, RATE)).toBe(false)
  })
})
