import { CSSProperties, Fragment, useMemo } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition, SUBTITLE_VIDEO_HEIGHT, clampedSubtitlePosition, clampedSubtitleY } from '../utils/subtitlePosition'
import { headlineY, startsInFirstShot, styleCues, type HookOptions } from '../utils/subtitleHook'
import { EMPHASIS_COLOR } from '../utils/subtitleEmphasis'
import {
  HEADLINE_BOX_OPACITY,
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_BOX_MARGIN_X,
  SUBTITLE_BOX_OPACITY,
  SUBTITLE_BOX_PADDING_X,
  SUBTITLE_BOX_PADDING_Y,
  SUBTITLE_BOX_RADIUS,
  SUBTITLE_REFERENCE_WIDTH,
  TextBlockLayout,
  createCanvasMeasure,
  layoutCue,
  layoutHeadline,
} from '../utils/subtitleLayout'
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

function blockStyle(block: TextBlockLayout): CSSProperties {
  return { fontSize: cqw(block.fontPx), lineHeight: cqw(block.lineHeightPx) }
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
 * Cheap DOM/CSS approximation of the real burned-in subtitle box, positioned
 * at the same vertical percent the real burn-in will use and laid out with
 * the same line breaks and sizes (scaled to the preview's width). Cues go
 * through the same styleCues as the burn, so the first shot's hook style
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
  const layout = useMemo(() => (cue ? layoutCue(cue, measure, cue.variant) : null), [cue, measure])

  const headlineText = hook?.headline ?? ''
  const hookPosition = hook?.position ?? position
  // Placed as the burn places it: above the topmost of the first shot's
  // (translated, hence burned) subtitle boxes.
  const headline = useMemo(() => {
    if (!headlineText || firstShotDuration === null) return null
    const headlineLayout = layoutHeadline(headlineText, measure)
    const boxTops = styled
      .filter(c => c.ja !== null && startsInFirstShot(c.start, firstShotDuration))
      .map(c => clampedSubtitleY(c.variant === 'hook' ? hookPosition : position, layoutCue(c, measure, c.variant).height))
    return { layout: headlineLayout, y: headlineY(boxTops, headlineLayout.height, hookPosition) }
  }, [headlineText, firstShotDuration, styled, measure, hookPosition, position])

  const headlineBox = headline && firstShotDuration !== null && currentTime < firstShotDuration && (
    <div
      className={styles.headline}
      data-testid="hook-headline"
      style={{
        top: `${(headline.y / SUBTITLE_VIDEO_HEIGHT) * 100}%`,
        width: cqw(headline.layout.width),
        padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} 0`,
        borderRadius: cqw(SUBTITLE_BOX_RADIUS),
        backgroundColor: `rgba(0, 0, 0, ${HEADLINE_BOX_OPACITY})`,
      }}
    >
      <p className={styles.headlineText} style={blockStyle(headline.layout.block)}>
        <BlockLines block={headline.layout.block} />
      </p>
    </div>
  )

  const cueBox = cue && layout && (
    <div
      className={styles.wrapper}
      style={{
        top: `${clampedSubtitlePosition(cue.variant === 'hook' ? hookPosition : position, layout.height)}%`,
        width: cqw(SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
        padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} ${cqw(SUBTITLE_BOX_PADDING_X)}`,
        borderRadius: cqw(SUBTITLE_BOX_RADIUS),
        backgroundColor: `rgba(0, 0, 0, ${SUBTITLE_BOX_OPACITY[cue.variant]})`,
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

  if (!headlineBox && !cueBox) return null
  return (
    <>
      {headlineBox}
      {cueBox}
    </>
  )
}
