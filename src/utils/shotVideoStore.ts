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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('byScript', 'scriptId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveShotVideo(scriptId: string, shotId: string, blob: Blob): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({
      key: makeKey(scriptId, shotId),
      scriptId,
      shotId,
      blob,
      updatedAt: new Date().toISOString(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getShotVideo(scriptId: string, shotId: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(makeKey(scriptId, shotId))
    req.onsuccess = () => resolve(req.result ? (req.result as StoredShotVideo).blob : null)
    req.onerror = () => reject(req.error)
  })
}

export async function listShotVideos(scriptId: string): Promise<StoredShotVideo[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('byScript')
    const req = index.getAll(scriptId)
    req.onsuccess = () => resolve(req.result as StoredShotVideo[])
    req.onerror = () => reject(req.error)
  })
}

export async function deleteShotVideo(scriptId: string, shotId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(makeKey(scriptId, shotId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearShotVideos(scriptId: string): Promise<void> {
  const videos = await listShotVideos(scriptId)
  await Promise.all(videos.map(v => deleteShotVideo(v.scriptId, v.shotId)))
}
