import { Redis } from '@upstash/redis'

/** The commands the stores use, so tests can stand in a fake. */
export type RedisLike = Pick<Redis, 'set' | 'get' | 'mget' | 'scan' | 'del'>

/** The Upstash database connected to the Vercel project. */
export function redisFromEnv(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Upstash Redis is not configured: set KV_REST_API_URL and KV_REST_API_TOKEN ' +
        '(connect the Upstash for Redis integration to the Vercel project).',
    )
  }
  return new Redis({ url, token })
}
