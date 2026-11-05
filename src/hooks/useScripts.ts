import { useState } from 'react'
import type { CinemaLook } from '../../shared/cinemaLook'
import { LineImage, LineJapanese, Script, Shot, type VideoType } from '../types'
import { clearShotVideos } from '../utils/shotVideoStore'
import { pruneLineImages } from '../utils/lineImageStore'
import { mergeScripts, type MergeResult } from '../utils/scriptBackup'

const STORAGE_KEY = 'teleprompter_scripts'

function generateId(): string {
  return crypto.randomUUID()
}

function loadFromStorage(): Script[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(scripts: Script[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts))
}

export function useScripts() {
  const [scripts, setScripts] = useState<Script[]>(loadFromStorage)

  function createScript(
    title: string,
    shots: Shot[],
    caption?: string,
    oneTake?: boolean,
    japanese?: LineJapanese[],
    videoType?: VideoType,
    look?: CinemaLook,
    lineImages?: LineImage[],
  ): Script {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId(),
      title,
      shots,
      ...(caption ? { caption } : {}),
      ...(oneTake ? { oneTake } : {}),
      ...(japanese?.length ? { japanese } : {}),
      ...(videoType ? { videoType } : {}),
      ...(look ? { look } : {}),
      ...(lineImages?.length ? { lineImages } : {}),
      createdAt: now,
      updatedAt: now,
    }
    // Build the updated list and save to localStorage BEFORE calling setScripts
    // (and before navigate() fires). setScripts callbacks are deferred by React,
    // so they run too late if navigate() is called immediately after createScript().
    const updated = [...scripts, script]
    saveToStorage(updated)
    setScripts(updated)
    return script
  }

  function updateScript(id: string, changes: Partial<Pick<Script, 'title' | 'shots' | 'caption' | 'oneTake' | 'videoType' | 'look' | 'lineImages'>>): void {
    const updated = scripts.map(s => {
      if (s.id !== id) return s
      const next: Script = { ...s, ...changes, updatedAt: new Date().toISOString() }
      // A cleared caption is stored as no caption, as createScript does.
      if (!next.caption) delete next.caption
      if (!next.oneTake) delete next.oneTake
      if (!next.videoType) delete next.videoType
      if (!next.look) delete next.look
      if (!next.lineImages?.length) delete next.lineImages
      return next
    })
    saveToStorage(updated)
    setScripts(updated)
  }

  function deleteScript(id: string): void {
    const updated = scripts.filter(s => s.id !== id)
    saveToStorage(updated)
    setScripts(updated)
    // Fire-and-forget: clean up orphaned IndexedDB blobs without making
    // deleteScript async.
    clearShotVideos(id).catch(err => console.error('Failed to clear stored shot videos', err))
    // Another script may use the same image; one still in the inbox is fetched again.
    pruneLineImages(new Set(updated.flatMap(s => (s.lineImages ?? []).map(image => image.imageId))))
      .catch(err => console.error('Failed to clear stored images', err))
  }

  // A backup's scripts, merged in without losing anything (see mergeScripts).
  function importScripts(imported: Script[]): Omit<MergeResult, 'scripts'> {
    const { scripts: updated, ...counts } = mergeScripts(scripts, imported)
    saveToStorage(updated)
    setScripts(updated)
    return counts
  }

  function getScript(id: string): Script | undefined {
    return scripts.find(s => s.id === id)
  }

  return { scripts, createScript, updateScript, deleteScript, getScript, importScripts }
}
