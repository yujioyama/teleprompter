/**
 * Ask the browser not to evict this origin's storage when space runs low.
 * Every take lives only in IndexedDB (see shotVideoStore) — and is large —
 * so without this Safari may clear them along with the rest of the site's
 * data. Resolves to whether storage ended up persistent; never throws.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage
    if (!storage?.persist) return false
    if (await storage.persisted?.()) return true
    return await storage.persist()
  } catch (err) {
    console.warn('Could not request persistent storage', err)
    return false
  }
}
