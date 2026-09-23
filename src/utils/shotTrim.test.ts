import { describe, it, expect } from 'vitest'
import { clampTrimRange } from './shotTrim'

describe('clampTrimRange', () => {
  it('leaves a valid range untouched', () => {
    expect(clampTrimRange(1, 4, 10)).toEqual({ start: 1, end: 4 })
  })

  it('clamps a negative start to 0', () => {
    expect(clampTrimRange(-2, 4, 10)).toEqual({ start: 0, end: 4 })
  })

  it('clamps an end past the clip duration down to the duration', () => {
    expect(clampTrimRange(1, 15, 10)).toEqual({ start: 1, end: 10 })
  })

  it('pushes end forward to respect the minimum length when start moved past it', () => {
    // default minLength is 0.3s
    expect(clampTrimRange(4, 4.1, 10)).toEqual({ start: 4, end: 4.3 })
  })

  it('pulls end back to the duration if enforcing minLength would overflow it', () => {
    expect(clampTrimRange(9.9, 9.95, 10)).toEqual({ start: 9.7, end: 10 })
  })

  it('respects a custom minLength', () => {
    expect(clampTrimRange(0, 0.5, 10, 1)).toEqual({ start: 0, end: 1 })
  })
})
