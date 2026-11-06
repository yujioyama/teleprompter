import { z } from 'zod'
import { channelsToPost, type BufferClient, type ChannelResult } from './buffer.js'
import { withAuthedJson } from './http.js'
import { checkR2, newVideoUpload, type R2Config } from './r2.js'

// 投稿する: the app asks for somewhere to upload the finished video
// (action "upload"), PUTs it there, then asks for it to be posted through
// Buffer to Instagram, TikTok and X (action "publish").

export interface PostDeps {
  r2: () => R2Config | null
  buffer: () => BufferClient | null
  now?: () => Date
  /** For checkR2; the real fetch when absent. */
  fetch?: typeof fetch
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upload') }),
  z.object({ action: z.literal('check') }),
  z.object({
    action: z.literal('publish'),
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

    // Only videos this app uploaded: the endpoint never posts someone else's URL.
    if (!body.videoUrl.startsWith(`${r2.publicUrl}/posts/`)) {
      return Response.json({ error: 'videoUrl is not an uploaded video' }, { status: 400 })
    }
    if (body.when !== 'now' && Date.parse(body.when) <= now.getTime()) {
      return Response.json({ error: 'that time has already passed' }, { status: 400 })
    }
    const buffer = deps.buffer()
    if (!buffer) return Response.json({ error: 'Buffer is not configured' }, { status: 503 })

    const channels = channelsToPost(await buffer.channels())
    if (channels.length === 0) return Response.json({ error: 'no Buffer channels to post to' }, { status: 409 })
    const when = body.when === 'now' ? ({ kind: 'now' } as const) : ({ kind: 'at', dueAt: new Date(body.when).toISOString() } as const)
    const results: ChannelResult[] = await Promise.all(
      channels.map(channel =>
        buffer.createVideoPost(channel, {
          videoUrl: body.videoUrl,
          text: body.caption,
          when,
          thumbnailOffsetMs: body.thumbnailOffsetMs,
        }),
      ),
    )
    return Response.json({ results })
  })
}
