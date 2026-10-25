import { useStallHint } from '../hooks/useStallHint'
import { forgetUnfinishedSetup } from '../utils/cancellation'
import styles from './CancelProcessing.module.css'

interface CancelProcessingProps {
  /** The running job's progress; the stall hint appears once it stops changing. */
  progress: unknown
  onCancel: () => void
}

/**
 * The way out of a 結合 or 焼き込み that has stopped making progress, short
 * of closing the app (issue #34). Rendered only while the job runs.
 */
export default function CancelProcessing({ progress, onCancel }: CancelProcessingProps) {
  const stalled = useStallHint(progress)
  // A setup step that hung (a support check, loading ffmpeg) would make the
  // retry stop at the same place; dropping it lets the retry start it afresh.
  const cancel = () => {
    forgetUnfinishedSetup()
    onCancel()
  }
  return (
    <div className={styles.wrapper}>
      {stalled && <p className={styles.hint}>処理が止まっているようです。中断してやり直してください</p>}
      <button type="button" className={styles.cancelBtn} onClick={cancel}>
        中断する
      </button>
    </div>
  )
}
