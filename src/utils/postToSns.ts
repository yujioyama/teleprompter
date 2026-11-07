// 投稿する (api/post.ts): the finished video goes to R2, then Buffer posts it
// to Instagram, TikTok and X — right away or at a set time.

import { FREE_SLOT_COUNT } from '../../shared/posting'

/** The choices on the screen; 'free' is the next slot nothing is reserved at. */
export type PostTime = 'now' | 12 | 20 | 'free'
/** Right away, or the ISO time the post goes out. */
export type PostWhen = 'now' | string

const SLOT_HOURS = [12, 20]
/** A slot closer than this could pass while the video uploads. */
const SLOT_MARGIN_MS = 10 * 60 * 1000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export interface ChannelResult {
  service: string
  name: string
  ok: boolean
  message?: string
  dueAt?: string
}

/** The next time the clock reads `hour`:00 on this device: today, or tomorrow when it has passed. */
export function nextSlot(hour: number, now = new Date()): Date {
  const at = new Date(now)
  at.setHours(hour, 0, 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/** The next 12:00s and 20:00s on this device, far enough ahead to upload to. */
export function upcomingSlots(now = new Date()): Date[] {
  const slots: Date[] = []
  for (let day = 0; slots.length < FREE_SLOT_COUNT; day++) {
    for (const hour of SLOT_HOURS) {
      const at = new Date(now)
      at.setDate(at.getDate() + day)
      at.setHours(hour, 0, 0, 0)
      if (at.getTime() > now.getTime() + SLOT_MARGIN_MS && slots.length < FREE_SLOT_COUNT) slots.push(at)
    }
  }
  return slots
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** How a time reads: 今日 12:00, 明日 20:00, 11/12(木) 20:00. */
export function whenLabel(at: Date, now = new Date()): string {
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = sameDay(at, now)
    ? '今日'
    : sameDay(at, tomorrow)
      ? '明日'
      : `${at.getMonth() + 1}/${at.getDate()}(${WEEKDAYS[at.getDay()]})`
  return `${day} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** How a post time reads on the button: 今すぐ, 今日 12:00, 明日 20:00, 次の空き. */
export function postTimeLabel(time: PostTime, now = new Date()): string {
  if (time === 'now') return '今すぐ'
  if (time === 'free') return '次の空き'
  return whenLabel(nextSlot(time, now), now)
}

/** What YouTube, posted by hand, should be scheduled at so it goes out with the rest. */
export function youtubeScheduleHint(postAt: string, now = new Date()): string {
  return `他のSNSは ${whenLabel(new Date(postAt), now)} に予約済みです。YouTubeでも「スケジュール」で同じ日時を選んでください`
}

/** The networks by name, as they read in the results. */
export function serviceLabel(service: string): string {
  return { instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X', threads: 'Threads' }[service] ?? service
}

/**
 * Which frame Instagram and TikTok should show as the cover, in ms: the cover
 * frames when the export put them in (first or last), else none (their default).
 */
export function coverOffsetMs(placement: 'none' | 'first' | 'last', frames: number, durationSec: number): number | undefined {
  if (placement === 'first') return 0
  if (placement === 'last' && durationSec > 0) {
    // The middle of the cover frames at the end, at 30fps.
    return Math.max(0, Math.round(durationSec * 1000 - (frames / 2) * (1000 / 30)))
  }
  return undefined
}

async function api<T>(key: string, body: unknown): Promise<T> {
  const res = await fetch('/api/post', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !data) throw new Error(data?.error ?? `投稿のリクエストに失敗しました (${res.status})`)
  return data
}

/** PUT the video to the presigned URL, reporting progress 0-1. */
function putVideo(url: string, video: Blob, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', 'video/mp4')
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`アップロードに失敗しました (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('アップロードに失敗しました（通信エラー）'))
    xhr.send(video)
  })
}

interface R2Check {
  upload: { ok: boolean; detail: string }
  publicRead: { ok: boolean; detail: string }
}

/** What the server's own try at R2 says about a failed upload. */
export function diagnose(check: R2Check): string {
  if (!check.upload.ok) {
    return `サーバーからもR2に書き込めませんでした（${check.upload.detail}）。VercelのR2_ACCOUNT_ID・R2_ACCESS_KEY_ID・R2_SECRET_ACCESS_KEY・R2_BUCKETを確認してください`
  }
  if (!check.publicRead.ok) {
    return `R2への書き込みはできますが、公開URLから読めません（${check.publicRead.detail}）。R2のPublic Development URLとVercelのR2_PUBLIC_URLを確認してください`
  }
  return 'サーバーからはR2に書き込めて、公開URLからも読めました。ブラウザからの書き込みだけが止められているので、R2のCORS設定を確認してください'
}

export interface PostOptions {
  key: string
  /** This video's post: sending it again skips the networks that already have it. */
  postId: string
  /** The video already uploaded for this post, so a retry doesn't upload it again. */
  uploadedUrl?: string
  /** Told the uploaded URL as soon as the upload is done. */
  onUploaded?: (videoUrl: string) => void
  video: Blob
  caption: string
  when: PostWhen
  thumbnailOffsetMs?: number
  onUploadProgress: (ratio: number) => void
}

export async function postToSns(options: PostOptions): Promise<ChannelResult[]> {
  let videoUrl = options.uploadedUrl
  if (!videoUrl) {
    const upload = await api<{ uploadUrl: string; videoUrl: string }>(options.key, { action: 'upload' })
    try {
      await putVideo(upload.uploadUrl, options.video, options.onUploadProgress)
    } catch (err) {
      // The browser can't see why R2 refused: ask the server to try the same and say.
      const why = await api<R2Check>(options.key, { action: 'check' }).then(diagnose, () => null)
      throw new Error([err instanceof Error ? err.message : String(err), why].filter(Boolean).join('\n'))
    }
    videoUrl = upload.videoUrl
    options.onUploaded?.(videoUrl)
  }
  const { results } = await api<{ results: ChannelResult[] }>(options.key, {
    action: 'publish',
    postId: options.postId,
    videoUrl,
    caption: options.caption,
    when: options.when,
    thumbnailOffsetMs: options.thumbnailOffsetMs,
  })
  return results
}

/** The next 12:00 or 20:00 nothing is reserved at (ISO); null when all of them are taken. */
export async function nextFreeSlot(key: string, now = new Date()): Promise<string | null> {
  const candidates = upcomingSlots(now).map(at => at.toISOString())
  const { slot } = await api<{ slot: string | null }>(key, { action: 'freeSlot', candidates })
  return slot
}

/**
 * What the server has sent for this post so far: the answer to a publish
 * the app lost (it went to the background while waiting). Empty when nothing was sent.
 */
export async function postStatus(key: string, postId: string): Promise<ChannelResult[]> {
  const { results } = await api<{ results: ChannelResult[] }>(key, { action: 'status', postId })
  return results
}
