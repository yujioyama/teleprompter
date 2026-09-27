import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { clampTrimRange } from '../utils/shotTrim'
import { releaseVideo } from '../utils/releaseVideo'
import styles from './ShotTrimmer.module.css'

interface ShotTrimmerProps {
  url: string
  nextUrl: string | null // the next shot's preview URL, for the transition check
  trimStart: number
  trimEnd: number
  onChange: (start: number, end: number) => void
  onDurationKnown: (duration: number) => void
  duration: number // 0 until onDurationKnown has fired
}

const TRANSITION_WINDOW = 1.5 // seconds shown from each side of the cut

// Seeking to the time a player is already at paints nothing, so an untrimmed
// shot seeks just past 0 to get its first frame on screen.
const FIRST_FRAME_TIME = 0.001

export default function ShotTrimmer({
  url,
  nextUrl,
  trimStart,
  trimEnd,
  onChange,
  onDurationKnown,
  duration,
}: ShotTrimmerProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const nextVideoRef = useRef<HTMLVideoElement>(null)
  const draggingRef = useRef<'start' | 'end' | null>(null)
  const [previewingTransition, setPreviewingTransition] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Each shot (and each 再読み込み) gets a fresh <video>. Release the old one
  // explicitly: a detached player keeps its decoder until GC, and on iOS a
  // few of those were enough to make the next shot fail to decode (#12).
  // Only once it has left the DOM: StrictMode re-runs this cleanup on a
  // player that's still on screen, and releasing that one blanks it.
  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (video && !video.isConnected) releaseVideo(video)
    }
  }, [url, reloadKey])

  // A new shot starts clean: no stale error, no half-run transition preview.
  useEffect(() => {
    setMediaError(null)
    setPreviewingTransition(false)
  }, [url])

  // Keep normal playback (native controls) confined to the trimmed range,
  // so pressing play previews only the part of the clip that will be kept.
  useEffect(() => {
    const video = videoRef.current
    if (!video || previewingTransition) return

    function onPlay() {
      if (video!.currentTime < trimStart || video!.currentTime >= trimEnd) {
        video!.currentTime = trimStart
      }
    }
    function onTimeUpdate() {
      if (video!.currentTime >= trimEnd) {
        video!.pause()
        video!.currentTime = trimEnd
      }
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [trimStart, trimEnd, previewingTransition, url, reloadKey])

  function timeFromPointerX(clientX: number): number {
    const el = timelineRef.current
    if (!el || duration === 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function handlePointerDown(which: 'start' | 'end') {
    draggingRef.current = which
  }

  function handlePointerMove(e: React.PointerEvent) {
    const which = draggingRef.current
    if (!which || duration === 0) return
    const t = timeFromPointerX(e.clientX)
    const { start, end } =
      which === 'start'
        ? clampTrimRange(t, trimEnd, duration)
        : clampTrimRange(trimStart, t, duration)
    onChange(start, end)

    // Seek the preview to the handle being dragged so the user can see
    // which frame that trim point lands on.
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = which === 'start' ? start : end
    }
  }

  function handlePointerUp() {
    draggingRef.current = null
  }

  function playTransitionPreview() {
    if (!videoRef.current || !nextUrl) return
    // The next shot's hidden player is only mounted while previewing, so
    // render it synchronously — play() must still run inside this tap.
    flushSync(() => setPreviewingTransition(true))
    const a = videoRef.current
    const b = nextVideoRef.current
    if (!a || !b) {
      setPreviewingTransition(false)
      return
    }

    function finish() {
      a!.removeEventListener('timeupdate', stopAtEnd)
      a!.removeEventListener('pause', onInterrupted)
      a!.removeEventListener('error', onInterrupted)
      b!.removeEventListener('timeupdate', stopB)
      b!.removeEventListener('pause', onInterrupted)
      b!.removeEventListener('error', onInterrupted)
      releaseVideo(b!)
      setPreviewingTransition(false)
    }

    function onInterrupted() {
      finish()
    }

    function stopB() {
      if (b!.currentTime >= TRANSITION_WINDOW) {
        b!.removeEventListener('pause', onInterrupted)
        b!.pause()
        finish()
      }
    }

    function stopAtEnd() {
      if (a!.currentTime >= trimEnd) {
        a!.removeEventListener('pause', onInterrupted)
        a!.pause()
        a!.removeEventListener('timeupdate', stopAtEnd)
        a!.removeEventListener('error', onInterrupted)
        b!.currentTime = 0
        b!.addEventListener('timeupdate', stopB)
        b!.addEventListener('pause', onInterrupted)
        b!.addEventListener('error', onInterrupted)
        b!.play().catch(finish)
      }
    }

    a.addEventListener('timeupdate', stopAtEnd)
    a.addEventListener('pause', onInterrupted)
    a.addEventListener('error', onInterrupted)

    a.currentTime = Math.max(0, trimEnd - TRANSITION_WINDOW)
    a.play().catch(finish)
  }

  const startPct = duration ? (trimStart / duration) * 100 : 0
  const endPct = duration ? (trimEnd / duration) * 100 : 100

  return (
    <div className={styles.wrapper}>
      <video
        key={`${url}#${reloadKey}`}
        ref={videoRef}
        className={styles.video}
        src={url}
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={e => {
          const v = e.currentTarget
          onDurationKnown(v.duration)
          // iOS shows nothing but black until a frame is decoded; a seek
          // makes it decode one without the user pressing play.
          v.currentTime = trimStart > 0 ? trimStart : FIRST_FRAME_TIME
        }}
        onError={e => {
          const err = e.currentTarget.error
          setMediaError(err ? `code ${err.code}${err.message ? `: ${err.message}` : ''}` : 'unknown')
        }}
      />

      {mediaError && (
        <div className={styles.mediaError}>
          <span>この動画を再生できません（{mediaError}）</span>
          <button
            type="button"
            className={styles.transitionBtn}
            onClick={() => {
              setMediaError(null)
              setReloadKey(k => k + 1)
            }}
          >
            再読み込み
          </button>
        </div>
      )}

      <div
        ref={timelineRef}
        className={styles.timeline}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          className={styles.selectedRange}
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        <div
          className={styles.handle}
          style={{ left: `${startPct}%` }}
          onPointerDown={() => handlePointerDown('start')}
        />
        <div
          className={styles.handle}
          style={{ left: `${endPct}%` }}
          onPointerDown={() => handlePointerDown('end')}
        />
      </div>

      <div className={styles.readout}>
        <span>開始 {trimStart.toFixed(1)}秒</span>
        <span>終了 {trimEnd.toFixed(1)}秒</span>
      </div>

      {nextUrl && (
        <>
          <button
            type="button"
            className={styles.transitionBtn}
            onClick={playTransitionPreview}
            disabled={previewingTransition}
          >
            {previewingTransition ? '再生中...' : '▶ 次のショットとのつなぎ目を確認'}
          </button>
          {/* Hidden second player used only to play the next clip's opening frames */}
          {previewingTransition && (
            <video ref={nextVideoRef} src={nextUrl} playsInline style={{ display: 'none' }} />
          )}
        </>
      )}
    </div>
  )
}
