import { useState, useEffect } from 'react'
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

  useEffect(() => {
    saveToStorage(scripts)
  }, [scripts])

  function createScript(title: string, shots: Shot[]): Script {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId(),
      title,
      shots,
      createdAt: now,
      updatedAt: now,
    }
    // Save to localStorage synchronously inside the updater so the data is
    // persisted before navigate() fires (useEffect runs too late on unmount).
    setScripts(prev => {
      const updated = [...prev, script]
      saveToStorage(updated)
      return updated
    })
    return script
  }

  function updateScript(id: string, changes: Partial<Pick<Script, 'title' | 'shots'>>): void {
    setScripts(prev => {
      const updated = prev.map(s =>
        s.id === id
          ? { ...s, ...changes, updatedAt: new Date().toISOString() }
          : s
      )
      saveToStorage(updated)
      return updated
    })
  }

  function deleteScript(id: string): void {
    setScripts(prev => {
      const updated = prev.filter(s => s.id !== id)
      saveToStorage(updated)
      return updated
    })
  }

  function getScript(id: string): Script | undefined {
    return scripts.find(s => s.id === id)
  }

  return { scripts, createScript, updateScript, deleteScript, getScript }
}
