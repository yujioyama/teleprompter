// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSubtitleStore, subtitleStoreFromEnv, SUBTITLES_TTL_SECONDS } from './subtitleStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createSubtitleStore', () => {
  it('keeps the lines under subtitles:<id> for a day', async () => {
    const { redis, values, expiries } = createFakeRedis()
    const store = createSubtitleStore(redis, () => new Date('2026-10-09T00:00:00.000Z'))

    await store.put('abc-2', ['一行目', '二行目'])

    expect(await store.get('abc-2')).toEqual(['一行目', '二行目'])
    expect(values.get('subtitles:abc-2')).toEqual({ lines: ['一行目', '二行目'], createdAt: '2026-10-09T00:00:00.000Z' })
    expect(expiries.get('subtitles:abc-2')).toBe(SUBTITLES_TTL_SECONDS)
    expect(SUBTITLES_TTL_SECONDS).toBe(24 * 60 * 60)
  })

  it('has nothing for an unknown id', async () => {
    const store = createSubtitleStore(createFakeRedis().redis)
    expect(await store.get('nope-1')).toBeNull()
  })

  it('removes the lines, and removing again is fine', async () => {
    const store = createSubtitleStore(createFakeRedis().redis)
    await store.put('abc-1', ['一行'])
    await store.remove('abc-1')
    await store.remove('abc-1')
    expect(await store.get('abc-1')).toBeNull()
  })
})

describe('subtitleStoreFromEnv', () => {
  it('explains what is missing when Redis is not configured', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    expect(() => subtitleStoreFromEnv()).toThrow(/KV_REST_API_URL/)
  })
})
