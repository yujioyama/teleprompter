import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVideoFrameTime } from '../hooks/useVideoFrameTime'
import { releaseVideo } from '../utils/releaseVideo'
import styles from './CueCheckPlayer.module.css'

/** How much of the line before the switch is played. */
export const CHECK_BEFORE_S = 1.5
/** How long the new line plays before stopping. */
export const CHECK_AFTER_S = 1

interface CueCheckPlayerProps {
  src: string
  /** Where the subtitle switches, in the video's time. */
  at: number
  /** Changed to play the switch again: each 確認 or ◀ / ▶ press. */
  replay: number
  label: string
  /** The subtitles drawn over the picture at `time`. */
  renderOverlay: (time: number) => ReactNode
}

/**
 * A small player under a 一発撮り line that plays just its switch — from
 * CHECK_BEFORE_S before the line starts to CHECK_AFTER_S after — so a
 * line start can be checked and nudged without scrubbing the preview.
 */
export default function CueCheckPlayer({ src, at, replay, label, renderOverlay }: CueCheckPlayerProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [time, setTime] = useState(0)
  const atRef = useRef(at)
  atRef.current = at

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideo(el)
  }, [])

  const onTime = useCallback((t: number) => {
    setTime(t)
    if (t >= atRef.current + CHECK_AFTER_S) videoRef.current?.pause()
  }, [])
  useVideoFrameTime(video, onTime)

  // Layout effect, so play() runs while the tap that asked for it still
  // counts as one (iOS plays sound only then).
  useLayoutEffect(() => {
    const v = videoRef.current
    if (!v) return
    const from = Math.max(0, atRef.current - CHECK_BEFORE_S)
    const seek = () => {
      v.currentTime = from
      setTime(from)
    }
    // Before its metadata has loaded the video can't seek yet.
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
    v.play()?.catch(() => {})
    return () => v.removeEventListener('loadedmetadata', seek)
  }, [replay])

  // Let go of the decoder when closed: the phone has little to spare (issue
  // #12). Only once it has left the DOM: StrictMode re-runs this cleanup on
  // a player that's still on screen, and releasing that one blanks it.
  useEffect(() => {
    const v = videoRef.current
    return () => {
      if (v && !v.isConnected) releaseVideo(v)
    }
  }, [])

  const from = Math.max(0, at - CHECK_BEFORE_S)
  const span = at + CHECK_AFTER_S - from
  const percent = (t: number) => `${Math.min(100, Math.max(0, ((t - from) / span) * 100))}%`

  return (
    <div className={styles.player}>
      <div className={styles.frame}>
        <video
          ref={attach}
          className={styles.video}
          src={src}
          playsInline
          preload="auto"
          aria-label={label}
          onTimeUpdate={e => onTime(e.currentTarget.currentTime)}
        />
        {renderOverlay(time)}
      </div>
      <div className={styles.timeline} aria-hidden="true">
        <span className={styles.cut} style={{ left: percent(at) }} />
        <span className={styles.head} style={{ left: percent(time) }} />
      </div>
    </div>
  )
}
