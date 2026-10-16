// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRecordStore, RECORD_TTL_SECONDS } from './recordStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'
import { sampleRecord } from './testing/videoRecords.js'

describe('createRecordStore', () => {
  it('keeps one record per script, the latest save replacing the earlier one', async () => {
    const { redis, expiries } = createFakeRedis()
    const store = createRecordStore(redis)
    await store.put(sampleRecord({ durationSec: 80 }))
    await store.put(sampleRecord({ durationSec: 71.4 }))

    const records = await store.list()
    expect(records).toHaveLength(1)
    expect(records[0].durationSec).toBe(71.4)
    expect(expiries.get('record:script-1')).toBe(RECORD_TTL_SECONDS)
  })

  it('lists the newest save first, from `since` on', async () => {
    const store = createRecordStore(createFakeRedis().redis)
    await store.put(sampleRecord({ scriptId: 'a', savedAt: '2026-10-01T00:00:00.000Z' }))
    await store.put(sampleRecord({ scriptId: 'b', savedAt: '2026-10-15T00:00:00.000Z' }))
    await store.put(sampleRecord({ scriptId: 'c', savedAt: '2026-10-08T00:00:00.000Z' }))

    expect((await store.list()).map(r => r.scriptId)).toEqual(['b', 'c', 'a'])
    expect((await store.list('2026-10-08')).map(r => r.scriptId)).toEqual(['b', 'c'])
  })
})
