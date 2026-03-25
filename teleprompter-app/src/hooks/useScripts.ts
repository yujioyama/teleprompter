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
    setScripts(prev => [...prev, script])
    return script
  }

  function updateScript(id: string, changes: Partial<Pick<Script, 'title' | 'shots'>>): void {
    setScripts(prev =>
      prev.map(s =>
        s.id === id
          ? { ...s, ...changes, updatedAt: new Date().toISOString() }
          : s
      )
    )
  }

  function deleteScript(id: string): void {
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  function getScript(id: string): Script | undefined {
    return scripts.find(s => s.id === id)
  }

  return { scripts, createScript, updateScript, deleteScript, getScript }
}
