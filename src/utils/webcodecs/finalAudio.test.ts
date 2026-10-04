import { describe, it, expect } from 'vitest'
import { durationsMatch } from './finalAudio'
import { fitChannelData } from './audioTrack'

describe('durationsMatch', () => {
  it('accepts the few ms two encodes of the same cut can differ by', () => {
    expect(durationsMatch(12.0, 12.0)).toBe(true)
    expect(durationsMatch(12.03, 12.0)).toBe(true)
    expect(durationsMatch(11.96, 12.0)).toBe(true)
  })

  it('pins the tolerance edge', () => {
    expect(durationsMatch(12.049, 12.0)).toBe(true)
    expect(durationsMatch(11.951, 12.0)).toBe(true)
    expect(durationsMatch(12.051, 12.0)).toBe(false)
    expect(durationsMatch(11.949, 12.0)).toBe(false)
  })

  it('rejects audio built for a differently cut video', () => {
    expect(durationsMatch(12.2, 12.0)).toBe(false)
    expect(durationsMatch(11.0, 12.0)).toBe(false)
  })
})

describe('fitChannelData', () => {
  it('cuts the tail of every channel to the length', () => {
    const [l, r] = fitChannelData([Float32Array.of(1, 2, 3, 4), Float32Array.of(5, 6, 7, 8)], 3)
    expect(Array.from(l)).toEqual([1, 2, 3])
    expect(Array.from(r)).toEqual([5, 6, 7])
  })

  it('pads shorter channels with silence', () => {
    const [l] = fitChannelData([Float32Array.of(1, 2)], 5)
    expect(Array.from(l)).toEqual([1, 2, 0, 0, 0])
  })

  it('returns copies and keeps an exact length as it is', () => {
    const input = Float32Array.of(1, 2, 3)
    const [out] = fitChannelData([input], 3)
    expect(Array.from(out)).toEqual([1, 2, 3])
    expect(out).not.toBe(input)
  })
})
