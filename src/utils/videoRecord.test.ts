import { describe, expect, it } from 'vitest'
import { buildVideoRecord, type BurnInputs } from './videoRecord'
import type { HookOptions } from './subtitleHook'
import type { Script } from '../types'

const SCRIPT: Script = {
  id: 'script-1',
  title: 'Vaseline',
  shots: [
    { id: 'a', text: 'I put *Vaseline*🧴 on my eyebrows every night.' },
    { id: 'b', text: 'My friend asked about the mirror🪞.' },
    { id: 'c', text: 'Nobody noticed.' },
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const HOOK: HookOptions = {
  style: true,
  position: 22.5,
  punchIn: { zoom: 1.25, direction: 'out', at: 0.4, duration: 1.2 },
  sticker: 'right',
  stickerMotion: 'random',
  stickerRoute: 0,
  fairies: true,
}

const BURN: BurnInputs = {
  hook: HOOK,
  position: 72,
  durations: [3, 3, 3],
  cues: [
    { id: '1', start: 0, end: 3, en: 'I put *Vaseline*🧴 on my eyebrows every night.', ja: 'ワセリン' },
    { id: '2', start: 3, end: 6, en: 'My friend asked about the mirror🪞.', ja: '鏡' },
    { id: '3', start: 6, end: 9, en: 'Nobody noticed.', ja: '誰も' },
  ],
}

const TRIM = { firstStart: 0.05, start: 0.1, end: 0.2, lastEnd: 0.1, pauseShots: 1 }

function build(changes: Partial<Parameters<typeof buildVideoRecord>[0]> = {}) {
  return buildVideoRecord({
    script: SCRIPT,
    savedAt: '2026-10-16T09:00:00.000Z',
    durationSec: 9,
    shotCount: 3,
    burn: BURN,
    mix: { trackId: 'lofi-tokyo', title: 'Tokyo Lo-fi', volume: 0.3 },
    voicePreset: 'natural',
    trim: TRIM,
    ...changes,
  })
}

describe('buildVideoRecord', () => {
  it('records how a burned, mixed video was made', () => {
    expect(build()).toEqual({
      scriptId: 'script-1',
      title: 'Vaseline',
      hookLine: 'I put Vaseline on my eyebrows every night.',
      savedAt: '2026-10-16T09:00:00.000Z',
      durationSec: 9,
      shotCount: 3,
      effects: {
        hookStyle: true,
        hookPosition: 22.5,
        zoom: { scale: 1.25, direction: 'out', at: 0.4, duration: 1.2 },
        sticker: { emoji: '🧴', placement: 'right', motion: 'random' },
        fairies: { enabled: true, cameoEmojis: ['🪞'], finale: true },
        subtitles: { burned: true, japanese: true },
        bgm: { trackId: 'lofi-tokyo', title: 'Tokyo Lo-fi', volume: 0.3 },
        voicePreset: 'natural',
        trim: TRIM,
        midZoom: true,
      },
    })
  })

  it('records no mid-video zoom with the setting off or without a burn', () => {
    expect(build({ burn: { ...BURN, hook: { ...HOOK, midZoom: false } } }).effects.midZoom).toBe(false)
    expect(build({ burn: null }).effects.midZoom).toBe(false)
  })

  it('takes the look from the burn that was used, whatever the settings are now', () => {
    const effects = build({ burn: { ...BURN, hook: { ...HOOK, punchIn: null, sticker: 'off', fairies: false } } }).effects
    expect(effects.zoom).toBeNull()
    expect(effects.sticker).toBeNull()
    expect(effects.fairies).toEqual({ enabled: false, cameoEmojis: [], finale: false })
  })

  it('records no opening effects for a video saved without burning subtitles', () => {
    const effects = build({ burn: null, mix: null }).effects
    expect(effects).toMatchObject({
      hookStyle: false,
      zoom: null,
      sticker: null,
      fairies: { enabled: false, cameoEmojis: [], finale: false },
      subtitles: { burned: false, japanese: false },
      bgm: null,
    })
  })

  it('passes on unknown cuts as unknown', () => {
    expect(build({ trim: null }).effects.trim).toBeNull()
  })
})
