import { SubtitleCue } from '../utils/subtitleCues'
import styles from './SubtitleEditor.module.css'

interface SubtitleEditorProps {
  cues: SubtitleCue[]
  onEditEn: (id: string, text: string) => void
  onEditJa: (id: string, text: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export default function SubtitleEditor({ cues, onEditEn, onEditJa }: SubtitleEditorProps) {
  return (
    <div className={styles.list}>
      {cues.map((cue, i) => (
        <div key={cue.id} className={styles.row}>
          <div className={styles.num}>
            {i + 1}
            <span className={styles.time}>{formatTime(cue.start)} - {formatTime(cue.end)}</span>
          </div>
          <input
            className={styles.field}
            value={cue.en}
            onChange={e => onEditEn(cue.id, e.target.value)}
            aria-label={`英語字幕 ${i + 1}`}
          />
          {cue.ja !== null && (
            <input
              className={`${styles.field} ${styles.fieldJa}`}
              value={cue.ja}
              onChange={e => onEditJa(cue.id, e.target.value)}
              aria-label={`日本語字幕 ${i + 1}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
