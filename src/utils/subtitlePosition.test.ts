import { describe, it, expect } from 'vitest'
import { subtitleY } from './subtitlePosition'

describe('subtitleY', () => {
  it('places top position near the top of the frame', () => {
    expect(subtitleY('top', 1920, 200)).toBe(154) // round(1920 * 0.08)
  })

  it('centers the overlay vertically for center position', () => {
    expect(subtitleY('center', 1920, 200)).toBe(860) // round((1920 - 200) / 2)
  })

  it('places bottom position near the bottom, above the overlay height', () => {
    expect(subtitleY('bottom', 1920, 200)).toBe(1298) // round(1920 * 0.78 - 200)
  })

  it('scales with a different video height', () => {
    expect(subtitleY('top', 1000, 100)).toBe(80)
  })
})
