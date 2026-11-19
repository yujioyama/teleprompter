import { useState, useSyncExternalStore } from 'react'
import { clearTimings, formatTimings, getTimings, subscribeTimings } from '../utils/finalizeTimings'
import styles from './FinalizeTimings.module.css'

/**
 * This session's 処理時間 (see finalizeTimings), folded away at the bottom of
 * the finalize page, with a button to copy them out for a look elsewhere.
 */
export function FinalizeTimings() {
  const timings = useSyncExternalStore(subscribeTimings, getTimings)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  if (timings.length === 0) return null
  const text = formatTimings(timings)
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    )
  }
  return (
    <details className={styles.timings}>
      <summary>処理時間の記録（{timings.length}件）</summary>
      <pre className={styles.log}>{text}</pre>
      <div className={styles.actions}>
        <button type="button" onClick={copy}>
          {copied === 'copied' ? 'コピーしました' : copied === 'failed' ? 'コピーできませんでした' : 'コピー'}
        </button>
        <button type="button" onClick={clearTimings}>
          消す
        </button>
      </div>
    </details>
  )
}
