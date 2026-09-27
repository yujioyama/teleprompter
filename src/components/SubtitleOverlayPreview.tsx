import { CSSProperties, useMemo } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition } from '../utils/subtitlePosition'
import {
  SUBTITLE_BLOCK_GAP,
  SUBTITLE_BOX_MARGIN_X,
  SUBTITLE_BOX_PADDING_X,
  SUBTITLE_BOX_PADDING_Y,
  SUBTITLE_BOX_RADIUS,
  SUBTITLE_REFERENCE_WIDTH,
  TextBlockLayout,
  createCanvasMeasure,
  layoutCue,
} from '../utils/subtitleLayout'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
}

/** Reference-video px → a length relative to the preview container's width. */
const cqw = (px: number) => `${(px / SUBTITLE_REFERENCE_WIDTH) * 100}cqw`

function blockStyle(block: TextBlockLayout): CSSProperties {
  return { fontSize: cqw(block.fontPx), lineHeight: cqw(block.lineHeightPx) }
}

/**
 * Cheap DOM/CSS approximation of the real burned-in subtitle box, positioned
 * at the same vertical percent the real burn-in will use and laid out with
 * the same line breaks and sizes (scaled to the preview's width). Lets the
 * user see where the subtitle will land without re-running the expensive
 * FFmpeg burn-in on every position change.
 */
export default function SubtitleOverlayPreview({ cues, position, currentTime }: SubtitleOverlayPreviewProps) {
  const measure = useMemo(() => createCanvasMeasure(), [])
  const cue = cues.find(c => currentTime >= c.start && currentTime < c.end)
  const layout = useMemo(() => (cue ? layoutCue(cue, measure) : null), [cue, measure])
  if (!cue || !layout) return null

  const wrapperStyle: CSSProperties = {
    top: `${position}%`,
    width: cqw(SUBTITLE_REFERENCE_WIDTH - SUBTITLE_BOX_MARGIN_X * 2),
    padding: `${cqw(SUBTITLE_BOX_PADDING_Y)} ${cqw(SUBTITLE_BOX_PADDING_X)}`,
    borderRadius: cqw(SUBTITLE_BOX_RADIUS),
  }

  return (
    <div className={styles.wrapper} style={wrapperStyle} data-testid="subtitle-overlay-box">
      <p className={styles.en} style={blockStyle(layout.en)}>
        {layout.en.lines.map((line, i) => <span key={i} className={styles.line}>{line}</span>)}
      </p>
      {layout.ja && (
        <p className={styles.ja} style={{ ...blockStyle(layout.ja), marginTop: cqw(SUBTITLE_BLOCK_GAP) }}>
          {layout.ja.lines.map((line, i) => <span key={i} className={styles.line}>{line}</span>)}
        </p>
      )}
    </div>
  )
}
