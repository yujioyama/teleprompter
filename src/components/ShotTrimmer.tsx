import { useRef, useState } from 'react'
import { clampTrimRange } from '../utils/shotTrim'
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
  }

  function handlePointerUp() {
    draggingRef.current = null
  }

  async function playTransitionPreview() {
    const a = videoRef.current
    const b = nextVideoRef.current
    if (!a || !b || !nextUrl) return

    setPreviewingTransition(true)
    a.currentTime = Math.max(0, trimEnd - TRANSITION_WINDOW)
    await a.play()

    a.onpause = null
    const stopAtEnd = () => {
      if (a.currentTime >= trimEnd) {
        a.pause()
        a.removeEventListener('timeupdate', stopAtEnd)
        b.currentTime = 0
        b.play()
        const stopB = () => {
          if (b.currentTime >= TRANSITION_WINDOW) {
            b.pause()
            b.removeEventListener('timeupdate', stopB)
            setPreviewingTransition(false)
          }
        }
        b.addEventListener('timeupdate', stopB)
      }
    }
    a.addEventListener('timeupdate', stopAtEnd)
  }

  const startPct = duration ? (trimStart / duration) * 100 : 0
  const endPct = duration ? (trimEnd / duration) * 100 : 100

  return (
    <div className={styles.wrapper}>
      <video
        ref={videoRef}
        className={styles.video}
        src={url}
        controls
        playsInline
        onLoadedMetadata={e => onDurationKnown(e.currentTarget.duration)}
      />

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
          <video ref={nextVideoRef} src={nextUrl} playsInline style={{ display: 'none' }} />
        </>
      )}
    </div>
  )
}
