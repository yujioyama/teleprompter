import { describe, it, expect } from 'vitest'
import { computeMergedText } from './mergeShots'

describe('computeMergedText', () => {
  it('puts dragged text first when dragged was above target (lower index)', () => {
    expect(computeMergedText(0, 2, 'Hello', 'World')).toBe('Hello World')
  })

  it('puts target text first when dragged was below target (higher index)', () => {
    expect(computeMergedText(3, 1, 'suffix', 'prefix')).toBe('prefix suffix')
  })

  it('uses a single half-width space as separator', () => {
    expect(computeMergedText(0, 1, 'foo', 'bar')).toBe('foo bar')
  })

  it('works when texts contain Japanese — separator is half-width space U+0020', () => {
    const result = computeMergedText(0, 1, '東京に来ました。', '今日は晴れです。')
    expect(result).toBe('東京に来ました。 今日は晴れです。')
    expect(result.charAt(8)).toBe('\u0020') // confirm separator is ASCII space
  })

  it('works when dragged is one position above target', () => {
    expect(computeMergedText(1, 2, 'A', 'B')).toBe('A B')
  })

  it('falls back to target-first when indices are equal (defensive)', () => {
    // Same-card drops are prevented upstream, but the function should not crash
    expect(computeMergedText(2, 2, 'X', 'Y')).toBe('Y X')
  })
})
