import { redisFromEnv, type RedisLike } from './redis.js'

const PREFIX = 'subtitles:'
/** A translation the app never picked up disappears after a day. */
export const SUBTITLES_TTL_SECONDS = 24 * 60 * 60

interface StoredSubtitles {
  lines: string[]
  createdAt: string
}

/**
 * Japanese subtitle lines Claude sent back for one translation request,
 * waiting for the subtitle step to pick them up.
 */
export interface SubtitleStore {
  put(requestId: string, lines: string[]): Promise<void>
  get(requestId: string): Promise<string[] | null>
  /** Succeeds when they are already gone. */
  remove(requestId: string): Promise<void>
}

export function createSubtitleStore(redis: RedisLike, now: () => Date = () => new Date()): SubtitleStore {
  return {
    async put(requestId, lines) {
      const stored: StoredSubtitles = { lines, createdAt: now().toISOString() }
      await redis.set(PREFIX + requestId, stored, { ex: SUBTITLES_TTL_SECONDS })
    },

    async get(requestId) {
      const stored = await redis.get<StoredSubtitles>(PREFIX + requestId)
      return stored?.lines ?? null
    },

    async remove(requestId) {
      await redis.del(PREFIX + requestId)
    },
  }
}

export function subtitleStoreFromEnv(): SubtitleStore {
  return createSubtitleStore(redisFromEnv())
}
