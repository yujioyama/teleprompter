// Posting the finished video through Buffer's GraphQL API
// (https://developers.buffer.com), with the personal API key in BUFFER_API_KEY.
// Buffer fetches the video itself from a public URL (see r2.ts).

const ENDPOINT = 'https://api.buffer.com'

/** The networks the video goes to through Buffer; the others are posted elsewhere. */
export const POSTED_SERVICES = ['instagram', 'tiktok', 'twitter'] as const
export type PostedService = (typeof POSTED_SERVICES)[number]

export interface BufferChannel {
  id: string
  service: string
  name: string
  isLocked: boolean
  isDisconnected: boolean
}

/** When the post goes out: right away, or at a time (ISO). */
export type PostWhen = { kind: 'now' } | { kind: 'at'; dueAt: string }

export interface VideoPost {
  videoUrl: string
  text: string
  when: PostWhen
  /** The frame Instagram and TikTok show as the cover, in ms; absent = their default. */
  thumbnailOffsetMs?: number
}

export interface ChannelResult {
  service: string
  name: string
  ok: boolean
  /** Buffer's error, when it refused the post. */
  message?: string
  dueAt?: string
  /** What undoes the post: Buffer's post id, or the QStash message id for Threads. */
  ref?: string
}

type Fetch = typeof fetch

interface ScheduledPage {
  edges?: { node: { dueAt?: string | null; channelService: string } }[] | null
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}

/** A post waiting in Buffer: when it goes out, and where. */
interface Reservation {
  dueAt: string
  service: PostedService
}

export class BufferError extends Error {}

export function createBufferClient(apiKey: string, fetchImpl: Fetch = fetch) {
  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null
    if (!res.ok || !body || body.errors?.length || !body.data) {
      const message = body?.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`
      throw new BufferError(`Buffer API: ${message}`)
    }
    return body.data
  }

  async function organizationIds(): Promise<string[]> {
    const { account } = await graphql<{ account: { organizations: { id: string }[] } }>(
      'query { account { organizations { id } } }',
    )
    return account.organizations.map(org => org.id)
  }

  /** Every channel in every organization of the account. */
  async function channels(): Promise<BufferChannel[]> {
    const lists = await Promise.all(
      (await organizationIds()).map(org =>
        graphql<{ channels: BufferChannel[] }>(
          'query Channels($org: OrganizationId!) { channels(input: { organizationId: $org }) { id service name isLocked isDisconnected } }',
          { org },
        ).then(d => d.channels),
      ),
    )
    return lists.flat()
  }

  /** The reserved posts to the posted networks in one organization, between two ISO times. */
  async function scheduledIn(organizationId: string, start: string, end: string): Promise<Reservation[]> {
    const found: Reservation[] = []
    let after: string | null = null
    do {
      const { posts }: { posts: ScheduledPage } = await graphql<{ posts: ScheduledPage }>(
        `query Scheduled($input: PostsInput!, $after: String) {
          posts(first: 100, after: $after, input: $input) {
            edges { node { dueAt channelService } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { after, input: { organizationId, filter: { status: ['scheduled'], dueAt: { start, end } } } },
      )
      for (const { node } of posts.edges ?? []) {
        if (node.dueAt && (POSTED_SERVICES as readonly string[]).includes(node.channelService)) {
          found.push({ dueAt: node.dueAt, service: node.channelService as PostedService })
        }
      }
      after = posts.pageInfo.hasNextPage ? (posts.pageInfo.endCursor ?? null) : null
    } while (after)
    return found
  }

  async function scheduled(start: string, end: string): Promise<Reservation[]> {
    const lists = await Promise.all((await organizationIds()).map(org => scheduledIn(org, start, end)))
    return lists.flat()
  }

  /** When the reserved posts to the posted networks go out, between two ISO times. */
  async function scheduledTimes(start: string, end: string): Promise<string[]> {
    return (await scheduled(start, end)).map(r => r.dueAt)
  }

  /** How many posts each posted network has reserved, between two ISO times. */
  async function scheduledCounts(start: string, end: string): Promise<Record<PostedService, number>> {
    const counts = Object.fromEntries(POSTED_SERVICES.map(service => [service, 0])) as Record<PostedService, number>
    for (const { service } of await scheduled(start, end)) counts[service]++
    return counts
  }

  async function createVideoPost(channel: BufferChannel, post: VideoPost): Promise<ChannelResult> {
    const video: Record<string, unknown> = { url: post.videoUrl }
    if (post.thumbnailOffsetMs !== undefined && (channel.service === 'instagram' || channel.service === 'tiktok')) {
      video.metadata = { thumbnailOffset: Math.max(0, Math.round(post.thumbnailOffsetMs)) }
    }
    const input: Record<string, unknown> = {
      channelId: channel.id,
      text: post.text,
      schedulingType: 'automatic',
      mode: post.when.kind === 'now' ? 'shareNow' : 'customScheduled',
      assets: [{ video }],
    }
    if (post.when.kind === 'at') input.dueAt = post.when.dueAt
    if (channel.service === 'instagram') input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true } }

    const base = { service: channel.service, name: channel.name }
    try {
      const { createPost } = await graphql<{
        createPost: { post?: { id: string; dueAt?: string | null }; message?: string }
      }>(
        `mutation Create($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess { post { id dueAt } }
            ... on MutationError { message }
          }
        }`,
        { input },
      )
      if (createPost.post) return { ...base, ok: true, dueAt: createPost.post.dueAt ?? undefined, ref: createPost.post.id }
      return { ...base, ok: false, message: createPost.message ?? '不明なエラー' }
    } catch (err) {
      return { ...base, ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Take a reserved post back out of Buffer; throws when Buffer refuses. */
  async function deletePost(id: string): Promise<void> {
    const { deletePost } = await graphql<{ deletePost: { id?: string; message?: string } }>(
      `mutation Delete($input: DeletePostInput!) {
        deletePost(input: $input) {
          ... on DeletePostSuccess { id }
          ... on MutationError { message }
        }
      }`,
      { input: { id } },
    )
    if (!deletePost.id) throw new BufferError(`Buffer API: ${deletePost.message ?? '不明なエラー'}`)
  }

  return { channels, scheduledTimes, scheduledCounts, createVideoPost, deletePost }
}

export type BufferClient = ReturnType<typeof createBufferClient>

/** The usable channel for each posted network (the first one, when there are several). */
export function channelsToPost(all: BufferChannel[]): BufferChannel[] {
  return POSTED_SERVICES.flatMap(service => {
    const channel = all.find(c => c.service === service && !c.isLocked && !c.isDisconnected)
    return channel ? [channel] : []
  })
}
