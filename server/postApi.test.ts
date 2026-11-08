// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BufferChannel, BufferClient, VideoPost } from './buffer.js'
import { handlePostRequest, ROLLED_BACK, type PostDeps } from './postApi.js'
import { createPostStore } from './postStore.js'
import { createFakeRedis } from './testing/fakeRedis.js'

const r2 = {
  accountId: 'acct',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  bucket: 'teleprompter-posts',
  publicUrl: 'https://pub-abc.r2.dev',
}
const NOW = new Date('2026-11-07T00:00:00Z')
const VIDEO = 'https://pub-abc.r2.dev/posts/2026-11-07/x.mp4'

let posted: { channel: BufferChannel; post: VideoPost }[]
let deleted: string[]
let booked: string[]
let buffer: BufferClient

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  posted = []
  deleted = []
  booked = []
  buffer = {
    scheduledTimes: async () => booked,
    channels: async () => [
      { id: 'ig', service: 'instagram', name: 'yuji', isLocked: false, isDisconnected: false },
      { id: 'tt', service: 'tiktok', name: 'yuji', isLocked: false, isDisconnected: false },
      { id: 'x', service: 'twitter', name: 'yuji', isLocked: false, isDisconnected: false },
    ],
    createVideoPost: async (channel, post) => {
      posted.push({ channel, post })
      return { service: channel.service, name: channel.name, ok: true, ref: `post-${channel.id}` }
    },
    deletePost: async id => {
      deleted.push(id)
    },
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function deps(extra: Partial<PostDeps> = {}): PostDeps {
  return { r2: () => r2, buffer: () => buffer, now: () => NOW, ...extra }
}

function post(body: unknown, key = 'secret') {
  return new Request('https://app.test/api/post', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const publish = (extra: Record<string, unknown> = {}) => ({
  action: 'publish',
  videoUrl: VIDEO,
  caption: 'toast hurt my mouth again',
  when: 'now',
  ...extra,
})

describe('handlePostRequest', () => {
  it('rejects a wrong key and anything but POST', async () => {
    expect((await handlePostRequest(post({ action: 'upload' }, 'wrong'), deps())).status).toBe(401)
    const get = new Request('https://app.test/api/post', { headers: { Authorization: 'Bearer secret' } })
    expect((await handlePostRequest(get, deps())).status).toBe(405)
  })

  it('gives an upload URL and the public URL the video will have', async () => {
    const res = await handlePostRequest(post({ action: 'upload' }), deps())
    expect(res.status).toBe(200)
    const { uploadUrl, videoUrl } = await res.json()
    expect(uploadUrl).toContain('acct.r2.cloudflarestorage.com/teleprompter-posts/posts/2026-11-07/')
    expect(videoUrl).toMatch(/^https:\/\/pub-abc\.r2\.dev\/posts\/2026-11-07\//)
  })

  it('says so when R2 or Buffer is not set up', async () => {
    expect((await handlePostRequest(post({ action: 'upload' }), deps({ r2: () => null }))).status).toBe(503)
    expect((await handlePostRequest(post(publish()), deps({ buffer: () => null }))).status).toBe(503)
  })

  it('posts to Instagram, TikTok and X two minutes out (今すぐ), with the cover frame', async () => {
    const res = await handlePostRequest(post(publish({ thumbnailOffsetMs: 0 })), deps())
    expect(res.status).toBe(200)
    expect((await res.json()).results).toHaveLength(3)
    expect(posted.map(p => p.channel.service)).toEqual(['instagram', 'tiktok', 'twitter'])
    expect(posted[0].post).toEqual({
      videoUrl: VIDEO,
      text: 'toast hurt my mouth again',
      when: { kind: 'at', dueAt: '2026-11-07T00:02:00.000Z' },
      thumbnailOffsetMs: 0,
    })
    expect(deleted).toEqual([])
  })

  it('takes the others back when one network fails, so nothing goes out', async () => {
    const create = buffer.createVideoPost
    buffer.createVideoPost = async (channel, p) =>
      channel.service === 'tiktok' ? { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' } : create(channel, p)
    const { results } = await (await handlePostRequest(post(publish()), deps())).json()
    expect(deleted.sort()).toEqual(['post-ig', 'post-x'])
    expect(results).toEqual([
      { service: 'instagram', name: 'yuji', ok: false, message: ROLLED_BACK },
      { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' },
      { service: 'twitter', name: 'yuji', ok: false, message: ROLLED_BACK },
    ])
  })

  it('keeps a network it could not take back as sent, saying why', async () => {
    const create = buffer.createVideoPost
    buffer.createVideoPost = async (channel, p) =>
      channel.service === 'tiktok' ? { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' } : create(channel, p)
    buffer.deletePost = async id => {
      if (id === 'post-x') throw new Error('Buffer API: down')
      deleted.push(id)
    }
    const { results } = await (await handlePostRequest(post(publish()), deps())).json()
    expect(results[0]).toMatchObject({ service: 'instagram', ok: false })
    expect(results[2]).toMatchObject({ service: 'twitter', ok: true })
    expect(results[2].message).toContain('取り消せませんでした（Buffer API: down）')
  })

  it('schedules at the time given, in UTC', async () => {
    await handlePostRequest(post(publish({ when: '2026-11-07T12:00:00+09:00' })), deps())
    expect(posted[0].post.when).toEqual({ kind: 'at', dueAt: '2026-11-07T03:00:00.000Z' })
  })

  it('refuses a time that has passed, a video it did not upload, and a bad body', async () => {
    expect((await handlePostRequest(post(publish({ when: '2026-11-06T12:00:00+09:00' })), deps())).status).toBe(400)
    expect((await handlePostRequest(post(publish({ videoUrl: 'https://evil.example/v.mp4' })), deps())).status).toBe(400)
    expect((await handlePostRequest(post({ action: 'publish' }), deps())).status).toBe(400)
    expect(posted).toEqual([])
  })
})

describe('handlePostRequest freeSlot', () => {
  const SLOTS = ['2026-11-07T03:00:00.000Z', '2026-11-07T11:00:00.000Z', '2026-11-08T03:00:00.000Z']
  const ask = async (candidates: string[], extra: Partial<PostDeps> = {}) => {
    const res = await handlePostRequest(post({ action: 'freeSlot', candidates }), deps(extra))
    return { status: res.status, body: await res.json() }
  }

  it('gives the first slot with nothing reserved at that minute', async () => {
    expect((await ask(SLOTS)).body).toEqual({ slot: SLOTS[0] })
    booked = ['2026-11-07T03:00:30.000Z']
    expect((await ask(SLOTS)).body).toEqual({ slot: SLOTS[1] })
    booked = [SLOTS[0], SLOTS[1]]
    expect((await ask(SLOTS)).body).toEqual({ slot: SLOTS[2] })
  })

  it('says none when every slot is taken', async () => {
    booked = SLOTS
    expect(await ask(SLOTS)).toEqual({ status: 200, body: { slot: null } })
  })

  it('skips a slot that has passed', async () => {
    expect((await ask(['2026-11-06T03:00:00.000Z', SLOTS[1]])).body).toEqual({ slot: SLOTS[1] })
  })

  it('takes the times as sent, in any offset, whatever order', async () => {
    booked = [SLOTS[0]]
    expect((await ask(['2026-11-07T20:00:00+09:00', '2026-11-07T12:00:00+09:00'])).body).toEqual({ slot: '2026-11-07T20:00:00+09:00' })
  })

  it('says why when Buffer cannot be asked, rather than guessing a free slot', async () => {
    buffer.scheduledTimes = async () => {
      throw new Error('Buffer API: down')
    }
    expect(await ask(SLOTS)).toEqual({ status: 502, body: { error: 'Buffer API: down' } })
    expect((await ask(SLOTS, { buffer: () => null })).status).toBe(503)
  })

  it('refuses a bad list', async () => {
    expect((await ask([])).status).toBe(400)
    expect((await ask(['tomorrow'])).status).toBe(400)
    expect((await ask(Array(11).fill(SLOTS[0]))).status).toBe(400)
  })
})

describe('handlePostRequest check', () => {
  it("tries R2 from the server and says what happened", async () => {
    const fetchImpl = async () => new Response('', { status: 200 })
    const res = await handlePostRequest(post({ action: 'check' }), deps({ fetch: fetchImpl as unknown as typeof fetch }))
    expect(await res.json()).toEqual({ upload: { ok: true, detail: 'HTTP 200' }, publicRead: { ok: true, detail: 'HTTP 200' } })
  })
})

describe('handlePostRequest with Threads', () => {
  const qstash = { token: 'qtok', url: 'https://qstash.upstash.io', currentSigningKey: 'c', nextSigningKey: 'n' }

  function withThreads(fetchImpl: typeof fetch) {
    return deps({ threads: () => qstash, fetch: fetchImpl })
  }

  it('hands Threads to QStash with the caption cut to 500 characters, at the post time', async () => {
    const sent: { url: string; init?: RequestInit }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, init })
      return Response.json({ messageId: 'm' })
    }) as unknown as typeof fetch
    const res = await handlePostRequest(
      post(publish({ caption: 'x'.repeat(600), when: '2026-11-07T20:00:00+09:00' })),
      withThreads(fetchImpl),
    )
    const { results } = await res.json()
    expect(results.map((r: { service: string }) => r.service)).toEqual(['instagram', 'tiktok', 'twitter', 'threads'])
    expect(results[3]).toEqual({ service: 'threads', name: 'Threads', ok: true, dueAt: '2026-11-07T11:00:00.000Z', ref: 'm' })
    expect(sent[0].url).toBe('https://qstash.upstash.io/v2/publish/https://app.test/api/threads')
    expect(sent[0].init?.headers).toMatchObject({ 'Upstash-Not-Before': String(Date.parse('2026-11-07T11:00:00Z') / 1000) })
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ step: 'create', videoUrl: VIDEO, text: 'x'.repeat(500) })
  })

  it('holds 今すぐ two minutes for Threads too', async () => {
    const sent: RequestInit[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent.push(init!)
      return Response.json({ messageId: 'm' })
    }) as unknown as typeof fetch
    await handlePostRequest(post(publish()), withThreads(fetchImpl))
    expect(sent[0].headers).toMatchObject({ 'Upstash-Not-Before': String(Date.parse('2026-11-07T00:02:00Z') / 1000) })
  })

  it('takes the Buffer posts back when QStash refuses Threads', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    const { results } = await (await handlePostRequest(post(publish()), withThreads(fetchImpl))).json()
    expect(results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(0)
    expect(results[3].ok).toBe(false)
    expect(deleted.sort()).toEqual(['post-ig', 'post-tt', 'post-x'])
  })

  it('calls off the Threads job when a Buffer network fails', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Response.json({ messageId: 'msg-1' })
    }) as unknown as typeof fetch
    buffer.createVideoPost = async channel => ({ service: channel.service, name: channel.name, ok: false, message: 'busy' })
    const { results } = await (await handlePostRequest(post(publish()), withThreads(fetchImpl))).json()
    expect(calls[1].url).toBe('https://qstash.upstash.io/v2/messages/msg-1')
    expect(calls[1].init?.method).toBe('DELETE')
    expect(results[3]).toEqual({ service: 'threads', name: 'Threads', ok: false, message: ROLLED_BACK })
  })
})

describe('handlePostRequest, posting the same video again', () => {
  const POST_ID = '7f0c4d0e-8a4f-4e57-9a43-2a0e4d1f6b21'

  function withStore() {
    const posts = createPostStore(createFakeRedis().redis)
    return { posts, deps: deps({ posts: () => posts }) }
  }

  it('keeps each result, and the status action gives them back', async () => {
    const { posts, deps: d } = withStore()
    await handlePostRequest(post(publish({ postId: POST_ID })), d)
    expect((await posts.results(POST_ID)).map(r => r.service).sort()).toEqual(['instagram', 'tiktok', 'twitter'])
    const res = await handlePostRequest(post({ action: 'status', postId: POST_ID }), d)
    expect((await res.json()).results).toHaveLength(3)
  })

  it('keeps the taken-back results, so a retry sends to all of them', async () => {
    const { posts, deps: d } = withStore()
    const create = buffer.createVideoPost
    buffer.createVideoPost = async (channel, p) =>
      channel.service === 'tiktok' ? { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' } : create(channel, p)
    await handlePostRequest(post(publish({ postId: POST_ID })), d)
    expect((await posts.results(POST_ID)).every(r => !r.ok)).toBe(true)
    buffer.createVideoPost = create
    posted = []
    await handlePostRequest(post(publish({ postId: POST_ID })), d)
    expect(posted.map(p => p.channel.service)).toEqual(['instagram', 'tiktok', 'twitter'])
  })

  it('sends only to the networks that failed or were not reached', async () => {
    const { posts, deps: d } = withStore()
    await posts.save(POST_ID, { service: 'instagram', name: 'yuji', ok: true })
    await posts.save(POST_ID, { service: 'tiktok', name: 'yuji', ok: false, message: 'busy' })
    const res = await handlePostRequest(post(publish({ postId: POST_ID })), d)
    expect(posted.map(p => p.channel.service)).toEqual(['tiktok', 'twitter'])
    const { results } = await res.json()
    expect(results.map((r: { service: string; ok: boolean }) => [r.service, r.ok])).toEqual([
      ['instagram', true],
      ['tiktok', true],
      ['twitter', true],
    ])
  })

  it('sends nothing when every network already has it', async () => {
    const { posts, deps: d } = withStore()
    for (const service of ['instagram', 'tiktok', 'twitter']) await posts.save(POST_ID, { service, name: 'yuji', ok: true })
    await handlePostRequest(post(publish({ postId: POST_ID })), d)
    expect(posted).toEqual([])
  })

  it('posts each time without a post id, as before', async () => {
    const { deps: d } = withStore()
    await handlePostRequest(post(publish()), d)
    await handlePostRequest(post(publish()), d)
    expect(posted).toHaveLength(6)
  })
})
