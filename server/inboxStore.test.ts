// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInboxStore, inboxStoreFromEnv, INBOX_TTL_SECONDS } from './inboxStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

function storeAt(times: string[], ids: string[]) {
  const fake = createFakeRedis()
  const store = createInboxStore(
    fake.redis,
    () => new Date(times.shift() ?? '2026-10-09T00:00:00.000Z'),
    () => ids.shift() ?? 'extra-id',
  )
  return { ...fake, store }
}

describe('createInboxStore', () => {
  it('stores an item under inbox:<id> for 30 days and returns it', async () => {
    const { store, values, expiries } = storeAt(['2026-10-09T01:00:00.000Z'], ['id-1'])
    const { item, replaced } = await store.add({ title: '朝のルーティン', body: '一行目\n二行目', caption: '#朝活' })

    expect(item).toEqual({
      id: 'id-1',
      title: '朝のルーティン',
      body: '一行目\n二行目',
      caption: '#朝活',
      createdAt: '2026-10-09T01:00:00.000Z',
    })
    expect(replaced).toBe(0)
    expect(values.get('inbox:id-1')).toEqual(item)
    expect(expiries.get('inbox:id-1')).toBe(INBOX_TTL_SECONDS)
    expect(INBOX_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it('replaces waiting items with the same title, leaving the others', async () => {
    const { store, values } = storeAt(
      ['2026-10-09T01:00:00.000Z', '2026-10-09T02:00:00.000Z', '2026-10-09T03:00:00.000Z', '2026-10-09T04:00:00.000Z'],
      ['v1', 'other', 'v2', 'v3'],
    )
    await store.add({ title: '朝のルーティン', body: '初版', caption: '' })
    await store.add({ title: '夜のルーティン', body: '別の台本', caption: '' })
    await store.add({ title: '朝のルーティン', body: '修正版', caption: '' })
    // An earlier failure can leave two old versions behind; both go.
    values.set('inbox:v1', { id: 'v1', title: '朝のルーティン', body: '初版', caption: '', createdAt: '2026-10-09T01:00:00.000Z' })

    const { item, replaced } = await store.add({ title: '朝のルーティン', body: '最終版', caption: '#朝活' })

    expect(replaced).toBe(2)
    expect((await store.list()).map(i => [i.id, i.body])).toEqual([
      [item.id, '最終版'],
      ['other', '別の台本'],
    ])
  })

  it('keeps titles that only look alike', async () => {
    const { store } = storeAt([], ['a', 'b'])
    await store.add({ title: '朝のルーティン', body: 'a', caption: '' })
    const { replaced } = await store.add({ title: '朝のルーティン2', body: 'b', caption: '' })
    expect(replaced).toBe(0)
    expect(await store.list()).toHaveLength(2)
  })

  it('lists items newest first', async () => {
    const { store } = storeAt(
      ['2026-10-09T01:00:00.000Z', '2026-10-09T03:00:00.000Z', '2026-10-09T02:00:00.000Z'],
      ['a', 'b', 'c'],
    )
    await store.add({ title: 'A', body: 'a', caption: '' })
    await store.add({ title: 'B', body: 'b', caption: '' })
    await store.add({ title: 'C', body: 'c', caption: '' })

    expect((await store.list()).map(i => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('lists every item across several SCAN pages', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    const { store } = storeAt([], [...ids])
    for (let i = 0; i < ids.length; i++) await store.add({ title: `T${i}`, body: 'b', caption: '' })

    const listed = (await store.list()).map(i => i.id)
    expect(listed).toHaveLength(250)
    expect(new Set(listed)).toEqual(new Set(ids))
  })

  it('lists an item once even when SCAN returns its key twice', async () => {
    const fake = createFakeRedis()
    const realScan = fake.redis.scan.bind(fake.redis)
    fake.redis.scan = (async (...args: Parameters<typeof realScan>) => {
      const [cursor, keys] = await realScan(...args)
      return [cursor, [...keys, ...keys]]
    }) as typeof fake.redis.scan
    const store = createInboxStore(fake.redis, () => new Date('2026-10-09T00:00:00.000Z'), () => 'a')
    await store.add({ title: 'A', body: 'a', caption: '' })

    expect((await store.list()).map(i => i.id)).toEqual(['a'])
  })

  it('lists nothing when the inbox is empty', async () => {
    const { store } = storeAt([], [])
    expect(await store.list()).toEqual([])
  })

  it('ignores keys outside the inbox', async () => {
    const { store, redis } = storeAt([], ['a'])
    await redis.set('other:x', { id: 'x' })
    await store.add({ title: 'A', body: 'a', caption: '' })
    expect((await store.list()).map(i => i.id)).toEqual(['a'])
  })

  it('removes an item, and removing it again is fine', async () => {
    const { store } = storeAt([], ['a'])
    await store.add({ title: 'A', body: 'a', caption: '' })
    await store.remove('a')
    await store.remove('a')
    expect(await store.list()).toEqual([])
  })
})

describe('inboxStoreFromEnv', () => {
  it('explains what is missing when Redis is not configured', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    expect(() => inboxStoreFromEnv()).toThrow(/KV_REST_API_URL/)
  })

  it('builds a store from either set of variable names', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
    expect(inboxStoreFromEnv()).toHaveProperty('add')
  })
})
