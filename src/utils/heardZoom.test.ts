import { describe, expect, it } from 'vitest'
import { HEARD_ZOOM_MAX, heardZoomTo, slowZoomScale } from './heardZoom'

describe('heardZoomTo', () => {
  it('moves in further on a longer line, but never too far', () => {
    expect(heardZoomTo(2)).toBeCloseTo(1.05)
    expect(heardZoomTo(10)).toBe(HEARD_ZOOM_MAX)
    expect(heardZoomTo(0)).toBe(1)
  })
})

describe('slowZoomScale', () => {
  it('starts at 1, ends at the target, and eases at both ends', () => {
    expect(slowZoomScale(0, 1.1)).toBe(1)
    expect(slowZoomScale(1, 1.1)).toBeCloseTo(1.1)
    expect(slowZoomScale(0.5, 1.1)).toBeCloseTo(1.05)
    expect(slowZoomScale(0.1, 1.1) - 1).toBeLessThan(0.1 * 0.1)
    expect(slowZoomScale(2, 1.1)).toBeCloseTo(1.1)
  })
})
