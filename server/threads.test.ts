// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createFakeRedis } from './testing/fakeRedis.js'
import { containerStatus, createVideoContainer, currentToken, publishContainer } from './threads.js'

type Call = { url: URL; method: string }

function graphFetch(respond: (call: Call) => unknown, status = 200) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url: new URL(url), method: init?.method ?? 'GET' }
    calls.push(call)
    return Response.json(respond(call), { status })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-07T00:00:00Z')

describe('currentToken', () => {
  it('exchanges the env token for a long-lived one, then keeps using it', async () => {
    const { redis } = createFakeRedis()
    const { fetchImpl, calls } = graphFetch(() => ({ access_token: 'long' }))
    const config = { accessToken: 'short', appSecret: 'secret' }
    expect(await currentToken(config, redis, fetchImpl, T0)).toBe('long')
    expect(calls[0].url.pathname).toBe('/access_token')
    expect(calls[0].url.searchParams.get('grant_type')).toBe('th_exchange_token')
    expect(await currentToken(config, redis, fetchImpl, new Date(T0.getTime() + 1000))).toBe('long')
    expect(calls).toHaveLength(1)
  })

  it('uses a token that is already long-lived as it is', async () => {
    const { redis } = createFakeRedis()
    const { fetchImpl } = graphFetch(() => ({ error: { message: 'Session key invalid' } }), 400)
    expect(await currentToken({ accessToken: 'long', appSecret: 'secret' }, redis, fetchImpl, T0)).toBe('long')
  })

  it('refreshes once a day has passed, and keeps the old one if that fails', async () => {
    const { redis } = createFakeRedis()
    const config = { accessToken: 'long', appSecret: '' }
    await currentToken(config, redis, graphFetch(() => ({})).fetchImpl, T0)
    const refresh = graphFetch(() => ({ access_token: 'renewed' }))
    expect(await currentToken(config, redis, refresh.fetchImpl, new Date(T0.getTime() + DAY / 2))).toBe('long')
    expect(refresh.calls).toHaveLength(0)
    expect(await currentToken(config, redis, refresh.fetchImpl, new Date(T0.getTime() + DAY))).toBe('renewed')
    expect(refresh.calls[0].url.pathname).toBe('/refresh_access_token')
    const failing = graphFetch(() => ({ error: { message: 'expired' } }), 400)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await currentToken(config, redis, failing.fetchImpl, new Date(T0.getTime() + 3 * DAY))).toBe('renewed')
  })

  it('starts over from a new token put in the env', async () => {
    const { redis } = createFakeRedis()
    await currentToken({ accessToken: 'old', appSecret: '' }, redis, graphFetch(() => ({})).fetchImpl, T0)
    expect(await currentToken({ accessToken: 'new', appSecret: '' }, redis, graphFetch(() => ({})).fetchImpl, T0)).toBe('new')
  })
})

describe('the video post', () => {
  it('creates a video container, reads its status and publishes it', async () => {
    const { fetchImpl, calls } = graphFetch(({ url }) =>
      url.pathname.endsWith('/threads_publish')
        ? { id: 'post1' }
        : url.pathname.endsWith('/threads')
          ? { id: 'c1' }
          : { status: 'FINISHED' },
    )
    expect(await createVideoContainer('tok', 'https://pub.r2.dev/posts/v.mp4', 'hi', fetchImpl)).toBe('c1')
    expect(calls[0].method).toBe('POST')
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      media_type: 'VIDEO',
      video_url: 'https://pub.r2.dev/posts/v.mp4',
      text: 'hi',
      access_token: 'tok',
    })
    expect(await containerStatus('tok', 'c1', fetchImpl)).toEqual({ status: 'FINISHED', error: undefined })
    expect(calls[1].url.pathname).toBe('/v1.0/c1')
    expect(await publishContainer('tok', 'c1', fetchImpl)).toBe('post1')
    expect(calls[2].url.searchParams.get('creation_id')).toBe('c1')
  })

  it("throws Threads' error message", async () => {
    const { fetchImpl } = graphFetch(() => ({ error: { message: 'Invalid video URL' } }), 400)
    await expect(createVideoContainer('tok', 'u', 't', fetchImpl)).rejects.toThrow('Invalid video URL')
  })
})
