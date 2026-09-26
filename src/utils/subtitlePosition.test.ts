import { describe, it, expect } from 'vitest'
import {
  subtitleY,
  SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_BOTTOM,
} from './subtitlePosition'

describe('subtitleY', () => {
  it('computes the Y coordinate as a percent of video height, offset by half the overlay height', () => {
    expect(subtitleY(50, 1920, 220)).toBe(850) // round(1920 * 0.5 - 110)
  })

  it('rounds to the nearest pixel', () => {
    expect(subtitleY(10, 1000, 100)).toBe(50) // round(1000 * 0.1 - 50)
  })

  it('clamps at 0 percent to just above negative half the overlay height', () => {
    expect(subtitleY(0, 1920, 220)).toBe(-110)
  })
})

describe('preset percent constants', () => {
  // At the production reference geometry (VIDEO_HEIGHT=1920, OVERLAY_HEIGHT=220,
  // from src/utils/burnSubtitles.ts), each preset must reproduce the exact pixel
  // position the old 3-value-enum formula produced, so switching to a numeric
  // percent doesn't visually shift any existing preset.
  const REF_HEIGHT = 1920
  const REF_OVERLAY = 220

  it('top preset matches the legacy round(videoHeight * 0.08) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_TOP, REF_HEIGHT, REF_OVERLAY)).toBe(154)
  })

  it('center preset matches the legacy round((videoHeight - overlayHeight) / 2) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_CENTER, REF_HEIGHT, REF_OVERLAY)).toBe(850)
  })

  it('bottom preset matches the legacy round(videoHeight * 0.78 - overlayHeight) result', () => {
    expect(subtitleY(SUBTITLE_POSITION_BOTTOM, REF_HEIGHT, REF_OVERLAY)).toBe(1278)
  })
})
