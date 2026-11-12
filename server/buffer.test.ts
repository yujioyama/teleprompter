// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { channelsToPost, createBufferClient, type BufferChannel } from './buffer.js'

function channel(service: string, extra: Partial<BufferChannel> = {}): BufferChannel {
  return { id: `${service}-id`, service, name: `${service}-name`, isLocked: false, isDisconnected: false, ...extra }
}

function fakeFetch(respond: (body: { query: string; variables: Record<string, unknown> }) => unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    return Response.json(respond(body))
  })
}

describe('channelsToPost', () => {
  it('takes one usable Instagram, TikTok and X channel, and nothing else', () => {
    const picked = channelsToPost([
      channel('threads'),
      channel('instagram', { isDisconnected: true, id: 'broken' }),
      channel('instagram'),
      channel('tiktok', { isLocked: true }),
      channel('twitter'),
      channel('youtube'),
    ])
    expect(picked.map(c => c.id)).toEqual(['instagram-id', 'twitter-id'])
  })
})

describe('createBufferClient', () => {
  it('lists the channels of every organization', async () => {
    const fetchImpl = fakeFetch(({ query, variables }) =>
      query.includes('organizations')
        ? { data: { account: { organizations: [{ id: 'o1' }, { id: 'o2' }] } } }
        : { data: { channels: [channel(variables.org === 'o1' ? 'instagram' : 'tiktok')] } },
    )
    const client = createBufferClient('key', fetchImpl as unknown as typeof fetch)
    expect((await client.channels()).map(c => c.service)).toEqual(['instagram', 'tiktok'])
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer key' })
  })

  it('lists the reservations of the posted networks in every organization, page by page', async () => {
    const fetchImpl = fakeFetch(({ query, variables }) => {
      if (query.includes('organizations')) return { data: { account: { organizations: [{ id: 'o1' }, { id: 'o2' }] } } }
      const input = variables.input as { organizationId: string }
      if (input.organizationId === 'o2') {
        return { data: { posts: { edges: [{ node: { dueAt: '2026-11-09T03:00:00.000Z', channelService: 'tiktok' } }], pageInfo: { hasNextPage: false, endCursor: null } } } }
      }
      return variables.after
        ? { data: { posts: { edges: [{ node: { dueAt: '2026-11-08T11:00:00.000Z', channelService: 'twitter' } }], pageInfo: { hasNextPage: false, endCursor: null } } } }
        : {
            data: {
              posts: {
                edges: [
                  { node: { dueAt: '2026-11-08T03:00:00.000Z', channelService: 'instagram' } },
                  // Another network's post doesn't take the slot, and neither does one with no time.
                  { node: { dueAt: '2026-11-08T07:00:00.000Z', channelService: 'youtube' } },
                  { node: { dueAt: null, channelService: 'instagram' } },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'page2' },
              },
            },
          }
    })
    const client = createBufferClient('key', fetchImpl as unknown as typeof fetch)
    const times = await client.scheduledTimes('2026-11-08T00:00:00.000Z', '2026-11-13T00:00:00.000Z')
    expect(times.sort()).toEqual(['2026-11-08T03:00:00.000Z', '2026-11-08T11:00:00.000Z', '2026-11-09T03:00:00.000Z'])
    const asked = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).variables.input
    expect(asked.filter).toEqual({ status: ['scheduled'], dueAt: { start: '2026-11-08T00:00:00.000Z', end: '2026-11-13T00:00:00.000Z' } })
  })

  it('counts the reservations of each posted network', async () => {
    const fetchImpl = fakeFetch(({ query }) => {
      if (query.includes('organizations')) return { data: { account: { organizations: [{ id: 'o1' }] } } }
      return {
        data: {
          posts: {
            edges: [
              { node: { dueAt: '2026-11-08T03:00:00.000Z', channelService: 'tiktok' } },
              { node: { dueAt: '2026-11-08T11:00:00.000Z', channelService: 'tiktok' } },
              { node: { dueAt: '2026-11-08T03:00:00.000Z', channelService: 'twitter' } },
              { node: { dueAt: '2026-11-08T07:00:00.000Z', channelService: 'youtube' } },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }
    })
    const client = createBufferClient('key', fetchImpl as unknown as typeof fetch)
    expect(await client.scheduledCounts('2026-11-08T00:00:00.000Z', '2027-11-08T00:00:00.000Z')).toEqual({
      instagram: 0,
      tiktok: 2,
      twitter: 1,
    })
  })

  it('posts an Instagram video as a reel with its cover frame, right away', async () => {
    const fetchImpl = fakeFetch(() => ({ data: { createPost: { post: { id: 'p1', dueAt: '2026-11-07T03:00:00.000Z' } } } }))
    const client = createBufferClient('key', fetchImpl as unknown as typeof fetch)
    const result = await client.createVideoPost(channel('instagram'), {
      videoUrl: 'https://pub.r2.dev/posts/a.mp4',
      text: 'hi',
      when: { kind: 'now' },
      thumbnailOffsetMs: 0,
    })
    expect(result).toEqual({ service: 'instagram', name: 'instagram-name', ok: true, dueAt: '2026-11-07T03:00:00.000Z', ref: 'p1' })
    const input = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).variables.input
    expect(input).toEqual({
      channelId: 'instagram-id',
      text: 'hi',
      schedulingType: 'automatic',
      mode: 'shareNow',
      assets: [{ video: { url: 'https://pub.r2.dev/posts/a.mp4', metadata: { thumbnailOffset: 0 } } }],
      metadata: { instagram: { type: 'reel', shouldShareToFeed: true } },
    })
  })

  it('schedules an X post at the time, with no cover frame (X has none)', async () => {
    const fetchImpl = fakeFetch(() => ({ data: { createPost: { post: { id: 'p2' } } } }))
    const client = createBufferClient('key', fetchImpl as unknown as typeof fetch)
    await client.createVideoPost(channel('twitter'), {
      videoUrl: 'https://pub.r2.dev/posts/a.mp4',
      text: 'hi',
      when: { kind: 'at', dueAt: '2026-11-07T11:00:00.000Z' },
      thumbnailOffsetMs: 0,
    })
    const input = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).variables.input
    expect(input.mode).toBe('customScheduled')
    expect(input.dueAt).toBe('2026-11-07T11:00:00.000Z')
    expect(input.assets).toEqual([{ video: { url: 'https://pub.r2.dev/posts/a.mp4' } }])
    expect(input.metadata).toBeUndefined()
  })

  it("reports Buffer's refusal instead of throwing", async () => {
    const refused = createBufferClient(
      'key',
      fakeFetch(() => ({ data: { createPost: { message: 'Text is too long' } } })) as unknown as typeof fetch,
    )
    expect(await refused.createVideoPost(channel('twitter'), { videoUrl: 'u', text: 't', when: { kind: 'now' } })).toEqual({
      service: 'twitter',
      name: 'twitter-name',
      ok: false,
      message: 'Text is too long',
    })
    const broken = createBufferClient(
      'key',
      fakeFetch(() => ({ errors: [{ message: 'Unauthorized' }] })) as unknown as typeof fetch,
    )
    const result = await broken.createVideoPost(channel('tiktok'), { videoUrl: 'u', text: 't', when: { kind: 'now' } })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unauthorized')
  })

  it('deletes a post by id, and throws when Buffer refuses', async () => {
    const fetchImpl = fakeFetch(() => ({ data: { deletePost: { id: 'p1' } } }))
    await createBufferClient('key', fetchImpl as unknown as typeof fetch).deletePost('p1')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).variables).toEqual({ input: { id: 'p1' } })
    const refused = createBufferClient('key', fakeFetch(() => ({ data: { deletePost: { message: 'Post already sent' } } })) as unknown as typeof fetch)
    await expect(refused.deletePost('p1')).rejects.toThrow('Post already sent')
  })
})
