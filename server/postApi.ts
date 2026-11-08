import { z } from 'zod'
import { FREE_SLOT_COUNT, NOW_DELAY_MINUTES } from '../shared/posting.js'
import { channelsToPost, type BufferClient, type ChannelResult } from './buffer.js'
import { withAuthedJson } from './http.js'
import type { PostStore } from './postStore.js'
import { cancelMessage, enqueue, type QStashConfig } from './qstash.js'
import { checkR2, newVideoUpload, type R2Config } from './r2.js'
import { threadsJobUrl, type ThreadsJob } from './threadsJobApi.js'

// 投稿する: the app asks for somewhere to upload the finished video
// (action "upload"), PUTs it there, then asks for it to be posted through
// Buffer to Instagram, TikTok and X, and to Threads by its own API
// (action "publish"). "freeSlot" picks the next slot nothing is reserved at.
//
// All or nothing: every network gets a reservation (今すぐ is NOW_DELAY_MINUTES
// out), and when any one of them fails the others are taken back, so the
// video goes everywhere or nowhere.

/** What a network says when it was taken back because another one failed. */
export const ROLLED_BACK = '他のSNSが失敗したので取り消しました'

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
  /** The first of these times (the app's next 12:00s and 20:00s) with nothing reserved. */
  z.object({
    action: z.literal('freeSlot'),
    candidates: z.array(z.string().datetime({ offset: true })).min(1).max(FREE_SLOT_COUNT),
  }),
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

const MINUTE_MS = 60_000

/** The first candidate still ahead with no reservation in the same minute; null when there is none. */
export function firstFreeSlot(candidates: string[], reserved: string[], now: Date): string | null {
  const taken = new Set(reserved.map(at => Math.floor(Date.parse(at) / MINUTE_MS)))
  const ahead = candidates.filter(at => Date.parse(at) > now.getTime()).sort((a, b) => Date.parse(a) - Date.parse(b))
  return ahead.find(at => !taken.has(Math.floor(Date.parse(at) / MINUTE_MS))) ?? null
}

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
    if (body.action === 'freeSlot') return freeSlot(deps.buffer(), body.candidates, now)

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
    // 今すぐ is a reservation a little ahead too, so a failure can still take it back.
    const dueAt = body.when === 'now' ? new Date(now.getTime() + NOW_DELAY_MINUTES * MINUTE_MS) : new Date(body.when)
    const when = { kind: 'at', dueAt: dueAt.toISOString() } as const

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
    const tried: ChannelResult[] = await Promise.all([
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
    const sent = tried.some(r => !r.ok)
      ? await Promise.all(tried.map(r => (r.ok ? takeBack(r, buffer, qstash, deps.fetch).then(keep) : r)))
      : tried
    const results = [...done.values(), ...sent]
    return Response.json({ results })
  })
}

/** Buffer's own list is the truth: a post deleted or moved there frees its slot. */
async function freeSlot(buffer: BufferClient | null, candidates: string[], now: Date): Promise<Response> {
  if (!buffer) return Response.json({ error: 'Buffer is not configured' }, { status: 503 })
  const times = candidates.map(at => Date.parse(at))
  try {
    const reserved = await buffer.scheduledTimes(
      new Date(Math.min(...times)).toISOString(),
      new Date(Math.max(...times) + MINUTE_MS).toISOString(),
    )
    return Response.json({ slot: firstFreeSlot(candidates, reserved, now) })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}

/**
 * Undo a reservation that went through, because another network failed.
 * One that can't be undone stays ok (it will go out), with why in its message,
 * so pressing again never sends it twice.
 */
async function takeBack(
  result: ChannelResult,
  buffer: BufferClient | null,
  qstash: QStashConfig | null,
  fetchImpl?: typeof fetch,
): Promise<ChannelResult> {
  try {
    if (!result.ref) throw new Error('取り消しに使うIDがありません')
    if (result.service === 'threads') await cancelMessage(qstash!, result.ref, fetchImpl)
    else await buffer!.deletePost(result.ref)
    return { service: result.service, name: result.name, ok: false, message: ROLLED_BACK }
  } catch (err) {
    console.error('could not take the post back', result.service, err)
    const why = err instanceof Error ? err.message : String(err)
    return { ...result, message: `他のSNSが失敗しましたが、これは取り消せませんでした（${why}）` }
  }
}

/** Hand the Threads post to QStash: it calls /api/threads now, or at the post time. */
async function queueThreads(
  qstash: QStashConfig,
  requestUrl: string,
  videoUrl: string,
  caption: string,
  when: { kind: 'at'; dueAt: string },
  fetchImpl?: typeof fetch,
): Promise<ChannelResult> {
  const job: ThreadsJob = { step: 'create', videoUrl, text: caption.slice(0, THREADS_TEXT_LIMIT) }
  const base = { service: 'threads', name: 'Threads' }
  try {
    const ref = await enqueue(qstash, threadsJobUrl(requestUrl), job, { notBefore: new Date(when.dueAt) }, fetchImpl)
    return { ...base, ok: true, dueAt: when.dueAt, ...(ref ? { ref } : {}) }
  } catch (err) {
    return { ...base, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
