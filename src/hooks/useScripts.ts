import { useState } from 'react'
import { Script, Shot } from '../types'

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

  function createScript(title: string, shots: Shot[]): Script {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId(),
      title,
      shots,
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

  function updateScript(id: string, changes: Partial<Pick<Script, 'title' | 'shots'>>): void {
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
  }

  function getScript(id: string): Script | undefined {
    return scripts.find(s => s.id === id)
  }

  return { scripts, createScript, updateScript, deleteScript, getScript }
}
