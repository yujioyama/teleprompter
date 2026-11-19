// 挿入カードの声: the narrator's voice recorded for a card, kept on this
// device only. A database of its own, for the reason given in shotAnalysisStore.
const DB_NAME = 'teleprompter-card-voices'
const DB_VERSION = 1
const STORE_NAME = 'voices'

interface StoredCardVoice {
  /** `${scriptId}/${cardId}` */
  id: string
  scriptId: string
  cardId: string
  blob: Blob
  savedAt: string
}

const keyOf = (scriptId: string, cardId: string) => `${scriptId}/${cardId}`

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

export function saveCardVoice(scriptId: string, cardId: string, blob: Blob): Promise<void> {
  const entry: StoredCardVoice = { id: keyOf(scriptId, cardId), scriptId, cardId, blob, savedAt: new Date().toISOString() }
  return withStore('readwrite', store => {
    store.put(entry)
  })
}

export function getCardVoice(scriptId: string, cardId: string): Promise<{ blob: Blob; savedAt: string } | null> {
  return withStore('readonly', (store, done) => {
    done(null)
    const req = store.get(keyOf(scriptId, cardId))
    req.onsuccess = () => {
      const found = req.result as StoredCardVoice | undefined
      if (found) done({ blob: found.blob, savedAt: found.savedAt })
    }
  })
}

/** Delete the voices of scripts or cards that are gone. */
export function pruneCardVoices(scripts: { id: string; cards?: { id: string }[] }[]): Promise<void> {
  const keep = new Set(scripts.flatMap(script => (script.cards ?? []).map(card => keyOf(script.id, card.id))))
  return withStore('readwrite', store => {
    const req = store.getAllKeys()
    req.onsuccess = () => {
      for (const key of req.result) if (!keep.has(String(key))) store.delete(key)
    }
  })
}
