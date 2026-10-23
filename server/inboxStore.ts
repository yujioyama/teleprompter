import type { InboxItem } from '../shared/inbox.js'
import { redisFromEnv, type RedisLike } from './redis.js'

const PREFIX = 'inbox:'
/** Unclaimed items disappear after 30 days. */
export const INBOX_TTL_SECONDS = 30 * 24 * 60 * 60

export interface InboxStore {
  /**
   * Waiting items with the same title are older versions of this script
   * (Claude resent it after a fix), so they are replaced: `replaced` counts them.
   */
  add(input: { title: string; body: string; caption: string }): Promise<{ item: InboxItem; replaced: number }>
  /** Newest first. */
  list(): Promise<InboxItem[]>
  /** Succeeds when the item is already gone. */
  remove(id: string): Promise<void>
}

// One key per item, so each expires on its own. The inbox only ever holds
// a handful of items, so listing by SCAN is fine.
export function createInboxStore(
  redis: RedisLike,
  now: () => Date = () => new Date(),
  newId: () => string = () => crypto.randomUUID(),
): InboxStore {
  async function list(): Promise<InboxItem[]> {
    const keys: string[] = []
    let cursor: string | number = 0
    do {
      const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 100 })
      keys.push(...batch)
      cursor = next
    } while (String(cursor) !== '0')
    if (keys.length === 0) return []
    const items = await redis.mget<(InboxItem | null)[]>(...new Set(keys))
    return items
      .filter((item): item is InboxItem => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return {
    async add({ title, body, caption }) {
      const stale = (await list()).filter(old => old.title === title)
      const item: InboxItem = { id: newId(), title, body, caption, createdAt: now().toISOString() }
      // The new version is saved before the old ones go, so a failure in
      // between leaves a duplicate rather than losing the script.
      await redis.set(PREFIX + item.id, item, { ex: INBOX_TTL_SECONDS })
      if (stale.length > 0) await redis.del(...stale.map(old => PREFIX + old.id))
      return { item, replaced: stale.length }
    },

    list,

    async remove(id) {
      await redis.del(PREFIX + id)
    },
  }
}

/** The store for the Upstash database connected to the Vercel project. */
export function inboxStoreFromEnv(): InboxStore {
  return createInboxStore(redisFromEnv())
}
