import { describe, it, expect } from 'vitest'
import { durationsMatch } from './finalAudio'

describe('durationsMatch', () => {
  it('accepts the few ms two encodes of the same cut can differ by', () => {
    expect(durationsMatch(12.0, 12.0)).toBe(true)
    expect(durationsMatch(12.03, 12.0)).toBe(true)
    expect(durationsMatch(11.96, 12.0)).toBe(true)
  })

  it('rejects audio built for a differently cut video', () => {
    expect(durationsMatch(12.2, 12.0)).toBe(false)
    expect(durationsMatch(11.0, 12.0)).toBe(false)
  })
})
