import { useState } from 'react'
import { postTimeLabel, postToSns, serviceLabel, type ChannelResult, type PostTime } from '../utils/postToSns'
import styles from './PostToSns.module.css'

interface Props {
  /** The SNS version as it will be saved (with the cover frames); null while it's being made. */
  video: Blob | null
  caption: string
  /** 設定 › 受け取り用キー; without it the server can't be asked. */
  inboxKey: string
  /** False while the video still waits on its cover. */
  ready: boolean
  /** Which frame Instagram and TikTok should show as the cover (ms), or undefined for their default. */
  coverOffsetMs: () => Promise<number | undefined>
  /** Posted: the video went out, like 保存する (it records how it was made). */
  onPosted: () => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; ratio: number }
  | { kind: 'done'; results: ChannelResult[]; time: PostTime }
  | { kind: 'failed'; message: string }

const TIMES: PostTime[] = ['now', 12, 20]

/** Threads processes the video first, so a post sent now shows up a minute or so later. */
function okLabel(service: string, time: PostTime): string {
  if (time !== 'now') return `${postTimeLabel(time)}に予約しました`
  return service === 'threads' ? '送りました（動画の処理後、1〜2分で出ます）' : '送りました'
}

/**
 * 投稿する: Instagram, TikTok and X through Buffer, and Threads by its own API, in one tap — right away
 * or at the next 12:00 / 20:00. The caption is the one Claude sent.
 */
export default function PostToSns({ video, caption, inboxKey, ready, coverOffsetMs, onPosted }: Props) {
  const [time, setTime] = useState<PostTime>('now')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const busy = state.kind === 'uploading'
  const posted = state.kind === 'done' && state.results.some(r => r.ok)

  if (!inboxKey) {
    return (
      <div className={styles.wrapper}>
        <span className={styles.label}>SNSに投稿</span>
        <span className={styles.sub}>設定の「受け取り用キー」を入れると、ここから投稿できます</span>
      </div>
    )
  }

  async function handlePost() {
    if (!video || busy) return
    const label = postTimeLabel(time)
    const ask = time === 'now' ? 'Instagram・TikTok・X・Threadsに今すぐ投稿しますか？' : `Instagram・TikTok・X・Threadsに${label}で予約しますか？`
    if (!window.confirm(caption ? ask : `${ask}\n（キャプションがありません）`)) return
    setState({ kind: 'uploading', ratio: 0 })
    try {
      const thumbnailOffsetMs = await coverOffsetMs()
      const results = await postToSns({
        key: inboxKey,
        video,
        caption,
        time,
        thumbnailOffsetMs,
        onUploadProgress: ratio => setState(s => (s.kind === 'uploading' ? { kind: 'uploading', ratio } : s)),
      })
      setState({ kind: 'done', results, time })
      if (results.some(r => r.ok)) onPosted()
    } catch (err) {
      setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>SNSに投稿</span>
      <div className={styles.times} role="group" aria-label="投稿する時間">
        {TIMES.map(t => (
          <button
            key={t}
            type="button"
            className={`${styles.timeBtn} ${time === t ? styles.timeBtnActive : ''}`}
            aria-pressed={time === t}
            disabled={busy}
            onClick={() => setTime(t)}
          >
            {postTimeLabel(t)}
          </button>
        ))}
      </div>
      <button className={styles.postBtn} onClick={handlePost} disabled={!video || !ready || busy || posted}>
        {posted ? '投稿しました' : time === 'now' ? '今すぐ投稿する' : `${postTimeLabel(time)}に予約する`}
      </button>
      {state.kind === 'uploading' && (
        <p className={styles.status}>動画をアップロード中... {Math.round(state.ratio * 100)}%</p>
      )}
      {state.kind === 'uploading' && state.ratio >= 1 && <p className={styles.status}>Bufferに送っています...</p>}
      {state.kind === 'failed' && <p className={`${styles.status} ${styles.failed}`}>{state.message}</p>}
      {state.kind === 'done' && (
        <ul className={styles.results}>
          {state.results.map(r => (
            <li key={r.service} className={r.ok ? undefined : styles.failed}>
              {serviceLabel(r.service)}:{' '}
              {r.ok ? okLabel(r.service, state.time) : `失敗（${r.message}）`}
            </li>
          ))}
        </ul>
      )}
      <span className={styles.sub}>YouTubeは今まで通り別に投稿してください</span>
    </div>
  )
}
