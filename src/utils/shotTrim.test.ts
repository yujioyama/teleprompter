import { describe, it, expect } from 'vitest'
import { autoTrimOf, clampTrimRange, LAST_SHOT_MIN_LENGTH, PAUSE_PADDING_END, resolveShotTrimSettings } from './shotTrim'
import type { AppSettings } from '../hooks/useSettings'

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

describe('resolveShotTrimSettings', () => {
  const GLOBAL: AppSettings = {
    trimEnabled: true,
    trimPaddingStart: 0.3,
    trimPaddingEnd: 0.4,
    normalizeAudio: true,
    voicePreset: 'natural',
    defaultBgmId: null,
    bgmVolume: 0.3,
    bgmStopBeforePunchline: true,
    subtitlePosition: 72,
    hookStyleEnabled: true,
    hookPosition: 50,
    punchInEnabled: true,
    punchInZoom: 1.25,
    punchInDirection: 'in',
    punchInAt: 0.4,
    punchInDuration: null,
    stickerPlacement: 'chest',
    stickerMotion: 'random',
    stickerRoute: 0,
    fairyEnabled: true,
    midZoomEnabled: true,
    firstShotPaddingStart: 0.05,
    lastShotPaddingEnd: 0.1,
    inboxKey: '',
  }

  it('gives the first shot its own lead-in before the speech', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '' }, GLOBAL, true)).toEqual({
      trimEnabled: true,
      trimPaddingStart: 0.05,
      trimPaddingEnd: 0.4,
      minLength: 0,
    })
  })

  it('keeps the usual lead-in for the other shots', () => {
    expect(resolveShotTrimSettings({ id: 'b', text: '' }, GLOBAL).trimPaddingStart).toBe(0.3)
  })

  it('lets a shot\'s own lead-in win, first shot or not', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '', trimPaddingStart: 0.6 }, GLOBAL, true).trimPaddingStart).toBe(0.6)
  })

  it('ends the last shot right after the speech, and keeps it long enough for the finale', () => {
    expect(resolveShotTrimSettings({ id: 'z', text: '' }, GLOBAL, false, true)).toEqual({
      trimEnabled: true,
      trimPaddingStart: 0.3,
      trimPaddingEnd: 0.1,
      minLength: LAST_SHOT_MIN_LENGTH,
    })
  })

  it('gives a one-shot video both the first lead-in and the last ending', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '' }, GLOBAL, true, true)).toMatchObject({
      trimPaddingStart: 0.05,
      trimPaddingEnd: 0.1,
    })
  })

  it('keeps a pause after a shot marked 間を残す, over every other end padding', () => {
    const pause = { id: 'p', text: '', keepPause: true }
    expect(resolveShotTrimSettings(pause, GLOBAL).trimPaddingEnd).toBe(PAUSE_PADDING_END)
    expect(resolveShotTrimSettings(pause, GLOBAL, false, true).trimPaddingEnd).toBe(PAUSE_PADDING_END)
    expect(resolveShotTrimSettings({ ...pause, trimPaddingEnd: 0.9 }, GLOBAL).trimPaddingEnd).toBe(PAUSE_PADDING_END)
  })
})

describe('autoTrimOf', () => {
  const region = { speechStart: 1, speechEnd: 1.4, floor: 0, ceiling: 5, duration: 6 }
  const trim = { trimEnabled: true, trimPaddingStart: 0.1, trimPaddingEnd: 0.1, minLength: 0 }

  it('cuts around the speech with the padding', () => {
    const bounds = autoTrimOf(region, trim)!
    expect(bounds.start).toBeCloseTo(0.9)
    expect(bounds.end).toBeCloseTo(1.5)
  })

  it('lengthens a short last shot to its minimum', () => {
    const bounds = autoTrimOf(region, { ...trim, minLength: 1.2 })!
    expect(bounds.start).toBeCloseTo(0.9)
    expect(bounds.end).toBeCloseTo(2.1)
  })

  it('never lengthens into the sound after the speech (the stop tap)', () => {
    const bounds = autoTrimOf({ ...region, ceiling: 1.8 }, { ...trim, minLength: 1.2 })!
    expect(bounds.end).toBeCloseTo(1.8)
  })

  it('leaves a shot with nothing worth trimming whole', () => {
    expect(autoTrimOf({ speechStart: 0.05, speechEnd: 5.95, floor: 0, ceiling: 6, duration: 6 }, trim)).toBeNull()
  })
})
