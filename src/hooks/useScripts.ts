import { useState } from 'react'
import { Script, Shot } from '../types'
import { clearShotVideos } from '../utils/shotVideoStore'
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

  function createScript(title: string, shots: Shot[], caption?: string): Script {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId(),
      title,
      shots,
      ...(caption ? { caption } : {}),
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

  function updateScript(id: string, changes: Partial<Pick<Script, 'title' | 'shots' | 'caption'>>): void {
    const updated = scripts.map(s =>
      s.id === id
        ? { ...s, ...changes, updatedAt: new Date().toISOString() }
        : s
    )
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
