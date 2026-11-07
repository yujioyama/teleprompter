import { useEffect, useRef, useState } from 'react'
import { postStatus, postTimeLabel, postToSns, serviceLabel, type ChannelResult, type PostTime } from '../utils/postToSns'
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
  | { kind: 'sending' }
  | { kind: 'done'; results: ChannelResult[]; time: PostTime; recovered: boolean }
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
 *
 * Each video has one post id: pressing again (after one network failed, or
 * after the app went to the background and lost the answer) only sends to
 * the networks that don't have it yet, and a lost answer is asked for again
 * when the app comes back.
 */
export default function PostToSns({ video, caption, inboxKey, ready, coverOffsetMs, onPosted }: Props) {
  const [time, setTime] = useState<PostTime>('now')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const postIdRef = useRef(crypto.randomUUID())
  const uploadedRef = useRef<string | undefined>(undefined)
  // A publish went out for this post id: its answer may be lost, not missing.
  const sentRef = useRef(false)
  const timeSentRef = useRef<PostTime>('now')
  const stateRef = useRef(state)
  stateRef.current = state

  // Another video is another post.
  useEffect(() => {
    postIdRef.current = crypto.randomUUID()
    uploadedRef.current = undefined
    sentRef.current = false
    setState({ kind: 'idle' })
  }, [video])

  // Back from another app with the answer lost: ask the server what was sent.
  useEffect(() => {
    if (!inboxKey) return
    function onVisible() {
      const s = stateRef.current
      if (document.visibilityState === 'visible' && sentRef.current && s.kind === 'failed') void recover(s.message)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // recover only reads refs and the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxKey])

  const busy = state.kind === 'uploading' || state.kind === 'sending'
  const results = state.kind === 'done' ? state.results : []
  const allSent = results.length > 0 && results.every(r => r.ok)
  const someFailed = results.some(r => !r.ok)

  if (!inboxKey) {
    return (
      <div className={styles.wrapper}>
        <span className={styles.label}>SNSに投稿</span>
        <span className={styles.sub}>設定の「受け取り用キー」を入れると、ここから投稿できます</span>
      </div>
    )
  }

  /** The server's results for this post, in place of an error; false when it has none. */
  async function recover(message: string): Promise<boolean> {
    try {
      const found = await postStatus(inboxKey, postIdRef.current)
      if (found.length > 0) {
        setState({ kind: 'done', results: found, time: timeSentRef.current, recovered: true })
        if (found.some(r => r.ok)) onPosted()
        return true
      }
    } catch {
      // Still offline: the error stays, and the next return to the app asks again.
    }
    setState({ kind: 'failed', message })
    return false
  }

  async function handlePost() {
    if (!video || busy || allSent) return
    const label = postTimeLabel(time)
    const retry = sentRef.current
    const ask = retry
      ? 'まだ届いていないSNSにだけ送ります（投稿済みのSNSには送りません）。よろしいですか？'
      : time === 'now'
        ? 'Instagram・TikTok・X・Threadsに今すぐ投稿しますか？'
        : `Instagram・TikTok・X・Threadsに${label}で予約しますか？`
    if (!window.confirm(caption ? ask : `${ask}\n（キャプションがありません）`)) return
    setState(uploadedRef.current ? { kind: 'sending' } : { kind: 'uploading', ratio: 0 })
    try {
      const thumbnailOffsetMs = await coverOffsetMs()
      const sentTime = time
      const posted = await postToSns({
        key: inboxKey,
        postId: postIdRef.current,
        uploadedUrl: uploadedRef.current,
        onUploaded: url => {
          uploadedRef.current = url
          sentRef.current = true
          timeSentRef.current = sentTime
          setState({ kind: 'sending' })
        },
        video,
        caption,
        time,
        thumbnailOffsetMs,
        onUploadProgress: ratio => setState(s => (s.kind === 'uploading' ? { kind: 'uploading', ratio } : s)),
      })
      sentRef.current = true
      setState({ kind: 'done', results: posted, time: sentTime, recovered: false })
      if (posted.some(r => r.ok)) onPosted()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // The publish may have gone through with only its answer lost.
      if (!sentRef.current || !(await recover(message))) setState({ kind: 'failed', message })
    }
  }

  const buttonLabel = allSent
    ? '投稿しました'
    : someFailed
      ? '失敗したものだけ送り直す'
      : state.kind === 'failed' && sentRef.current
        ? 'もう一度試す（投稿済みのSNSには送りません）'
        : time === 'now'
          ? '今すぐ投稿する'
          : `${postTimeLabel(time)}に予約する`

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
            disabled={busy || sentRef.current}
            onClick={() => setTime(t)}
          >
            {postTimeLabel(t)}
          </button>
        ))}
      </div>
      <button className={styles.postBtn} onClick={handlePost} disabled={!video || !ready || busy || allSent}>
        {buttonLabel}
      </button>
      {state.kind === 'uploading' && (
        <p className={styles.status}>動画をアップロード中... {Math.round(state.ratio * 100)}%（終わるまでこの画面のままにしてください）</p>
      )}
      {state.kind === 'sending' && <p className={styles.status}>各SNSに送っています...</p>}
      {state.kind === 'failed' && <p className={`${styles.status} ${styles.failed}`}>{state.message}</p>}
      {state.kind === 'failed' && sentRef.current && (
        <p className={styles.status}>投稿は届いているかもしれません。アプリに戻ると結果を確かめます。</p>
      )}
      {state.kind === 'done' && (
        <ul className={styles.results}>
          {state.results.map(r => (
            <li key={r.service} className={r.ok ? undefined : styles.failed}>
              {serviceLabel(r.service)}: {r.ok ? okLabel(r.service, state.time) : `失敗（${r.message}）`}
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'done' && state.recovered && (
        <p className={styles.status}>途中で通信が切れたので、結果をサーバーから取り直しました</p>
      )}
      <span className={styles.sub}>YouTubeは下の「YouTubeに投稿」から（YouTube用も書き出すをオンにすると出ます）</span>
    </div>
  )
}
