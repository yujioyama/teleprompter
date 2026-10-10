import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings, defaultBgmTrack } from './useSettings'
import { SUBTITLE_POSITION_BOTTOM, SUBTITLE_POSITION_CENTER, SUBTITLE_POSITION_TOP } from '../utils/subtitlePosition'

const DEFAULTS = {
  trimEnabled: true,
  trimPaddingStart: 0.3,
  trimPaddingEnd: 0.4,
  normalizeAudio: true,
  defaultBgmId: 'lofi-tokyo',
  bgmVolume: 0.3,
  subtitlePosition: SUBTITLE_POSITION_BOTTOM,
  hookStyleEnabled: true,
  hookPosition: SUBTITLE_POSITION_TOP,
  punchInEnabled: true,
  punchInZoom: 1.25,
  punchInDirection: 'out',
  punchInAt: 0.4,
  impactEnabled: true,
  impactStrength: 'medium',
  firstShotPaddingStart: 0.05,
  inboxKey: '',
}

beforeEach(() => {
  localStorage.clear()
})

describe('useSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual(DEFAULTS)
  })

  it('updates trimEnabled', () => {
    const { result } = renderHook(() => useSettings())
    act(() => {
      result.current[1]({ trimEnabled: false })
    })
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPaddingStart).toBe(0.3) // unchanged
    expect(result.current[0].trimPaddingEnd).toBe(0.4) // unchanged
  })

  it('updates trimPaddingStart', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingStart: 1.2 }) })
    expect(result.current[0].trimPaddingStart).toBe(1.2)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('updates trimPaddingEnd', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingEnd: 1.5 }) })
    expect(result.current[0].trimPaddingEnd).toBe(1.5)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ trimPaddingEnd: 1.0 }) })
    const raw = localStorage.getItem('teleprompter_settings')
    expect(JSON.parse(raw!).trimPaddingEnd).toBe(1.0)
  })

  it('loads persisted settings on mount', () => {
    localStorage.setItem(
      'teleprompter_settings',
      JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2, normalizeAudio: false }),
    )
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual({ ...DEFAULTS, trimEnabled: false, trimPaddingEnd: 1.2, normalizeAudio: false })
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('teleprompter_settings', 'not-json')
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toEqual(DEFAULTS)
  })

  it('uses defaults for new fields when loading old-format data', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false, trimPadding: 1.0 }))
    const { result } = renderHook(() => useSettings())
    // trimEnabled is preserved from old data; new fields fall back to DEFAULTS
    expect(result.current[0].trimEnabled).toBe(false)
    expect(result.current[0].trimPaddingStart).toBe(0.3)
    expect(result.current[0].trimPaddingEnd).toBe(0.4)
  })

  it('normalizeAudio defaults to true', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current[0].normalizeAudio).toBe(true)
  })

  it('updates normalizeAudio', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ normalizeAudio: false }) })
    expect(result.current[0].normalizeAudio).toBe(false)
    expect(result.current[0].trimEnabled).toBe(true) // unchanged
  })

  it('existing stored data without normalizeAudio gets default true', () => {
    localStorage.setItem(
      'teleprompter_settings',
      JSON.stringify({ trimEnabled: false, trimPaddingStart: 0.3, trimPaddingEnd: 1.2 }),
    )
    const { result } = renderHook(() => useSettings())
    expect(result.current[0].normalizeAudio).toBe(true)
    expect(result.current[0].trimEnabled).toBe(false) // old value preserved
  })

  it('stores the usual BGM, its volume and the subtitle position', () => {
    const { result } = renderHook(() => useSettings())
    act(() => { result.current[1]({ defaultBgmId: null }) })
    act(() => { result.current[1]({ bgmVolume: 0.55 }) })
    act(() => { result.current[1]({ subtitlePosition: 64 }) })
    expect(result.current[0]).toMatchObject({ defaultBgmId: null, bgmVolume: 0.55, subtitlePosition: 64 })
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!)).toMatchObject({
      defaultBgmId: null,
      bgmVolume: 0.55,
      subtitlePosition: 64,
    })
  })

  it('gives stored settings from before these keys their defaults', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({
      defaultBgmId: 'lofi-tokyo',
      bgmVolume: 0.3,
      subtitlePosition: SUBTITLE_POSITION_BOTTOM,
    })
  })

  it('stores the hook settings, defaulting older stored settings to them', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({ hookStyleEnabled: true, hookPosition: SUBTITLE_POSITION_TOP })
    act(() => { result.current[1]({ hookStyleEnabled: false, hookPosition: 30 }) })
    expect(JSON.parse(localStorage.getItem('teleprompter_settings')!)).toMatchObject({
      hookStyleEnabled: false,
      hookPosition: 30,
    })
  })

  it('moves a hook position left at the old center default up to the top, once', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ hookPosition: SUBTITLE_POSITION_CENTER }))
    expect(renderHook(() => useSettings()).result.current[0].hookPosition).toBe(SUBTITLE_POSITION_TOP)
  })

  it('moves positions left at the old top preset down to the new one, below the SNS header', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ hookPosition: 13.75, subtitlePosition: 13.75, punchInZoom: 1.25 }))
    expect(renderHook(() => useSettings()).result.current[0]).toMatchObject({
      hookPosition: SUBTITLE_POSITION_TOP,
      subtitlePosition: SUBTITLE_POSITION_TOP,
    })
  })

  it('keeps a hook position the user moved, and the center once saved in the new shape', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ hookPosition: 40 }))
    expect(renderHook(() => useSettings()).result.current[0].hookPosition).toBe(40)
    localStorage.setItem('teleprompter_settings', JSON.stringify({ hookPosition: SUBTITLE_POSITION_CENTER, punchInZoom: 1.25 }))
    expect(renderHook(() => useSettings()).result.current[0].hookPosition).toBe(SUBTITLE_POSITION_CENTER)
  })

  it('drops the removed hook headline setting from stored settings', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ hookHeadlineEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).not.toHaveProperty('hookHeadlineEnabled')
  })
})

describe('defaultBgmTrack', () => {
  it('resolves the usual BGM to its track', () => {
    expect(defaultBgmTrack({ defaultBgmId: 'lofi-tokyo' })?.title).toBe('Tokyo Lofi')
  })

  it('treats none, or a track that no longer exists, as no BGM', () => {
    expect(defaultBgmTrack({ defaultBgmId: null })).toBeNull()
    expect(defaultBgmTrack({ defaultBgmId: 'removed-track' })).toBeNull()
  })

  it('gives older stored settings the punch-in and first-shot lead-in defaults', () => {
    localStorage.setItem('teleprompter_settings', JSON.stringify({ trimEnabled: false }))
    const { result } = renderHook(() => useSettings())
    expect(result.current[0]).toMatchObject({
          punchInEnabled: true,
      firstShotPaddingStart: 0.05,
    })
  })
})
