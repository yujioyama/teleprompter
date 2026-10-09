import { Redis } from '@upstash/redis'
import type { InboxItem } from '../shared/inbox.js'

const PREFIX = 'inbox:'
/** Unclaimed items disappear after 30 days. */
export const INBOX_TTL_SECONDS = 30 * 24 * 60 * 60

export type RedisLike = Pick<Redis, 'set' | 'mget' | 'scan' | 'del'>

export interface InboxStore {
  add(input: { title: string; body: string; caption: string }): Promise<InboxItem>
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
  return {
    async add({ title, body, caption }) {
      const item: InboxItem = { id: newId(), title, body, caption, createdAt: now().toISOString() }
      await redis.set(PREFIX + item.id, item, { ex: INBOX_TTL_SECONDS })
      return item
    },

    async list() {
      const keys: string[] = []
      let cursor: string | number = 0
      do {
        const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 100 })
        keys.push(...batch)
        cursor = next
      } while (String(cursor) !== '0')
      if (keys.length === 0) return []
      const items = await redis.mget<(InboxItem | null)[]>(...keys)
      return items
        .filter((item): item is InboxItem => item !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async remove(id) {
      await redis.del(PREFIX + id)
    },
  }
}

/** The store for the Upstash database connected to the Vercel project. */
export function inboxStoreFromEnv(): InboxStore {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Upstash Redis is not configured: set KV_REST_API_URL and KV_REST_API_TOKEN ' +
        '(connect the Upstash for Redis integration to the Vercel project).',
    )
  }
  return createInboxStore(new Redis({ url, token }))
}
