import { SubtitleCue } from '../utils/subtitleCues'
import { SubtitlePosition } from '../utils/subtitlePosition'
import styles from './SubtitleOverlayPreview.module.css'

interface SubtitleOverlayPreviewProps {
  cues: SubtitleCue[]
  position: SubtitlePosition
  currentTime: number
}

/**
 * Cheap DOM/CSS approximation of the real burned-in subtitle box, positioned
 * at the same vertical percent the real burn-in will use. Lets the user see
 * where the subtitle will land without re-running the expensive FFmpeg
 * burn-in on every position change.
 */
export default function SubtitleOverlayPreview({ cues, position, currentTime }: SubtitleOverlayPreviewProps) {
  const cue = cues.find(c => currentTime >= c.start && currentTime < c.end)
  if (!cue) return null

  return (
    <div className={styles.wrapper} style={{ top: `${position}%` }} data-testid="subtitle-overlay-box">
      <p className={styles.en}>{cue.en}</p>
      {cue.ja && <p className={styles.ja}>{cue.ja}</p>}
    </div>
  )
}
