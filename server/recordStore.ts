import type { VideoRecord } from '../shared/videoRecord.js'
import { redisFromEnv, type RedisLike } from './redis.js'

const PREFIX = 'record:'
/** Long enough to outlast saving, posting and the Saturday that reads the numbers. */
export const RECORD_TTL_SECONDS = 120 * 24 * 60 * 60

export interface RecordStore {
  /** Replaces the script's earlier record: the last save is what gets posted. */
  put(record: VideoRecord): Promise<void>
  /** Newest save first; with `since` (ISO date), only those saved from then on. */
  list(since?: string): Promise<VideoRecord[]>
}

export function createRecordStore(redis: RedisLike): RecordStore {
  return {
    async put(record) {
      await redis.set(PREFIX + record.scriptId, record, { ex: RECORD_TTL_SECONDS })
    },

    // A record per script, a few a week: listing by SCAN is fine, as for the inbox.
    async list(since) {
      const keys: string[] = []
      let cursor: string | number = 0
      do {
        const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 100 })
        keys.push(...batch)
        cursor = next
      } while (String(cursor) !== '0')
      if (keys.length === 0) return []
      const records = await redis.mget<(VideoRecord | null)[]>(...new Set(keys))
      return records
        .filter((record): record is VideoRecord => record !== null && (!since || record.savedAt >= since))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    },
  }
}

export function recordStoreFromEnv(): RecordStore {
  return createRecordStore(redisFromEnv())
}
