import { useState } from 'react'

export interface AppSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
}

const STORAGE_KEY = 'teleprompter_settings'
const DEFAULTS: AppSettings = { trimEnabled: true, trimPaddingStart: 0.5, trimPaddingEnd: 0.8 }

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
