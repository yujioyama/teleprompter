import { ReactNode, useRef } from 'react'
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
}

/** How far one press of ◀ / ▶ moves a line's start. */
export const SHIFT_STEP_S = 0.1

/** A finger that moved further than this was scrolling, not tapping. */
const TAP_SLOP_PX = 10

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

/**
 * ◀ / ▶ get tapped quickly over and over, and iOS reads two quick taps as a
 * double-tap and zooms in. Cancelling the touchend stops the zoom (and the
 * click it would fire), so a tap presses the button here instead. Mouse and
 * keyboard presses still arrive as clicks.
 */
function ShiftButton({ onPress, label, children }: { onPress: () => void; label: string; children: ReactNode }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  return (
    <button
      className={styles.shiftBtn}
      onClick={onPress}
      onTouchStart={e => {
        const t = e.touches[0]
        touchStart.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={e => {
        const start = touchStart.current
        touchStart.current = null
        const t = e.changedTouches[0]
        if (!start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP_PX) return
        e.preventDefault()
        onPress()
      }}
      onTouchCancel={() => { touchStart.current = null }}
      aria-label={label}
    >
      {children}
    </button>
  )
}

export default function SubtitleEditor({ cues, onEditEn, onEditJa, onShiftStart }: SubtitleEditorProps) {
  return (
    <div className={styles.list}>
      {cues.map((cue, i) => (
        <div key={cue.id} className={styles.row}>
          <div className={styles.num}>
            {i + 1}
            <span className={styles.time}>{formatTime(cue.start)} - {formatTime(cue.end)}</span>
            {onShiftStart && i > 0 && (
              <span className={styles.shift}>
                <ShiftButton onPress={() => onShiftStart(cue.id, -SHIFT_STEP_S)} label={`${i + 1}行目を早める`}>
                  ◀ 早く
                </ShiftButton>
                <ShiftButton onPress={() => onShiftStart(cue.id, SHIFT_STEP_S)} label={`${i + 1}行目を遅く`}>
                  遅く ▶
                </ShiftButton>
              </span>
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
        </div>
      ))}
    </div>
  )
}
