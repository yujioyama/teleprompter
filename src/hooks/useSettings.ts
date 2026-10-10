import { useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import {
  LEGACY_SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_BOTTOM,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_TOP,
} from '../utils/subtitlePosition'
import type { ImpactStrength, PunchInZoom } from '../utils/subtitleHook'

export interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean
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
  /** Slowly zoom the first shot's picture in (ズームイン). */
  punchInEnabled: boolean
  /** How far it has zoomed in by the first shot's end. */
  punchInZoom: PunchInZoom
  /** Seconds into the first shot when the zoom starts. */
  punchInAt: number
  /** A short zoom blur and RGB split as the zoom starts. */
  impactEnabled: boolean
  impactStrength: ImpactStrength
  /** Seconds of silence auto-trim keeps before the first shot's speech. */
  firstShotPaddingStart: number
  /** Shared secret for the Claude inbox (INBOX_SECRET); '' = not set up. */
  inboxKey: string
}

const STORAGE_KEY = 'teleprompter_settings'
const DEFAULTS: AppSettings = {
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
  punchInAt: 0.4,
  impactEnabled: true,
  impactStrength: 'medium',
  firstShotPaddingStart: 0.05,
  inboxKey: '',
}

/** Stored settings brought up to date with the current shape. */
export function migrateSettings(stored: Record<string, unknown>): Partial<AppSettings> {
  const next = { ...stored }
  // The hook headline was removed (2026-10-10).
  delete next.hookHeadlineEnabled
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
