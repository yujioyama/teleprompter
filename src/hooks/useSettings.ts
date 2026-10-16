import { useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import {
  LEGACY_SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_BOTTOM,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_TOP,
} from '../utils/subtitlePosition'
import type { PunchInDuration, PunchInZoom, ZoomDirection } from '../utils/subtitleHook'
import type { StickerPlacement } from '../utils/subtitleSticker'
import type { StickerMotion } from '../utils/stickerMotion'
import type { VoicePreset } from '../utils/voicePreset'

export interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean
  /** 声の加工 applied to the voice on every video. */
  voicePreset: VoicePreset
  /** BGM added to every video without stopping on the BGM step; null = none. */
  defaultBgmId: string | null
  /** 0-1, the BGM step's volume slider. */
  bgmVolume: number
  /** 0-100, where the subtitle step starts its position. */
  subtitlePosition: number
  /** Draw the first shot's cues at the hook position, from its first frame. */
  hookStyleEnabled: boolean
  /** 0-100, where the hook cues are centered. */
  hookPosition: number
  /** Slowly zoom the first shot's picture (ズーム). */
  punchInEnabled: boolean
  /** How far in it is at its closest. */
  punchInZoom: PunchInZoom
  /** Push in, or start close and pull back (ズームアウト). */
  punchInDirection: ZoomDirection
  /** Seconds into the first shot when the zoom starts moving. */
  punchInAt: number
  /** Seconds the zoom takes once it starts; null = until the first shot ends. */
  punchInDuration: PunchInDuration
  /** Where the first line's emoji shows as a sticker. */
  stickerPlacement: StickerPlacement
  /** How the sticker travels around during the first shot (ステッカーの動き). */
  stickerMotion: StickerMotion
  /** Bumped by ルートを変える to give the sticker another route. */
  stickerRoute: number
  /** Mid-video cameos and the finale (妖精). */
  fairyEnabled: boolean
  /** Seconds of silence auto-trim keeps before the first shot's speech. */
  firstShotPaddingStart: number
  /** Seconds of silence auto-trim keeps after the last shot's speech. */
  lastShotPaddingEnd: number
  /** Shared secret for the Claude inbox (INBOX_SECRET); '' = not set up. */
  inboxKey: string
}

const STORAGE_KEY = 'teleprompter_settings'
const DEFAULTS: AppSettings = {
  trimEnabled: true,
  trimPaddingStart: 0.1,
  trimPaddingEnd: 0.2,
  normalizeAudio: true,
  voicePreset: 'natural',
  defaultBgmId: 'lofi-tokyo',
  bgmVolume: 0.3,
  subtitlePosition: SUBTITLE_POSITION_BOTTOM,
  hookStyleEnabled: true,
  hookPosition: SUBTITLE_POSITION_TOP,
  punchInEnabled: true,
  punchInZoom: 1.25,
  punchInDirection: 'out',
  punchInAt: 0.4,
  punchInDuration: 1.2,
  stickerPlacement: 'chest',
  stickerMotion: 'random',
  stickerRoute: 0,
  fairyEnabled: true,
  firstShotPaddingStart: 0.05,
  lastShotPaddingEnd: 0.1,
  inboxKey: '',
}

/** Stored settings brought up to date with the current shape. */
export function migrateSettings(stored: Record<string, unknown>): Partial<AppSettings> {
  const next = { ...stored }
  // The hook headline was removed (2026-10-10).
  delete next.hookHeadlineEnabled
  // The impact effect was removed (2026-10-11).
  delete next.impactEnabled
  delete next.impactStrength
  // Saved before the snap zoom (no punchInZoom): the hook moved from the
  // center to the top, above the face. A position the user set is kept.
  if (!('punchInZoom' in next) && next.hookPosition === SUBTITLE_POSITION_CENTER) {
    next.hookPosition = SUBTITLE_POSITION_TOP
  }
  // The top preset moved below the SNS header (2026-10-10); a position left
  // on the old one follows it.
  for (const key of ['hookPosition', 'subtitlePosition'] as const) {
    if (next[key] === LEGACY_SUBTITLE_POSITION_TOP) next[key] = SUBTITLE_POSITION_TOP
  }
  // The cuts got tighter (2026-10-16); ones left at the old defaults follow.
  // Saved since, a settings object has lastShotPaddingEnd.
  if (!('lastShotPaddingEnd' in next)) {
    if (next.trimPaddingStart === 0.3) next.trimPaddingStart = DEFAULTS.trimPaddingStart
    if (next.trimPaddingEnd === 0.4) next.trimPaddingEnd = DEFAULTS.trimPaddingEnd
  }
  return next as Partial<AppSettings>
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...migrateSettings(JSON.parse(raw)) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  function updateSettings(patch: Partial<AppSettings>) {
    const next = { ...settings, ...patch }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSettings(next)
  }

  return [settings, updateSettings]
}

/** The usual BGM's track, or null when there is none or it has since been removed. */
export function defaultBgmTrack(settings: Pick<AppSettings, 'defaultBgmId'>): MusicTrack | null {
  return MUSIC_TRACKS.find(t => t.id === settings.defaultBgmId) ?? null
}
