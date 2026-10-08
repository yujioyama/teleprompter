import { clearShotAnalyses } from './shotAnalysisStore'
import { clearFinalizeProgress } from './finalizeProgressStore'

const DB_NAME = 'teleprompter-shot-videos'
const DB_VERSION = 1
const STORE_NAME = 'shotVideos'

export interface StoredShotVideo {
  scriptId: string
  shotId: string
  blob: Blob
  updatedAt: string
}

function makeKey(scriptId: string, shotId: string): string {
  return `${scriptId}::${shotId}`
}

// Both ids are UUIDs, so the first '::' is the separator.
function parseKey(key: IDBValidKey): { scriptId: string; shotId: string } {
  const text = String(key)
  const at = text.indexOf('::')
  return { scriptId: text.slice(0, at), shotId: text.slice(at + 2) }
}

/**
 * Open the database, run `body` in one transaction, and close it again —
 * a connection left open blocks any later version upgrade (see
 * shotAnalysisStore).
 */
function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('byScript', 'scriptId', { unique: false })
      }
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const conn = open.result
      let result: T
      const tx = conn.transaction(STORE_NAME, mode)
      tx.oncomplete = () => {
        conn.close()
        resolve(result)
      }
      tx.onerror = () => {
        conn.close()
        reject(tx.error)
      }
      body(tx.objectStore(STORE_NAME), value => (result = value))
    }
  })
}

export function saveShotVideo(scriptId: string, shotId: string, blob: Blob): Promise<void> {
  return withStore('readwrite', store => {
    store.put({
      key: makeKey(scriptId, shotId),
      scriptId,
      shotId,
      blob,
      updatedAt: new Date().toISOString(),
    })
  })
}

export function getShotVideo(scriptId: string, shotId: string): Promise<Blob | null> {
  return withStore('readonly', (store, done) => {
    const req = store.get(makeKey(scriptId, shotId))
    req.onsuccess = () => done(req.result ? (req.result as StoredShotVideo).blob : null)
  })
}

export function listShotVideos(scriptId: string): Promise<StoredShotVideo[]> {
  return withStore('readonly', (store, done) => {
    const req = store.index('byScript').getAll(scriptId)
    req.onsuccess = () => done(req.result as StoredShotVideo[])
  })
}

/** Which shots of every script have a video, without reading the videos. */
export function listStoredShots(): Promise<{ scriptId: string; shotId: string }[]> {
  return withStore('readonly', (store, done) => {
    const req = store.getAllKeys()
    req.onsuccess = () => done(req.result.map(parseKey))
  })
}

export function deleteShotVideo(scriptId: string, shotId: string): Promise<void> {
  return withStore('readwrite', store => {
    store.delete(makeKey(scriptId, shotId))
  })
}

/**
 * Delete the videos of shots these scripts no longer have — deleted, merged
 * away, or dropped by re-splitting the script. Only the scripts passed are
 * touched, so a script list that failed to load deletes nothing.
 */
export function pruneRemovedShotVideos(scripts: { id: string; shots: { id: string }[] }[]): Promise<void> {
  return withStore('readwrite', store => {
    for (const script of scripts) {
      const shotIds = new Set(script.shots.map(shot => shot.id))
      const req = store.index('byScript').openKeyCursor(script.id)
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        if (!shotIds.has(parseKey(cursor.primaryKey).shotId)) store.delete(cursor.primaryKey)
        cursor.continue()
      }
    }
  })
}

export async function clearShotVideos(scriptId: string): Promise<void> {
  await withStore<void>('readwrite', store => {
    const req = store.index('byScript').openKeyCursor(scriptId)
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      cursor.continue()
    }
  })
  await clearShotAnalyses(scriptId)
  await clearFinalizeProgress(scriptId)
}
