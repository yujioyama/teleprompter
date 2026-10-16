import { afterEach, describe, expect, it, vi } from 'vitest'
import { postVideoRecord } from './records'
import type { VideoRecord } from '../../shared/videoRecord'

const RECORD = { scriptId: 'script-1' } as VideoRecord

afterEach(() => {
  vi.restoreAllMocks()
})

describe('postVideoRecord', () => {
  it('posts the record with the inbox key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await postVideoRecord('key-1', RECORD)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/records')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key-1', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual(RECORD)
  })

  it('throws when the server refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    await expect(postVideoRecord('key-1', RECORD)).rejects.toThrow('400')
  })
})
