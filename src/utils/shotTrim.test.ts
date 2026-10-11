import { describe, it, expect } from 'vitest'
import { clampTrimRange, resolveShotTrimSettings } from './shotTrim'
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
    defaultBgmId: null,
    bgmVolume: 0.3,
    subtitlePosition: 72,
    hookStyleEnabled: true,
    hookPosition: 50,
    punchInEnabled: true,
    punchInZoom: 1.25,
    punchInDirection: 'in',
    punchInAt: 0.4,
    firstShotPaddingStart: 0.05,
    inboxKey: '',
  }

  it('gives the first shot its own lead-in before the speech', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '' }, GLOBAL, true)).toEqual({
      trimEnabled: true,
      trimPaddingStart: 0.05,
      trimPaddingEnd: 0.4,
    })
  })

  it('keeps the usual lead-in for the other shots', () => {
    expect(resolveShotTrimSettings({ id: 'b', text: '' }, GLOBAL).trimPaddingStart).toBe(0.3)
  })

  it('lets a shot\'s own lead-in win, first shot or not', () => {
    expect(resolveShotTrimSettings({ id: 'a', text: '', trimPaddingStart: 0.6 }, GLOBAL, true).trimPaddingStart).toBe(0.6)
  })
})
