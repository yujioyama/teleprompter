// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleInboxRequest } from './inboxApi.js'
import { createInboxStore, type InboxStore } from './inboxStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

let store: InboxStore

beforeEach(async () => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  const times = ['2026-10-09T01:00:00.000Z', '2026-10-09T02:00:00.000Z']
  const ids = ['old', 'new']
  store = createInboxStore(createFakeRedis().redis, () => new Date(times.shift()!), () => ids.shift()!)
  await store.add({ title: '古い', body: 'a', caption: '' })
  await store.add({ title: '新しい', body: 'b', caption: '#c' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function req(method: string, path = '/api/inbox', key: string | null = 'secret') {
  return new Request(`https://app.test${path}`, {
    method,
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  })
}

describe('handleInboxRequest', () => {
  it('rejects a wrong or missing key', async () => {
    expect((await handleInboxRequest(req('GET', '/api/inbox', 'wrong'), () => store)).status).toBe(401)
    expect((await handleInboxRequest(req('GET', '/api/inbox', null), () => store)).status).toBe(401)
  })

  it('lists the items newest first, uncached', async () => {
    const res = await handleInboxRequest(req('GET'), () => store)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { items } = await res.json()
    expect(items.map((i: { id: string }) => i.id)).toEqual(['new', 'old'])
  })

  it('deletes an item, and deleting it again still succeeds', async () => {
    expect((await handleInboxRequest(req('DELETE', '/api/inbox?id=new'), () => store)).status).toBe(204)
    expect((await handleInboxRequest(req('DELETE', '/api/inbox?id=new'), () => store)).status).toBe(204)
    expect((await store.list()).map(i => i.id)).toEqual(['old'])
  })

  it('needs an id to delete', async () => {
    expect((await handleInboxRequest(req('DELETE'), () => store)).status).toBe(400)
  })

  it('refuses other methods', async () => {
    expect((await handleInboxRequest(req('PUT'), () => store)).status).toBe(405)
  })

  it('answers 500 when the store fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleInboxRequest(req('GET'), () => {
      throw new Error('Upstash Redis is not configured')
    })
    expect(res.status).toBe(500)
  })
})
