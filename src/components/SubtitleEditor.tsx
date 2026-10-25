import { ReactNode } from 'react'
import { SubtitleCue, startBoundsOf } from '../utils/subtitleCues'
import { useHoldRepeat } from '../hooks/useHoldRepeat'
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
  /** A line's start was just adjusted (a tap or hold has ended). */
  onStartAdjusted?: (id: string) => void
  /** 一発撮り with a preview: start a line where the preview is paused. */
  onStartAtPlayhead?: (id: string) => void
  /** The preview's time, or null while there is no preview. */
  playheadTime?: number | null
  /** 一発撮り: play where line `id` starts. Without it there's no 確認 button. */
  onCheck?: (id: string) => void
  /** The line whose start is being checked, with `checkPlayer` under it. */
  checkingId?: string | null
  checkPlayer?: ReactNode
}

/** How far one press of − / ＋ moves a line's start. */
export const SHIFT_STEP_S = 0.1

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

function ShiftButton({ onStep, onDone, label, children }: {
  onStep: () => void
  onDone: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button className={styles.shiftBtn} aria-label={label} {...useHoldRepeat(onStep, onDone)}>
      {children}
    </button>
  )
}

export default function SubtitleEditor({
  cues,
  onEditEn,
  onEditJa,
  onShiftStart,
  onStartAdjusted,
  onStartAtPlayhead,
  playheadTime = null,
  onCheck,
  checkingId,
  checkPlayer,
}: SubtitleEditorProps) {
  const playingIndex = playheadTime === null ? -1 : cues.findIndex(c => playheadTime >= c.start && playheadTime < c.end)
  return (
    <div className={styles.list}>
      {onShiftStart && (
        <p className={styles.hint}>
          字幕が声より遅れて出る行は −、早く出すぎる行は ＋ で開始を0.1秒ずつ動かせます（長押しで連続）。
          {onCheck && '動かすたびに、その行の切り替わりを行の下で再生します。'}
          {onStartAtPlayhead && 'プレビューを止めて「今の位置から開始」を押すと、その行がそこから始まります。'}
        </p>
      )}
      {cues.map((cue, i) => {
        const bounds = startBoundsOf(cues, i)
        const canStartAtPlayhead = bounds !== null && playheadTime !== null
          && playheadTime >= bounds[0] && playheadTime <= bounds[1]
        const rowClass = [
          styles.row,
          i === playingIndex ? styles.rowPlaying : '',
          cue.id === checkingId ? styles.rowChecking : '',
        ].join(' ')
        return (
          <div key={cue.id} className={rowClass}>
            <div className={styles.num}>
              {i + 1}
              {!onShiftStart && (
                <span className={styles.time}>{formatTime(cue.start)} - {formatTime(cue.end)}</span>
              )}
            </div>
            {onShiftStart && (
              <div className={styles.timing}>
                <span className={styles.timingLabel}>開始</span>
                {bounds && (
                  <ShiftButton
                    onStep={() => onShiftStart(cue.id, -SHIFT_STEP_S)}
                    onDone={() => onStartAdjusted?.(cue.id)}
                    label={`${i + 1}行目の開始を0.1秒早める`}
                  >
                    −0.1秒
                  </ShiftButton>
                )}
                <span className={styles.timeValue}>{formatTime(cue.start)}</span>
                {bounds && (
                  <ShiftButton
                    onStep={() => onShiftStart(cue.id, SHIFT_STEP_S)}
                    onDone={() => onStartAdjusted?.(cue.id)}
                    label={`${i + 1}行目の開始を0.1秒遅らせる`}
                  >
                    ＋0.1秒
                  </ShiftButton>
                )}
                <span className={styles.timingLabel}>終了 {formatTime(cue.end)}</span>
                {bounds && (onCheck || onStartAtPlayhead) && (
                  <span className={styles.timingActions}>
                    {onCheck && (
                      <button
                        className={`${styles.actionBtn} ${styles.checkBtn}`}
                        onClick={() => onCheck(cue.id)}
                        aria-label={`${i + 1}行目を確認`}
                      >
                        ▶ 確認
                      </button>
                    )}
                    {onStartAtPlayhead && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => onStartAtPlayhead(cue.id)}
                        disabled={!canStartAtPlayhead}
                        aria-label={`${i + 1}行目を今の位置から開始`}
                      >
                        今の位置から開始
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
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
        )
      })}
    </div>
  )
}
