import type { Script, Shot } from '../types'

// The scripts live only in this browser's localStorage, so a backup file is
// the way to keep them through a cleared Safari or onto another device.
// Takes are not included: they're far too large, and stay in Files anyway.
const APP = 'teleprompter'
const VERSION = 1

interface Backup {
  app: typeof APP
  version: number
  exportedAt: string
  scripts: Script[]
}

export type ParsedBackup = { ok: true; scripts: Script[] } | { ok: false; error: string }

export function serializeBackup(scripts: Script[], now = new Date()): string {
  const backup: Backup = { app: APP, version: VERSION, exportedAt: now.toISOString(), scripts }
  return JSON.stringify(backup, null, 2)
}

function isOptional(value: unknown, type: 'boolean' | 'number' | 'string'): boolean {
  return value === undefined || typeof value === type
}

function isShot(value: unknown): value is Shot {
  if (typeof value !== 'object' || value === null) return false
  const shot = value as Record<string, unknown>
  return (
    typeof shot.id === 'string' &&
    typeof shot.text === 'string' &&
    isOptional(shot.trimEnabled, 'boolean') &&
    isOptional(shot.trimPaddingStart, 'number') &&
    isOptional(shot.trimPaddingEnd, 'number')
  )
}

function isScript(value: unknown): value is Script {
  if (typeof value !== 'object' || value === null) return false
  const script = value as Record<string, unknown>
  return (
    typeof script.id === 'string' &&
    typeof script.title === 'string' &&
    typeof script.createdAt === 'string' &&
    typeof script.updatedAt === 'string' &&
    isOptional(script.caption, 'string') &&
    Array.isArray(script.shots) &&
    script.shots.every(isShot)
  )
}

export function parseBackup(text: string): ParsedBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'バックアップファイルを読めませんでした。' }
  }
  const backup = data as Partial<Backup> | null
  if (typeof backup !== 'object' || backup === null || backup.app !== APP || !Array.isArray(backup.scripts)) {
    return { ok: false, error: 'このアプリのバックアップファイルではありません。' }
  }
  if (typeof backup.version !== 'number' || backup.version > VERSION) {
    return { ok: false, error: 'このバックアップは新しい形式です。アプリを最新にしてから読み込んでください。' }
  }
  if (!backup.scripts.every(isScript)) {
    return { ok: false, error: 'バックアップファイルが壊れています。' }
  }
  return { ok: true, scripts: backup.scripts }
}

export interface MergeResult {
  scripts: Script[]
  added: number
  updated: number
  unchanged: number
}

/**
 * Bring a backup's scripts onto the device without losing anything: new
 * scripts are added, and a script already here is replaced only by a newer
 * copy of it, so restoring an old backup never undoes later edits.
 */
export function mergeScripts(existing: Script[], imported: Script[]): MergeResult {
  const scripts = [...existing]
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const script of imported) {
    const index = scripts.findIndex(s => s.id === script.id)
    if (index === -1) {
      scripts.push(script)
      added++
    } else if (Date.parse(script.updatedAt) > Date.parse(scripts[index].updatedAt)) {
      scripts[index] = script
      updated++
    } else {
      unchanged++
    }
  }
  return { scripts, added, updated, unchanged }
}
