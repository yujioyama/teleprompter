import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition, clampedSubtitlePosition } from '../utils/subtitlePosition'
import { styleCues, subtitlePositionOf, type HookOptions } from '../utils/subtitleHook'
import { runColor } from '../utils/subtitleEmphasis'
import {
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_FONT_FAMILY,
  SUBTITLE_PADDING_Y,
  SUBTITLE_REFERENCE_WIDTH,
  SUBTITLE_SHADOW,
  SUBTITLE_TEXT_WIDTH,
  TextBlockLayout,
  createCanvasMeasure,
  layoutCue,
  outlineWidth,
  type MeasureText,
} from '../utils/subtitleLayout'
import { EMOJI_FONT_FAMILY, STICKER_EMOJI_PX, STICKER_OUTLINE_PX, stripStickers } from '../utils/subtitleSticker'
import { placeSticker, type StickerPose } from '../utils/stickerMotion'
import type { FairyAppearance } from '../utils/fairyPlan'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { CREDIT_FONT, CREDIT_FONT_PX, LINE_IMAGE_FRAME, LINE_IMAGE_RADIUS, LINE_IMAGE_SLOT, layoutLineImage, wrapCredit, type CueImage } from '../utils/lineImages'
import { drawSparkles } from '../utils/sparkles'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
  /** The first shot's hook treatment; without it every cue is a normal one. */
  hook?: HookOptions
  /** The first shot's length in seconds, which decides the hook cues. */
  firstShotDuration?: number | null
  /** The first clip's length, past the first shot in 一発撮り; the sticker may stay on into it. */
  firstClipDuration?: number | null
  /** The mid-video cameos and the finale, in the joined video's time. */
  fairies?: FairyAppearance[]
}

/** Reference-video px → a length relative to the preview container's width. */
const cqw = (px: number) => `${(px / SUBTITLE_REFERENCE_WIDTH) * 100}cqw`

/** A block's size plus the burn's outline and shadow, scaled to the preview. */
function blockStyle(block: TextBlockLayout): CSSProperties {
  const px = block.fontPx
  return {
    fontFamily: SUBTITLE_FONT_FAMILY,
    fontSize: cqw(px),
    lineHeight: cqw(block.lineHeightPx),
    WebkitTextStroke: `${cqw(outlineWidth(px))} #000`,
    textShadow: `0 ${cqw(px * SUBTITLE_SHADOW.offsetYRatio)} ${cqw(px * SUBTITLE_SHADOW.blurRatio)} ${SUBTITLE_SHADOW.color}`,
  }
}

/** A block's lines, with `*theme*` runs in yellow and `{word}` runs in mint, as burned in. */
function BlockLines({ block }: { block: TextBlockLayout }) {
  return (
    <>
      {block.runs.map((runs, i) => (
        <span key={i} className={styles.line}>
          {runs.map((run, j) =>
            run.emphasized
              ? <span key={j} style={{ color: runColor(run) }}>{run.text}</span>
              : <Fragment key={j}>{run.text}</Fragment>,
          )}
        </span>
      ))}
    </>
  )
}

/** An emoji sprite with the die-cut white border, posed as the burn draws it. */
function StickerSprite({ emoji, pose, scale, testId }: { emoji: string; pose: StickerPose; scale: number; testId: string }) {
  // The die-cut white border, approximated with hard white shadows on every side.
  // The shadows sit inside the scaled element, so they shrink with the sprite as the burn's do.
  const o = cqw(STICKER_OUTLINE_PX)
  return (
    <span
      className={styles.sticker}
      data-testid={testId}
      style={{
        left: `${pose.x * 100}%`,
        top: `${pose.y * 100}%`,
        fontFamily: EMOJI_FONT_FAMILY,
        fontSize: cqw(STICKER_EMOJI_PX),
        transform: `translate(-50%, -50%) rotate(${pose.rotation}deg) scale(${pose.scale * scale})`,
        opacity: pose.opacity ?? 1,
        filter: [
          `drop-shadow(${o} 0 0 #fff)`,
          `drop-shadow(-${o} 0 0 #fff)`,
          `drop-shadow(0 ${o} 0 #fff)`,
          `drop-shadow(0 -${o} 0 #fff)`,
          `drop-shadow(0 ${cqw(8)} ${cqw(12)} rgba(0,0,0,0.35))`,
        ].join(' '),
      }}
    >
      {emoji}
    </span>
  )
}

/** A line's image and its credit, where and how big the burn draws them. */
function LineImageBox({ image, measure }: { image: CueImage; measure: MeasureText }) {
  const url = useObjectUrl(image.blob)
  const slot = LINE_IMAGE_SLOT
  const credit = wrapCredit(image.credit, slot.width, text => measure(text, CREDIT_FONT))
  const box = layoutLineImage(image.width, image.height, credit.length, slot)
  return (
    <>
      {url && (
        <img
          className={styles.lineImage}
          data-testid="subtitle-line-image"
          alt=""
          src={url}
          style={{
            left: `${(box.image.x / LINE_IMAGE_FRAME.width) * 100}%`,
            top: `${(box.image.y / LINE_IMAGE_FRAME.height) * 100}%`,
            width: cqw(box.image.width),
            height: cqw(box.image.height),
            borderRadius: cqw(LINE_IMAGE_RADIUS),
          }}
        />
      )}
      {credit.map((line, i) => (
        <span
          key={i}
          className={styles.lineImageCredit}
          data-testid="subtitle-line-image-credit"
          style={{
            left: `${(box.creditCenterX / LINE_IMAGE_FRAME.width) * 100}%`,
            top: `${((box.creditTop + i * box.creditLineHeight) / LINE_IMAGE_FRAME.height) * 100}%`,
            fontFamily: SUBTITLE_FONT_FAMILY,
            fontSize: cqw(CREDIT_FONT_PX),
            lineHeight: cqw(box.creditLineHeight),
            WebkitTextStroke: `${cqw(outlineWidth(CREDIT_FONT_PX))} #000`,
          }}
        >
          {line}
        </span>
      ))}
    </>
  )
}

/**
 * Cheap DOM/CSS mirror of the burned-in subtitle: the same outlined text,
 * line breaks and sizes (scaled to the preview's width), at the same
 * vertical percent. Cues go through the same styleCues as the burn, so the first shot's hook style
 * and its 0 s start show here too. Lets the user see where the subtitle
 * will land without re-running the expensive burn-in on every change.
 */
export default function SubtitleOverlayPreview({
  cues,
  position,
  currentTime,
  hook,
  firstShotDuration = null,
  firstClipDuration = firstShotDuration,
  fairies,
}: SubtitleOverlayPreviewProps) {
  const measure = useMemo(() => createCanvasMeasure(), [])
  const hookStyle = hook?.style ?? false
  const styled = useMemo(
    () => styleCues(cues, firstShotDuration, hookStyle),
    [cues, firstShotDuration, hookStyle],
  )
  const cue = styled.find(c => currentTime >= c.start && currentTime < c.end)
  const layout = useMemo(
    // No emoji in any cue's text: they are drawn as stickers and fairies instead.
    () => (cue ? layoutCue({ ...cue, en: stripStickers(cue.en) }, measure) : null),
    [cue, measure],
  )
  // As burned: only translated cues count, and it shows over the window placeSticker gives it.
  const stickerOpening = hook?.opening ?? null
  const stickerMotion = hook?.stickerMotion
  const stickerRoute = hook?.stickerRoute
  const stickerPlacement = hook?.sticker
  const sticker = useMemo(
    () => placeSticker(styled, { sticker: stickerPlacement, stickerMotion, stickerRoute, opening: stickerOpening }, firstShotDuration, firstClipDuration),
    [styled, stickerPlacement, stickerMotion, stickerRoute, stickerOpening, firstShotDuration, firstClipDuration],
  )
  const showSticker = sticker !== null && currentTime >= sticker.start && currentTime < sticker.end
  const pose = sticker && (sticker.path ? sticker.path(currentTime) : { ...sticker.home, scale: 1 })

  // As burned: only a translated cue shows its image.
  const lineImage = cue && cue.ja !== null ? hook?.lineImages?.find(i => i.cueId === cue.id) : undefined

  const cueBox = cue && layout && (
    <div
      className={styles.wrapper}
      style={{
        top: `${clampedSubtitlePosition(subtitlePositionOf(cue, position, { position: hook?.position ?? position, lineImages: hook?.lineImages }), layout.height)}%`,
        width: cqw(SUBTITLE_TEXT_WIDTH),
        padding: `${cqw(SUBTITLE_PADDING_Y)} 0`,
      }}
      data-testid="subtitle-overlay-box"
      data-variant={cue.variant}
    >
      <p className={styles.en} style={blockStyle(layout.en)}>
        <BlockLines block={layout.en} />
      </p>
      {layout.ja && (
        <p className={styles.ja} style={{ ...blockStyle(layout.ja), marginTop: cqw(SUBTITLE_BLOCK_GAP) }}>
          <BlockLines block={layout.ja} />
        </p>
      )}
    </div>
  )

  const stickerBox = showSticker && sticker && pose && (
    <StickerSprite emoji={sticker.emoji} pose={pose} scale={1} testId="subtitle-sticker" />
  )

  const activeFairies = (fairies ?? []).filter(f => currentTime >= f.start && currentTime < f.end)
  const fairyBoxes = activeFairies.map(f => (
    <StickerSprite key={f.key} emoji={f.emoji} pose={f.path(currentTime)} scale={f.scale} testId="subtitle-fairy" />
  ))

  // The canvas is sized in device px from the preview's own size, and redrawn when the playhead or the plan moves.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const showCanvas = showSticker || activeFairies.length > 0
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = entry.contentRect
      setSize(prev => {
        const next = { width: Math.round(width * dpr), height: Math.round(height * dpr) }
        return prev.width === next.width && prev.height === next.height ? prev : next
      })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [showCanvas])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Assigning a size also clears and resets the canvas, so only do it when it changed.
    if (canvas.width !== size.width) canvas.width = size.width
    if (canvas.height !== size.height) canvas.height = size.height
    ctx.clearRect(0, 0, size.width, size.height)
    if (showSticker && sticker) drawSparkles(ctx, sticker.sparkles, currentTime, size.width, size.height)
    for (const f of activeFairies) drawSparkles(ctx, f.sparkles, currentTime, size.width, size.height)
    // activeFairies is derived from [fairies, currentTime]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, sticker, showSticker, fairies, size])

  if (!cueBox && !showCanvas) return null
  return (
    <>
      {lineImage && <LineImageBox key={lineImage.cueId} image={lineImage} measure={measure} />}
      {cueBox}
      {showCanvas && <canvas ref={canvasRef} className={styles.sparkles} />}
      {stickerBox}
      {fairyBoxes}
    </>
  )
}
