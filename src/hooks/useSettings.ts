import { useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import { SUBTITLE_POSITION_BOTTOM } from '../utils/subtitlePosition'

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
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
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
