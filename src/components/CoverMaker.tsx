import { useEffect, useRef, useState } from 'react'
import { COVER_HEIGHT, COVER_WIDTH, canvasToPng, drawCover, type CoverWords } from '../utils/coverImage'
import { shareOrDownload } from '../utils/shareOrDownload'
import styles from './CoverMaker.module.css'

interface Props {
  /** The combined video before subtitles, so the cover has no burned-in lines. */
  videoUrl: string
  /** The words found in the script, editable here before saving. */
  initialWords: CoverWords
  filenameBase: string
}

/**
 * Pick a frame with the slider and save it as a 1080×1920 PNG with the
 * episode's English phrase and Japanese word on it, for the profile grid.
 * Its one <video> only feeds the canvas; the page hides its own preview
 * while this is open, so only one video decoder is live.
 */
export default function CoverMaker({ videoUrl, initialWords, filenameBase }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [ready, setReady] = useState(false)
  const [words, setWords] = useState<CoverWords>(initialWords)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function redraw() {
    const video = videoRef.current
    const ctx = canvasRef.current?.getContext('2d')
    if (!video || !ctx) return
    drawCover(ctx, video, video.videoWidth, video.videoHeight, words)
  }

  // Draw again whenever the words change; frame changes redraw on 'seeked'.
  useEffect(() => {
    if (ready) redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, ready])

  function handleLoaded() {
    const video = videoRef.current
    if (!video) return
    const d = Number.isFinite(video.duration) ? video.duration : 0
    setDuration(d)
    // The very first frame is often mid-blink or mid-movement; start a little in.
    const start = Math.min(0.5, d / 2)
    setTime(start)
    video.currentTime = start
  }

  function handleSeeked() {
    setReady(true)
    redraw()
  }

  function handleSlide(value: number) {
    setTime(value)
    const video = videoRef.current
    if (video) video.currentTime = value
  }

  async function handleSave() {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true)
    setError(null)
    try {
      redraw()
      const blob = await canvasToPng(canvas)
      await shareOrDownload(blob, `${filenameBase}-cover`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.maker}>
      <div className={styles.frame}>
        <video
          ref={videoRef}
          className={styles.source}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onLoadedData={handleLoaded}
          onSeeked={handleSeeked}
        />
        <canvas ref={canvasRef} className={styles.canvas} width={COVER_WIDTH} height={COVER_HEIGHT} />
        {/* Where the profile grid crops the cover. */}
        <div className={styles.gridGuide} aria-hidden="true" />
      </div>
      <p className={styles.hint}>点線の内側がプロフィールの一覧に表示される範囲です</p>

      <label className={styles.field}>
        <span>コマを選ぶ</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={time}
          disabled={!duration}
          onChange={e => handleSlide(Number(e.target.value))}
        />
      </label>
      <label className={styles.field}>
        <span>英語(黄色)</span>
        <input
          className={styles.text}
          value={words.en}
          onChange={e => setWords(w => ({ ...w, en: e.target.value }))}
          placeholder="reckon"
        />
      </label>
      <label className={styles.field}>
        <span>日本語(ミント)</span>
        <input
          className={styles.text}
          value={words.ja}
          onChange={e => setWords(w => ({ ...w, ja: e.target.value }))}
          placeholder="renkon レンコン"
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.saveBtn} onClick={handleSave} disabled={!ready || saving}>
        {saving ? '書き出し中...' : 'カバー画像を保存'}
      </button>
    </div>
  )
}
