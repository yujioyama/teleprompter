import { useEffect, useRef, useState } from 'react'
import {
  COVER_HEIGHT,
  COVER_STICKER_SIZE,
  COVER_WIDTH,
  canvasToPng,
  clampStickerSpot,
  coverStickerSpot,
  drawCover,
  type CoverStickerSpot,
  type CoverWords,
} from '../utils/coverImage'
import { shareOrDownload } from '../utils/shareOrDownload'
import type { StickerPlacement } from '../utils/subtitleSticker'
import styles from './CoverMaker.module.css'

interface Props {
  /** The combined video before subtitles, so the cover has no burned-in lines. */
  videoUrl: string
  /** The words found in the script, editable here before saving. */
  initialWords: CoverWords
  filenameBase: string
  /** 0-100, where the words start: the position used last time. */
  initialPosition: number
  /** Called when the slider moves, so the next cover starts there. */
  onPositionChange: (position: number) => void
  /** Where the video's first frame has its sticker; the cover puts it there too until it is dragged. */
  stickerPlacement: StickerPlacement
  /** Where the sticker was dragged to last time; null = where the video has it. */
  initialStickerSpot: CoverStickerSpot | null
  /** Called when a drag ends or the sticker goes back, so the next cover starts there. */
  onStickerSpotChange: (spot: CoverStickerSpot | null) => void
  /**
   * A button above the cover-only save that saves the cover along with
   * other things in one tap. It gets the cover still being encoded, so the
   * page can do what must happen inside the tap (copying to the clipboard)
   * before waiting for it.
   */
  saveAll?: { label: string; save: (cover: Promise<Blob>) => Promise<void> }
}

/**
 * Pick a frame with the slider and save it as a 1080×1920 PNG with the
 * episode's English phrase and Japanese word on it, and the first shot's
 * sticker, for the profile grid.
 * Its one <video> only feeds the canvas; the page hides its own preview
 * while this is open, so only one video decoder is live.
 */
export default function CoverMaker({
  videoUrl,
  initialWords,
  filenameBase,
  initialPosition,
  onPositionChange,
  stickerPlacement,
  initialStickerSpot,
  onStickerSpotChange,
  saveAll,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  /** While dragging: how far the finger is from the sticker's center, so it doesn't jump under it. */
  const dragRef = useRef<CoverStickerSpot | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [ready, setReady] = useState(false)
  const [words, setWords] = useState<CoverWords>(initialWords)
  const [position, setPosition] = useState(initialPosition)
  const [movedSticker, setMovedSticker] = useState<CoverStickerSpot | null>(initialStickerSpot)
  const sticker = coverStickerSpot(stickerPlacement, movedSticker)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function redraw() {
    const video = videoRef.current
    const ctx = canvasRef.current?.getContext('2d')
    if (!video || !ctx) return
    drawCover(ctx, video, video.videoWidth, video.videoHeight, words, position, sticker)
  }

  // Draw again whenever the words or where they and the sticker sit change; frame changes redraw on 'seeked'.
  useEffect(() => {
    if (ready) redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, position, movedSticker, ready])

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

  /** The pointer's spot on the cover, in the same units as the sticker's. */
  function pointerSpot(e: React.PointerEvent): CoverStickerSpot | null {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return { x: (e.clientX - rect.left) / rect.width, y: ((e.clientY - rect.top) / rect.height) * 100 }
  }

  function handleStickerDown(e: React.PointerEvent<HTMLDivElement>) {
    const at = pointerSpot(e)
    if (!at) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: sticker.x - at.x, y: sticker.y - at.y }
  }

  function handleStickerMove(e: React.PointerEvent<HTMLDivElement>) {
    const offset = dragRef.current
    const at = offset && pointerSpot(e)
    if (!offset || !at) return
    setMovedSticker(clampStickerSpot({ x: at.x + offset.x, y: at.y + offset.y }))
  }

  function handleStickerUp() {
    if (!dragRef.current) return
    dragRef.current = null
    onStickerSpotChange(movedSticker)
  }

  function handleStickerReset() {
    setMovedSticker(null)
    onStickerSpotChange(null)
  }

  async function runSave(save: (cover: Promise<Blob>) => Promise<unknown>) {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true)
    setError(null)
    try {
      redraw()
      await save(canvasToPng(canvas))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.maker}>
      <div className={styles.frame} ref={frameRef}>
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
        {ready && words.sticker.trim() && (
          <div
            className={styles.stickerHandle}
            style={{
              left: `${sticker.x * 100}%`,
              top: `${sticker.y}%`,
              width: `${(COVER_STICKER_SIZE / COVER_WIDTH) * 100}%`,
            }}
            role="img"
            aria-label="ステッカー(ドラッグで移動)"
            onPointerDown={handleStickerDown}
            onPointerMove={handleStickerMove}
            onPointerUp={handleStickerUp}
            onPointerCancel={handleStickerUp}
          />
        )}
      </div>
      <p className={styles.hint}>点線の内側がプロフィールの一覧に表示される範囲です。ステッカーはドラッグで動かせます</p>

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
        <span>文字の位置(上 ↔ 下)</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          onChange={e => {
            const value = Number(e.target.value)
            setPosition(value)
            onPositionChange(value)
          }}
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
      <label className={styles.field}>
        <span>ステッカー(絵文字・空欄でなし)</span>
        <input
          className={styles.text}
          value={words.sticker}
          onChange={e => setWords(w => ({ ...w, sticker: e.target.value }))}
          placeholder="🪷"
        />
      </label>
      {movedSticker && words.sticker.trim() && (
        <button className={styles.resetBtn} onClick={handleStickerReset}>
          ステッカーを元の位置に戻す
        </button>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {saveAll && (
        <button className={styles.saveBtn} onClick={() => runSave(saveAll.save)} disabled={!ready || saving}>
          {saving ? '書き出し中...' : saveAll.label}
        </button>
      )}
      <button
        className={saveAll ? styles.coverOnlyBtn : styles.saveBtn}
        onClick={() => runSave(async cover => shareOrDownload(await cover, `${filenameBase}-cover`))}
        disabled={!ready || saving}
      >
        {saving ? '書き出し中...' : saveAll ? 'カバー画像だけ保存' : 'カバー画像を保存'}
      </button>
    </div>
  )
}
