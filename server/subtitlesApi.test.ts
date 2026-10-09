// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSubtitlesRequest } from './subtitlesApi.js'
import { createSubtitleStore, type SubtitleStore } from './subtitleStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

let store: SubtitleStore

beforeEach(async () => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  store = createSubtitleStore(createFakeRedis().redis)
  await store.put('k3x9-2', ['一行目', '二行目'])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function req(method: string, path = '/api/subtitles?id=k3x9-2', key: string | null = 'secret') {
  return new Request(`https://app.test${path}`, {
    method,
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  })
}

describe('handleSubtitlesRequest', () => {
  it('rejects a wrong or missing key', async () => {
    expect((await handleSubtitlesRequest(req('GET', undefined, 'wrong'), () => store)).status).toBe(401)
    expect((await handleSubtitlesRequest(req('GET', undefined, null), () => store)).status).toBe(401)
  })

  it('returns the lines sent for a request, uncached', async () => {
    const res = await handleSubtitlesRequest(req('GET'), () => store)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ lines: ['一行目', '二行目'] })
  })

  it('answers 404 while nothing has been sent for the request', async () => {
    const res = await handleSubtitlesRequest(req('GET', '/api/subtitles?id=none-1'), () => store)
    expect(res.status).toBe(404)
  })

  it('deletes the lines, and deleting again still succeeds', async () => {
    expect((await handleSubtitlesRequest(req('DELETE'), () => store)).status).toBe(204)
    expect((await handleSubtitlesRequest(req('DELETE'), () => store)).status).toBe(204)
    expect(await store.get('k3x9-2')).toBeNull()
  })

  it('needs an id', async () => {
    expect((await handleSubtitlesRequest(req('GET', '/api/subtitles'), () => store)).status).toBe(400)
  })

  it('refuses other methods', async () => {
    expect((await handleSubtitlesRequest(req('PUT'), () => store)).status).toBe(405)
  })

  it('answers 500 when the store fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleSubtitlesRequest(req('GET'), () => {
      throw new Error('Upstash Redis is not configured')
    })
    expect(res.status).toBe(500)
  })
})
