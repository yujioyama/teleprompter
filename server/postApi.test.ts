// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BufferChannel, BufferClient, VideoPost } from './buffer.js'
import { handlePostRequest, type PostDeps } from './postApi.js'

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
let buffer: BufferClient

beforeEach(() => {
  vi.stubEnv('INBOX_SECRET', 'secret')
  posted = []
  buffer = {
    channels: async () => [
      { id: 'ig', service: 'instagram', name: 'yuji', isLocked: false, isDisconnected: false },
      { id: 'tt', service: 'tiktok', name: 'yuji', isLocked: false, isDisconnected: false },
      { id: 'x', service: 'twitter', name: 'yuji', isLocked: false, isDisconnected: false },
    ],
    createVideoPost: async (channel, post) => {
      posted.push({ channel, post })
      return { service: channel.service, name: channel.name, ok: true }
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

  it('posts to Instagram, TikTok and X right away, with the cover frame', async () => {
    const res = await handlePostRequest(post(publish({ thumbnailOffsetMs: 0 })), deps())
    expect(res.status).toBe(200)
    expect((await res.json()).results).toHaveLength(3)
    expect(posted.map(p => p.channel.service)).toEqual(['instagram', 'tiktok', 'twitter'])
    expect(posted[0].post).toEqual({ videoUrl: VIDEO, text: 'toast hurt my mouth again', when: { kind: 'now' }, thumbnailOffsetMs: 0 })
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

describe('handlePostRequest check', () => {
  it("tries R2 from the server and says what happened", async () => {
    const fetchImpl = async () => new Response('', { status: 200 })
    const res = await handlePostRequest(post({ action: 'check' }), deps({ fetch: fetchImpl as unknown as typeof fetch }))
    expect(await res.json()).toEqual({ upload: { ok: true, detail: 'HTTP 200' }, publicRead: { ok: true, detail: 'HTTP 200' } })
  })
})
