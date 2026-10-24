import { ReactNode } from 'react'
import { SubtitleCue } from '../utils/subtitleCues'
import styles from './SubtitleEditor.module.css'

interface SubtitleEditorProps {
  cues: SubtitleCue[]
  onEditEn: (id: string, text: string) => void
  onEditJa: (id: string, text: string) => void
  /**
   * 一発撮り: move where a line starts (and the line before it ends) by
   * `delta` seconds. Without it, line starts are fixed by the shot cuts.
   */
  onShiftStart?: (id: string, delta: number) => void
  /** 一発撮り: play where line `id` starts. Without it there's no 確認 button. */
  onCheck?: (id: string) => void
  /** The line whose start is being checked, with `checkPlayer` under it. */
  checkingId?: string | null
  checkPlayer?: ReactNode
}

/** How far one press of ◀ / ▶ moves a line's start. */
export const SHIFT_STEP_S = 0.1

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export default function SubtitleEditor({
  cues,
  onEditEn,
  onEditJa,
  onShiftStart,
  onCheck,
  checkingId,
  checkPlayer,
}: SubtitleEditorProps) {
  return (
    <div className={styles.list}>
      {cues.map((cue, i) => (
        <div key={cue.id} className={`${styles.row} ${cue.id === checkingId ? styles.rowChecking : ''}`}>
          <div className={styles.num}>
            {i + 1}
            <span className={styles.time}>{formatTime(cue.start)} - {formatTime(cue.end)}</span>
            {onShiftStart && i > 0 && (
              <span className={styles.shift}>
                <button
                  className={styles.shiftBtn}
                  onClick={() => onShiftStart(cue.id, -SHIFT_STEP_S)}
                  aria-label={`${i + 1}行目を早める`}
                >
                  ◀ 早く
                </button>
                <button
                  className={styles.shiftBtn}
                  onClick={() => onShiftStart(cue.id, SHIFT_STEP_S)}
                  aria-label={`${i + 1}行目を遅く`}
                >
                  遅く ▶
                </button>
              </span>
            )}
            {onCheck && i > 0 && (
              <button
                className={`${styles.shiftBtn} ${styles.checkBtn}`}
                onClick={() => onCheck(cue.id)}
                aria-label={`${i + 1}行目を確認`}
              >
                ▶ 確認
              </button>
            )}
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
          {cue.id === checkingId && checkPlayer}
        </div>
      ))}
    </div>
  )
}
