// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { qstashSignature } from './testing/qstash.js'
import { createFakeRedis } from './testing/fakeRedis.js'
import { MAX_CHECKS, handleThreadsJob, type ThreadsJobDeps } from './threadsJobApi.js'

const URL_ = 'https://app.test/api/threads'
const NOW = new Date('2026-11-07T00:00:00Z')
const qstash = { token: 'qtok', url: 'https://qstash.upstash.io', currentSigningKey: 'cur', nextSigningKey: 'next' }

let status: string
let calls: { url: string; init?: RequestInit }[]

beforeEach(() => {
  status = 'IN_PROGRESS'
  calls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const fetchImpl = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init })
  if (url.startsWith('https://qstash.upstash.io')) return Response.json({ messageId: 'm' })
  const path = new URL(url).pathname
  if (path.endsWith('/threads_publish')) return Response.json({ id: 'post1' })
  if (path.endsWith('/me/threads')) return Response.json({ id: 'c1' })
  return Response.json({ status })
}) as unknown as typeof fetch

function deps(): ThreadsJobDeps {
  const { redis } = createFakeRedis()
  return {
    qstash: () => qstash,
    threads: () => ({ accessToken: 'tok', appSecret: '' }),
    redis: () => redis,
    fetch: fetchImpl,
    now: () => NOW,
  }
}

function job(body: unknown, key = 'cur') {
  const raw = JSON.stringify(body)
  return new Request(URL_, { method: 'POST', headers: { 'Upstash-Signature': qstashSignature(key, raw, URL_) }, body: raw })
}

const queued = () => calls.filter(c => c.url.startsWith('https://qstash.upstash.io')).map(c => JSON.parse(String(c.init?.body)))

describe('handleThreadsJob', () => {
  it('only runs jobs QStash signed', async () => {
    expect((await handleThreadsJob(job({ step: 'create', videoUrl: 'https://p.dev/v.mp4', text: 'hi' }, 'wrong'), deps())).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('creates the container, then checks back in 30 seconds', async () => {
    const res = await handleThreadsJob(job({ step: 'create', videoUrl: 'https://p.dev/v.mp4', text: 'hi' }), deps())
    expect(await res.json()).toEqual({ containerId: 'c1' })
    expect(queued()).toEqual([{ step: 'publish', containerId: 'c1', check: 1 }])
    const qstashCall = calls.find(c => c.url.startsWith('https://qstash.upstash.io'))
    expect(qstashCall?.url).toBe('https://qstash.upstash.io/v2/publish/https://app.test/api/threads')
    expect(qstashCall?.init?.headers).toMatchObject({ 'Upstash-Delay': '30s' })
  })

  it('checks again while Threads is still processing, and publishes once it is done', async () => {
    await handleThreadsJob(job({ step: 'publish', containerId: 'c1', check: 1 }), deps())
    expect(queued()).toEqual([{ step: 'publish', containerId: 'c1', check: 2 }])
    status = 'FINISHED'
    const res = await handleThreadsJob(job({ step: 'publish', containerId: 'c1', check: 2 }), deps())
    expect(await res.json()).toEqual({ published: 'post1' })
    expect(queued()).toHaveLength(1)
  })

  it('gives up after the last check, and on an error, without retrying', async () => {
    const res = await handleThreadsJob(job({ step: 'publish', containerId: 'c1', check: MAX_CHECKS }), deps())
    expect(res.status).toBe(200)
    status = 'ERROR'
    expect((await handleThreadsJob(job({ step: 'publish', containerId: 'c1', check: 1 }), deps())).status).toBe(200)
    expect(queued()).toEqual([])
  })

  it('answers 500 when Threads fails, so QStash retries', async () => {
    const failing = { ...deps(), fetch: (async () => Response.json({ error: { message: 'down' } }, { status: 500 })) as unknown as typeof fetch }
    expect((await handleThreadsJob(job({ step: 'create', videoUrl: 'https://p.dev/v.mp4', text: 'hi' }), failing)).status).toBe(500)
  })
})
