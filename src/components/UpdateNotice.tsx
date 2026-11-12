import { useState } from 'react'
import { useForegroundCheck } from '../hooks/useForegroundCheck'
import { newerBuildIsOut } from '../utils/appVersion'
import styles from './UpdateNotice.module.css'

/**
 * Says when a newer build is out. The home-screen app stays in memory for
 * days, running the code it was opened with; nothing else tells the user a
 * fix they are waiting for is already there. Checked on opening and each
 * time the app comes back to the foreground. Reloading is left to the user:
 * it would throw away whatever the page is in the middle of.
 */
export default function UpdateNotice() {
  const [available, setAvailable] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useForegroundCheck(available ? null : 'update', (_key, isStale) => {
    void newerBuildIsOut().then(newer => {
      if (newer && !isStale()) setAvailable(true)
    })
  })

  if (!available || dismissed) return null
  return (
    <div className={styles.notice} role="status">
      <span className={styles.text}>新しいバージョンがあります</span>
      <button className={styles.update} onClick={() => window.location.reload()}>
        更新する
      </button>
      <button className={styles.later} onClick={() => setDismissed(true)} aria-label="あとで">
        ✕
      </button>
    </div>
  )
}
