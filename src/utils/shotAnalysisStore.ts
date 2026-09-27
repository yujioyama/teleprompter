import type { SpeechRegion } from './detectSpeechBounds'

// A database of its own rather than a new store in shotVideoStore's: adding
// a store means a version upgrade, which waits on every connection still
// open at the old version — and an older copy of the app left open (e.g. the
// home-screen app in the background) never closes its connections.
const DB_NAME = 'teleprompter-shot-analyses'
const DB_VERSION = 1
const STORE_NAME = 'shotAnalyses'

// Bump when the analysis itself changes, so older results are redone.
const ANALYSIS_VERSION = 1

/**
 * What the finalize step learned about a take: its duration and where its
 * speech is. Both take decoding the video to find, so they're kept per take
 * and reused on later visits instead of redone for every shot.
 */
export interface ShotAnalysis {
  duration?: number
  /** Undefined until detection has run; null when it found no speech. */
  speech?: SpeechRegion | null
}

interface StoredShotAnalysis extends ShotAnalysis {
  key: string
  scriptId: string
  shotId: string
  /** The take it describes (StoredShotVideo.updatedAt); a retake invalidates it. */
  videoUpdatedAt: string
  version: number
}

function makeKey(scriptId: string, shotId: string): string {
  return `${scriptId}::${shotId}`
}

/** Open the database, run `body` in one transaction, and close it again. */
function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('byScript', 'scriptId', { unique: false })
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

/**
 * The analysis of each shot's current take, keyed by shotId. `takes` maps
 * shotId to that take's StoredShotVideo.updatedAt; analyses of other takes
 * are left out.
 */
export function listShotAnalyses(scriptId: string, takes: Map<string, string>): Promise<Map<string, ShotAnalysis>> {
  return withStore('readonly', (store, done) => {
    const req = store.index('byScript').getAll(scriptId)
    req.onsuccess = () => {
      const byShot = new Map<string, ShotAnalysis>()
      for (const record of req.result as StoredShotAnalysis[]) {
        if (record.version !== ANALYSIS_VERSION || takes.get(record.shotId) !== record.videoUpdatedAt) continue
        byShot.set(record.shotId, { duration: record.duration, speech: record.speech })
      }
      done(byShot)
    }
  })
}

/** Merge `changes` into this take's analysis, replacing any of an older take. */
export function updateShotAnalysis(
  scriptId: string,
  shotId: string,
  videoUpdatedAt: string,
  changes: ShotAnalysis,
): Promise<void> {
  return withStore('readwrite', store => {
    const key = makeKey(scriptId, shotId)
    const req = store.get(key)
    req.onsuccess = () => {
      const existing = req.result as StoredShotAnalysis | undefined
      const current: ShotAnalysis =
        existing && existing.videoUpdatedAt === videoUpdatedAt && existing.version === ANALYSIS_VERSION
          ? { duration: existing.duration, speech: existing.speech }
          : {}
      const record: StoredShotAnalysis = {
        ...current,
        ...changes,
        key,
        scriptId,
        shotId,
        videoUpdatedAt,
        version: ANALYSIS_VERSION,
      }
      store.put(record)
    }
  })
}

export function clearShotAnalyses(scriptId: string): Promise<void> {
  return withStore('readwrite', store => {
    const req = store.index('byScript').openKeyCursor(scriptId)
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      cursor.continue()
    }
  })
}
