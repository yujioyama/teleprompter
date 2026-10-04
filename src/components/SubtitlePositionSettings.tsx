import { SUBTITLE_SAMPLES } from '../data/subtitleSamples'
import { SUBTITLE_POSITION_PRESETS, SubtitlePosition } from '../utils/subtitlePosition'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import styles from './SubtitlePositionSettings.module.css'

interface SubtitlePositionSettingsProps {
  position: SubtitlePosition
  onChange: (position: SubtitlePosition) => void
}

/**
 * Picks where subtitles start out on every video, shown on a short and a
 * long sample at once: cues grow from the position both ways, so a spot
 * that suits one can push the other off the safe area. Uses the burn-in's
 * own layout (via SubtitleOverlayPreview), so the frames match the output.
 */
export default function SubtitlePositionSettings({ position, onChange }: SubtitlePositionSettingsProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.frames}>
        {SUBTITLE_SAMPLES.map(sample => (
          <figure key={sample.label} className={styles.figure}>
            <div className={styles.frame}>
              <SubtitleOverlayPreview cues={[sample.cue]} position={position} currentTime={0} />
            </div>
            <figcaption className={styles.caption}>{sample.label}</figcaption>
          </figure>
        ))}
      </div>

      <div className={styles.presets}>
        {SUBTITLE_POSITION_PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            className={`${styles.presetBtn} ${position === p.value ? styles.presetBtnActive : ''}`}
            aria-pressed={position === p.value}
            onClick={() => onChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.header}>
        <span className={styles.label}>字幕の上下位置</span>
        <span className={styles.value}>{Math.round(position)}%</span>
      </div>
      <input
        aria-label="字幕の上下位置"
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={1}
        value={position}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}
