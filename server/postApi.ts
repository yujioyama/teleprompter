import { z } from 'zod'
import { channelsToPost, type BufferClient, type ChannelResult } from './buffer.js'
import { withAuthedJson } from './http.js'
import type { PostStore } from './postStore.js'
import { enqueue, type QStashConfig } from './qstash.js'
import { checkR2, newVideoUpload, type R2Config } from './r2.js'
import { threadsJobUrl, type ThreadsJob } from './threadsJobApi.js'

// 投稿する: the app asks for somewhere to upload the finished video
// (action "upload"), PUTs it there, then asks for it to be posted through
// Buffer to Instagram, TikTok and X, and to Threads by its own API
// (action "publish").

/** Threads takes at most 500 characters. */
export const THREADS_TEXT_LIMIT = 500

export interface PostDeps {
  r2: () => R2Config | null
  buffer: () => BufferClient | null
  /** QStash, when Threads posting is set up (it runs the Threads job); null otherwise. */
  threads?: () => QStashConfig | null
  /** What each post already sent; without it a post is never deduplicated. */
  posts?: () => PostStore
  now?: () => Date
  /** For checkR2; the real fetch when absent. */
  fetch?: typeof fetch
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upload') }),
  z.object({ action: z.literal('check') }),
  /** What a post has sent so far: for the app that lost the publish answer. */
  z.object({ action: z.literal('status'), postId: z.string().uuid() }),
  z.object({
    action: z.literal('publish'),
    /** The app's id for this video's post: publishing it again skips the networks that already have it. */
    postId: z.string().uuid().optional(),
    videoUrl: z.string().url().max(500),
    caption: z.string().max(5_000),
    /** 'now', or an ISO time to post at. */
    when: z.union([z.literal('now'), z.string().datetime({ offset: true })]),
    thumbnailOffsetMs: z.number().nonnegative().max(60 * 60 * 1000).optional(),
  }),
])

export function handlePostRequest(request: Request, deps: PostDeps): Promise<Response> {
  return withAuthedJson(request, 'post', async () => {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'invalid request' }, { status: 400 })
    const body = parsed.data

    const r2 = deps.r2()
    if (!r2) return Response.json({ error: 'R2 is not configured' }, { status: 503 })
    const now = deps.now?.() ?? new Date()

    if (body.action === 'upload') return Response.json(newVideoUpload(r2, now))
    if (body.action === 'check') return Response.json(await checkR2(r2, deps.fetch, now))
    const posts = deps.posts?.() ?? null
    if (body.action === 'status') return Response.json({ results: posts ? await posts.results(body.postId) : [] })

    // Only videos this app uploaded: the endpoint never posts someone else's URL.
    if (!body.videoUrl.startsWith(`${r2.publicUrl}/posts/`)) {
      return Response.json({ error: 'videoUrl is not an uploaded video' }, { status: 400 })
    }
    if (body.when !== 'now' && Date.parse(body.when) <= now.getTime()) {
      return Response.json({ error: 'that time has already passed' }, { status: 400 })
    }
    const buffer = deps.buffer()
    const qstash = deps.threads?.() ?? null
    if (!buffer && !qstash) return Response.json({ error: 'Buffer is not configured' }, { status: 503 })

    const channels = buffer ? channelsToPost(await buffer.channels()) : []
    if (channels.length === 0 && !qstash) return Response.json({ error: 'no Buffer channels to post to' }, { status: 409 })
    const when = body.when === 'now' ? ({ kind: 'now' } as const) : ({ kind: 'at', dueAt: new Date(body.when).toISOString() } as const)

    // A network this post already reached is left alone; the rest are (re)sent.
    const postId = body.postId
    const before = posts && postId ? await posts.results(postId) : []
    const done = new Map(before.filter(r => r.ok).map(r => [r.service, r]))
    // Each result is kept as soon as it is in, so a status check sees it even
    // when the app went away before this answer came back.
    const keep = async (result: ChannelResult): Promise<ChannelResult> => {
      if (posts && postId) await posts.save(postId, result).catch(err => console.error('could not keep the post result', err))
      return result
    }
    const sent: ChannelResult[] = await Promise.all([
      ...channels
        .filter(channel => !done.has(channel.service))
        .map(channel =>
          buffer!
            .createVideoPost(channel, {
              videoUrl: body.videoUrl,
              text: body.caption,
              when,
              thumbnailOffsetMs: body.thumbnailOffsetMs,
            })
            .then(keep),
        ),
      ...(qstash && !done.has('threads') ? [queueThreads(qstash, request.url, body.videoUrl, body.caption, when, deps.fetch).then(keep)] : []),
    ])
    const results = [...done.values(), ...sent]
    return Response.json({ results })
  })
}

/** Hand the Threads post to QStash: it calls /api/threads now, or at the post time. */
async function queueThreads(
  qstash: QStashConfig,
  requestUrl: string,
  videoUrl: string,
  caption: string,
  when: { kind: 'now' } | { kind: 'at'; dueAt: string },
  fetchImpl?: typeof fetch,
): Promise<ChannelResult> {
  const job: ThreadsJob = { step: 'create', videoUrl, text: caption.slice(0, THREADS_TEXT_LIMIT) }
  const base = { service: 'threads', name: 'Threads' }
  try {
    await enqueue(
      qstash,
      threadsJobUrl(requestUrl),
      job,
      when.kind === 'now' ? { delaySeconds: 0 } : { notBefore: new Date(when.dueAt) },
      fetchImpl,
    )
    return { ...base, ok: true, ...(when.kind === 'at' ? { dueAt: when.dueAt } : {}) }
  } catch (err) {
    return { ...base, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
