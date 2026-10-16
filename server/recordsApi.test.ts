// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRecordsRequest } from './recordsApi.js'
import { createRecordStore, type RecordStore } from './recordStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'
import { sampleRecord } from './testing/videoRecords.js'

let store: RecordStore

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  store = createRecordStore(createFakeRedis().redis)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function post(body: unknown, key = 'secret') {
  return new Request('https://app.test/api/records', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('handleRecordsRequest', () => {
  it('rejects a wrong key', async () => {
    expect((await handleRecordsRequest(post(sampleRecord(), 'wrong'), () => store)).status).toBe(401)
  })

  it('only takes POST', async () => {
    const get = new Request('https://app.test/api/records', { headers: { Authorization: 'Bearer secret' } })
    expect((await handleRecordsRequest(get, () => store)).status).toBe(405)
  })

  it('rejects a body that is not a record', async () => {
    expect((await handleRecordsRequest(post('not json'), () => store)).status).toBe(400)
    expect((await handleRecordsRequest(post({ ...sampleRecord(), effects: null }), () => store)).status).toBe(400)
    expect(await store.list()).toEqual([])
  })

  it('stores a record', async () => {
    const res = await handleRecordsRequest(post(sampleRecord()), () => store)
    expect(res.status).toBe(204)
    expect(await store.list()).toEqual([sampleRecord()])
  })

  it('stores a record with the mid-video zoom, and one from before it existed', async () => {
    const withZoom = sampleRecord({ effects: { ...sampleRecord().effects, midZoom: true } })
    expect((await handleRecordsRequest(post(withZoom), () => store)).status).toBe(204)
    expect(await store.list()).toEqual([withZoom])
    expect((await handleRecordsRequest(post(sampleRecord()), () => store)).status).toBe(204)
  })

  it('stores a record of a 結合 from before the cuts were remembered', async () => {
    const old = sampleRecord({ effects: { ...sampleRecord().effects, trim: null, bgm: null, zoom: null, sticker: null } })
    expect((await handleRecordsRequest(post(old), () => store)).status).toBe(204)
    expect(await store.list()).toEqual([old])
  })
})
