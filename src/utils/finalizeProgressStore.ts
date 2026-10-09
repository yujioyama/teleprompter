import type { SubtitleCue } from './subtitleCues'
import type { SubtitlePosition } from './subtitlePosition'

// A database of its own, for the same reason as shotAnalysisStore's: adding
// a store to an existing database means a version upgrade, which an older
// copy of the app left open in the background blocks.
const DB_NAME = 'teleprompter-finalize-progress'
const DB_VERSION = 1
const STORE_NAME = 'finalizeProgress'

/** A cut the user set by hand on one take. */
export interface SavedTrim {
  /** The take it applies to (StoredShotVideo.updatedAt); a retake drops it. */
  videoUpdatedAt: string
  start: number
  end: number
}

export interface SavedCombinedClip {
  shotId: string
  videoUpdatedAt: string
  start: number
  end: number
}

/** The 結合 result, with the takes and cuts it was made from. */
export interface SavedCombined {
  blob: Blob
  clips: SavedCombinedClip[]
}

/**
 * The subtitle work on one 結合: the cues as edited and translated, the
 * paste box and the position. Transcribing and translating are the slow,
 * hand-made part, and Whisper is what most often runs an iPhone out of
 * memory and reloads the page.
 */
export interface SavedSubtitles {
  /** combinedClipsSignature() of the 結合 they were made on. */
  combinedClips: string
  cues: SubtitleCue[]
  pasteText: string
  position: SubtitlePosition
  source: 'script' | 'speech'
  /** The hook headline; missing in records saved before it existed. */
  hookHeadline?: string
}

/**
 * Where the finalize page was left, so going away — or iOS reloading the
 * page for memory — doesn't throw away the cuts, the 結合 and its subtitles.
 */
export interface FinalizeProgress {
  /** Only the shots cut by hand; the rest reopen at their detected cut. */
  trims: Record<string, SavedTrim>
  combined: SavedCombined | null
  subtitles: SavedSubtitles | null
}

interface StoredFinalizeProgress extends FinalizeProgress {
  scriptId: string
}

const EMPTY: FinalizeProgress = { trims: {}, combined: null, subtitles: null }

/** Open the database, run `body` in one transaction, and close it again. */
function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE_NAME, { keyPath: 'scriptId' })
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

export function loadFinalizeProgress(scriptId: string): Promise<FinalizeProgress> {
  return withStore('readonly', (store, done) => {
    const req = store.get(scriptId)
    req.onsuccess = () => {
      const record = req.result as StoredFinalizeProgress | undefined
      // Saved before subtitles were kept, a record has none.
      done(record ? { trims: record.trims, combined: record.combined, subtitles: record.subtitles ?? null } : EMPTY)
    }
  })
}

/** Replace one part of the script's progress, keeping the other. */
export function updateFinalizeProgress(scriptId: string, changes: Partial<FinalizeProgress>): Promise<void> {
  return withStore('readwrite', store => {
    const req = store.get(scriptId)
    req.onsuccess = () => {
      const existing = (req.result as StoredFinalizeProgress | undefined) ?? EMPTY
      const record: StoredFinalizeProgress = {
        trims: existing.trims,
        combined: existing.combined,
        subtitles: existing.subtitles ?? null,
        ...changes,
        scriptId,
      }
      store.put(record)
    }
  })
}

export function clearFinalizeProgress(scriptId: string): Promise<void> {
  return withStore('readwrite', store => {
    store.delete(scriptId)
  })
}

/**
 * The saved 結合 if it was made from exactly these takes, in this order —
 * `takes` lists [shotId, StoredShotVideo.updatedAt] of every shot that has
 * a video. A retake, or a shot added, removed or merged since, means the
 * video no longer matches the script and has to be combined again.
 */
export function combinedForTakes(
  combined: SavedCombined | null,
  takes: [shotId: string, videoUpdatedAt: string][],
): SavedCombined | null {
  if (!combined || combined.clips.length !== takes.length) return null
  const matches = combined.clips.every(
    (clip, i) => clip.shotId === takes[i][0] && clip.videoUpdatedAt === takes[i][1],
  )
  return matches ? combined : null
}

/** Identifies a 結合 by the takes and cuts it was made from. */
export function combinedClipsSignature(clips: SavedCombinedClip[]): string {
  return clips.map(c => `${c.shotId}:${c.videoUpdatedAt}:${c.start}:${c.end}`).join('|')
}
