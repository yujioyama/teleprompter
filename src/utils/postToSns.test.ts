import { describe, expect, it } from 'vitest'
import { coverOffsetMs, nextSlot, postTimeLabel } from './postToSns'

describe('nextSlot', () => {
  it('is today when the hour is still ahead, tomorrow when it has passed', () => {
    const morning = new Date(2026, 10, 7, 8, 30)
    expect(nextSlot(12, morning)).toEqual(new Date(2026, 10, 7, 12, 0))
    const evening = new Date(2026, 10, 7, 20, 0)
    expect(nextSlot(20, evening)).toEqual(new Date(2026, 10, 8, 20, 0))
    expect(nextSlot(12, evening)).toEqual(new Date(2026, 10, 8, 12, 0))
  })
})

describe('postTimeLabel', () => {
  it('says today or tomorrow', () => {
    const afternoon = new Date(2026, 10, 7, 13, 0)
    expect(postTimeLabel('now', afternoon)).toBe('今すぐ')
    expect(postTimeLabel(12, afternoon)).toBe('明日 12:00')
    expect(postTimeLabel(20, afternoon)).toBe('今日 20:00')
  })
})

describe('coverOffsetMs', () => {
  it('points at the cover frames, or leaves the default', () => {
    expect(coverOffsetMs('first', 1, 20)).toBe(0)
    expect(coverOffsetMs('last', 2, 20)).toBe(19967)
    expect(coverOffsetMs('last', 1, 0)).toBeUndefined()
    expect(coverOffsetMs('none', 1, 20)).toBeUndefined()
  })
})
