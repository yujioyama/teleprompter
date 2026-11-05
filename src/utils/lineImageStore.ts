import type { StoredLineImage } from './lineImages'

// A database of its own, for the reason given in shotAnalysisStore.
const DB_NAME = 'teleprompter-line-images'
const DB_VERSION = 1
const STORE_NAME = 'images'

/** Open the database, run `body` in one transaction, and close it again. */
function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
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

export function saveLineImage(image: StoredLineImage): Promise<void> {
  return withStore('readwrite', store => {
    store.put(image)
  })
}

/** The images of `ids` this device has. */
export function getLineImages(ids: string[]): Promise<Map<string, StoredLineImage>> {
  return withStore('readonly', (store, done) => {
    const found = new Map<string, StoredLineImage>()
    done(found)
    for (const id of new Set(ids)) {
      const req = store.get(id)
      req.onsuccess = () => {
        if (req.result) found.set(id, req.result as StoredLineImage)
      }
    }
  })
}

/** Which images this device has, without reading them. */
export function listLineImageIds(): Promise<Set<string>> {
  return withStore('readonly', (store, done) => {
    const req = store.getAllKeys()
    req.onsuccess = () => done(new Set(req.result.map(String)))
  })
}

/** Delete every image not in `keep`, once nothing refers to it any more. */
export function pruneLineImages(keep: Set<string>): Promise<void> {
  return withStore('readwrite', store => {
    const req = store.getAllKeys()
    req.onsuccess = () => {
      for (const key of req.result) if (!keep.has(String(key))) store.delete(key)
    }
  })
}
