import { z } from 'zod'
import { enqueue, verifySignature, type QStashConfig } from './qstash.js'
import type { RedisLike } from './redis.js'
import {
  containerStatus,
  createVideoContainer,
  currentToken,
  publishContainer,
  type ThreadsConfig,
} from './threads.js'

// The Threads half of 投稿する, run by QStash calls (api/threads.ts):
// "create" makes the video container (at the post time), then "publish"
// comes back every 30 seconds until Threads has processed the video.

/** How long to wait between checks on the video, and how many checks before giving up (~10 min). */
export const CHECK_EVERY_SECONDS = 30
export const MAX_CHECKS = 20

export const threadsJobSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('create'), videoUrl: z.string().url().max(500), text: z.string().max(500) }),
  z.object({ step: z.literal('publish'), containerId: z.string().min(1).max(100), check: z.number().int().positive() }),
])
export type ThreadsJob = z.infer<typeof threadsJobSchema>

export interface ThreadsJobDeps {
  qstash: () => QStashConfig | null
  threads: () => ThreadsConfig | null
  redis: () => RedisLike
  fetch?: typeof fetch
  now?: () => Date
}

/** Where QStash sends the Threads jobs: this app's /api/threads. */
export function threadsJobUrl(requestUrl: string): string {
  return new URL('/api/threads', requestUrl).toString()
}

export async function handleThreadsJob(request: Request, deps: ThreadsJobDeps): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const qstash = deps.qstash()
  const threads = deps.threads()
  if (!qstash || !threads) return Response.json({ error: 'Threads posting is not configured' }, { status: 503 })

  const raw = await request.text()
  const now = deps.now?.() ?? new Date()
  if (!verifySignature(qstash, request.headers.get('upstash-signature'), raw, request.url, now)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    json = null
  }
  const parsed = threadsJobSchema.safeParse(json)
  // A job QStash can never do: 200, so it isn't retried.
  if (!parsed.success) return Response.json({ error: 'invalid job' })
  const job = parsed.data
  const fetchImpl = deps.fetch ?? fetch

  try {
    const token = await currentToken(threads, deps.redis(), fetchImpl, now)
    const self = threadsJobUrl(request.url)
    if (job.step === 'create') {
      const containerId = await createVideoContainer(token, job.videoUrl, job.text, fetchImpl)
      await enqueue(qstash, self, { step: 'publish', containerId, check: 1 }, { delaySeconds: CHECK_EVERY_SECONDS }, fetchImpl)
      return Response.json({ containerId })
    }
    const { status, error } = await containerStatus(token, job.containerId, fetchImpl)
    if (status === 'FINISHED') return Response.json({ published: await publishContainer(token, job.containerId, fetchImpl) })
    if (status === 'IN_PROGRESS' && job.check < MAX_CHECKS) {
      await enqueue(qstash, self, { ...job, check: job.check + 1 }, { delaySeconds: CHECK_EVERY_SECONDS }, fetchImpl)
      return Response.json({ status })
    }
    // Published already, or failed for good: nothing to retry.
    if (status !== 'PUBLISHED') console.error('Threads video was not published', { status, error, check: job.check })
    return Response.json({ status, error })
  } catch (err) {
    // A 500 makes QStash retry the step.
    console.error('Threads job failed', job.step, err)
    return Response.json({ error: 'Threads job failed' }, { status: 500 })
  }
}
