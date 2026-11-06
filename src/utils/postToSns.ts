// 投稿する (api/post.ts): the finished video goes to R2, then Buffer posts it
// to Instagram, TikTok and X — right away or at a set time.

export type PostTime = 'now' | 12 | 20

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

/** How a post time reads on the button: 今すぐ, 今日 12:00, 明日 20:00. */
export function postTimeLabel(time: PostTime, now = new Date()): string {
  if (time === 'now') return '今すぐ'
  const at = nextSlot(time, now)
  const day = at.getDate() === now.getDate() ? '今日' : '明日'
  return `${day} ${String(time).padStart(2, '0')}:00`
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
function upload(url: string, video: Blob, onProgress: (ratio: number) => void): Promise<void> {
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
  video: Blob
  caption: string
  time: PostTime
  thumbnailOffsetMs?: number
  onUploadProgress: (ratio: number) => void
  now?: Date
}

export async function postToSns(options: PostOptions): Promise<ChannelResult[]> {
  const { uploadUrl, videoUrl } = await api<{ uploadUrl: string; videoUrl: string }>(options.key, { action: 'upload' })
  try {
    await upload(uploadUrl, options.video, options.onUploadProgress)
  } catch (err) {
    // The browser can't see why R2 refused: ask the server to try the same and say.
    const why = await api<R2Check>(options.key, { action: 'check' }).then(diagnose, () => null)
    throw new Error([err instanceof Error ? err.message : String(err), why].filter(Boolean).join('\n'))
  }
  const when = options.time === 'now' ? 'now' : nextSlot(options.time, options.now).toISOString()
  const { results } = await api<{ results: ChannelResult[] }>(options.key, {
    action: 'publish',
    videoUrl,
    caption: options.caption,
    when,
    thumbnailOffsetMs: options.thumbnailOffsetMs,
  })
  return results
}
