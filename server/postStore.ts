import type { ChannelResult } from './buffer.js'
import { redisFromEnv, type RedisLike } from './redis.js'

// What one 投稿する has already sent, per network, so pressing it again —
// after the app lost the answer (it went to the background) or after one
// network failed — never posts twice to a network that already has it.

const PREFIX = 'post:'
/** Long enough to cover a retry the next day. */
export const POST_TTL_SECONDS = 3 * 24 * 60 * 60
/** Every network 投稿する can send to. */
export const POST_SERVICES = ['instagram', 'tiktok', 'twitter', 'threads'] as const

export interface PostStore {
  /** The results so far for this post. */
  results(postId: string): Promise<ChannelResult[]>
  save(postId: string, result: ChannelResult): Promise<void>
}

export function createPostStore(redis: RedisLike): PostStore {
  // One key per network: networks finishing at once never overwrite each other.
  const key = (postId: string, service: string) => `${PREFIX}${postId}:${service}`
  return {
    async results(postId) {
      const values = await redis.mget<(ChannelResult | null)[]>(...POST_SERVICES.map(s => key(postId, s)))
      return values.filter((v): v is ChannelResult => v !== null)
    },
    async save(postId, result) {
      await redis.set(key(postId, result.service), result, { ex: POST_TTL_SECONDS })
    },
  }
}

export function postStoreFromEnv(): PostStore {
  return createPostStore(redisFromEnv())
}
