import type { RedisLike } from '../inboxStore.js'

// In-memory stand-in for the Upstash client, covering only what the inbox
// store calls. Values are cloned like Upstash's JSON round-trip would.
export function createFakeRedis() {
  const values = new Map<string, unknown>()
  const expiries = new Map<string, number>()

  const fake = {
    async set(key: string, value: unknown, opts?: { ex?: number }) {
      values.set(key, structuredClone(value))
      if (opts?.ex !== undefined) expiries.set(key, opts.ex)
      return 'OK'
    },
    async mget(...keys: string[]) {
      return keys.map(k => (values.has(k) ? structuredClone(values.get(k)) : null))
    },
    async scan(_cursor: string | number, opts?: { match?: string }) {
      const prefix = (opts?.match ?? '*').replace(/\*$/, '')
      return ['0', [...values.keys()].filter(k => k.startsWith(prefix))]
    },
    async del(...keys: string[]) {
      let n = 0
      for (const k of keys) {
        if (values.delete(k)) n++
        expiries.delete(k)
      }
      return n
    },
  }

  return { redis: fake as unknown as RedisLike, values, expiries }
}
