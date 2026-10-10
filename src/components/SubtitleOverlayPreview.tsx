import { CSSProperties, Fragment, useMemo } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition, clampedSubtitlePosition } from '../utils/subtitlePosition'
import { styleCues, type HookOptions } from '../utils/subtitleHook'
import { EMPHASIS_COLOR } from '../utils/subtitleEmphasis'
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
} from '../utils/subtitleLayout'
import {
  EMOJI_FONT_FAMILY,
  STICKER_CENTER_X,
  STICKER_CENTER_Y,
  STICKER_EMOJI_PX,
  STICKER_OUTLINE_PX,
  STICKER_ROTATION_DEG,
  stickerOf,
  stripStickers,
} from '../utils/subtitleSticker'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
  /** The first shot's hook treatment; without it every cue is a normal one. */
  hook?: HookOptions
  /** The first shot's length in seconds, which decides the hook cues. */
  firstShotDuration?: number | null
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

/** A block's lines, with `*emphasized*` runs in yellow as burned in. */
function BlockLines({ block }: { block: TextBlockLayout }) {
  return (
    <>
      {block.runs.map((runs, i) => (
        <span key={i} className={styles.line}>
          {runs.map((run, j) =>
            run.emphasized
              ? <span key={j} style={{ color: EMPHASIS_COLOR }}>{run.text}</span>
              : <Fragment key={j}>{run.text}</Fragment>,
          )}
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
}: SubtitleOverlayPreviewProps) {
  const measure = useMemo(() => createCanvasMeasure(), [])
  const hookStyle = hook?.style ?? false
  const styled = useMemo(
    () => styleCues(cues, firstShotDuration, hookStyle),
    [cues, firstShotDuration, hookStyle],
  )
  const cue = styled.find(c => currentTime >= c.start && currentTime < c.end)
  const layout = useMemo(
    () => (cue ? layoutCue(cue.variant === 'hook' ? { ...cue, en: stripStickers(cue.en) } : cue, measure) : null),
    [cue, measure],
  )
  // As burned: only translated cues count, and it stays up for the whole first shot.
  const sticker = useMemo(() => stickerOf(styled.filter(c => c.ja !== null)), [styled])
  const showSticker = sticker !== null && firstShotDuration !== null && currentTime < firstShotDuration

  const hookPosition = hook?.position ?? position

  const cueBox = cue && layout && (
    <div
      className={styles.wrapper}
      style={{
        top: `${clampedSubtitlePosition(cue.variant === 'hook' ? hookPosition : position, layout.height)}%`,
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

  // The die-cut white border, approximated with hard white shadows on every side.
  const o = cqw(STICKER_OUTLINE_PX)
  const stickerBox = showSticker && (
    <span
      className={styles.sticker}
      data-testid="subtitle-sticker"
      style={{
        left: `${STICKER_CENTER_X * 100}%`,
        top: `${STICKER_CENTER_Y}%`,
        fontFamily: EMOJI_FONT_FAMILY,
        fontSize: cqw(STICKER_EMOJI_PX),
        transform: `translate(-50%, -50%) rotate(${STICKER_ROTATION_DEG}deg)`,
        filter: [
          `drop-shadow(${o} 0 0 #fff)`,
          `drop-shadow(-${o} 0 0 #fff)`,
          `drop-shadow(0 ${o} 0 #fff)`,
          `drop-shadow(0 -${o} 0 #fff)`,
          `drop-shadow(0 ${cqw(8)} ${cqw(12)} rgba(0,0,0,0.35))`,
        ].join(' '),
      }}
    >
      {sticker}
    </span>
  )

  if (!cueBox && !stickerBox) return null
  return (
    <>
      {cueBox}
      {stickerBox}
    </>
  )
}
