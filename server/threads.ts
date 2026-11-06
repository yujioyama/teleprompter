import type { RedisLike } from './redis.js'

// Posting the video to Threads with the Threads API
// (https://developers.facebook.com/docs/threads): make a video container,
// wait for Threads to process it, then publish it.

const GRAPH = 'https://graph.threads.net'
const TOKEN_KEY = 'threads:token'
/** Threads only refreshes a long-lived token once it is a day old. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

interface StoredToken {
  token: string
  /** The THREADS_ACCESS_TOKEN it grew from: a new one in the env replaces it. */
  seed: string
  refreshedAt: string
}

export interface ThreadsConfig {
  /** The token from the app dashboard's User Token Generator. */
  accessToken: string
  /** The Threads app secret, to turn a short-lived token into a long-lived one. */
  appSecret: string
}

export function threadsConfigFromEnv(): ThreadsConfig | null {
  const accessToken = process.env.THREADS_ACCESS_TOKEN?.trim()
  if (!accessToken) return null
  return { accessToken, appSecret: process.env.THREADS_APP_SECRET?.trim() ?? '' }
}

export class ThreadsError extends Error {}

async function graph<T>(fetchImpl: typeof fetch, method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<T> {
  const url = `${GRAPH}${path}?${new URLSearchParams(params)}`
  const res = await fetchImpl(url, { method })
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (!res.ok || !body || body.error) {
    throw new ThreadsError(`Threads API ${path}: ${body?.error?.message ?? `HTTP ${res.status}`}`)
  }
  return body
}

/**
 * The token to post with, kept alive: the env token is exchanged for a
 * long-lived one when it is short-lived, and refreshed (another 60 days) once
 * a day has passed since the last refresh. Kept in Redis between calls.
 */
export async function currentToken(
  config: ThreadsConfig,
  redis: RedisLike,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<string> {
  let stored = await redis.get<StoredToken>(TOKEN_KEY)
  if (!stored || stored.seed !== config.accessToken) {
    let token = config.accessToken
    if (config.appSecret) {
      // Only a short-lived token can be exchanged; a long-lived one is used as it is.
      token = await graph<{ access_token: string }>(fetchImpl, 'GET', '/access_token', {
        grant_type: 'th_exchange_token',
        client_secret: config.appSecret,
        access_token: config.accessToken,
      }).then(
        r => r.access_token,
        () => config.accessToken,
      )
    }
    // Not refreshed yet: counted as fresh only once a day has passed, like a refresh.
    stored = { token, seed: config.accessToken, refreshedAt: now.toISOString() }
    await redis.set(TOKEN_KEY, stored)
    return stored.token
  }
  if (now.getTime() - Date.parse(stored.refreshedAt) >= REFRESH_AFTER_MS) {
    try {
      const { access_token } = await graph<{ access_token: string }>(fetchImpl, 'GET', '/refresh_access_token', {
        grant_type: 'th_refresh_token',
        access_token: stored.token,
      })
      stored = { ...stored, token: access_token, refreshedAt: now.toISOString() }
      await redis.set(TOKEN_KEY, stored)
    } catch (err) {
      // The old token still works until it expires; posting goes on with it.
      console.warn('Threads token refresh failed', err)
    }
  }
  return stored.token
}

/** Start a video post; Threads then processes the video (container id). */
export async function createVideoContainer(token: string, videoUrl: string, text: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { id } = await graph<{ id: string }>(fetchImpl, 'POST', '/v1.0/me/threads', {
    media_type: 'VIDEO',
    video_url: videoUrl,
    text,
    access_token: token,
  })
  return id
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'PUBLISHED' | 'ERROR' | 'EXPIRED'

export async function containerStatus(
  token: string,
  containerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: ContainerStatus; error?: string }> {
  const body = await graph<{ status: ContainerStatus; error_message?: string }>(fetchImpl, 'GET', `/v1.0/${containerId}`, {
    fields: 'status,error_message',
    access_token: token,
  })
  return { status: body.status, error: body.error_message }
}

export async function publishContainer(token: string, containerId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { id } = await graph<{ id: string }>(fetchImpl, 'POST', '/v1.0/me/threads_publish', {
    creation_id: containerId,
    access_token: token,
  })
  return id
}
