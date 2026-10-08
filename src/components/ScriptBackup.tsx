import { useRef, useState } from 'react'
import { useScripts } from '../hooks/useScripts'
import { parseBackup, serializeBackup, type MergeResult } from '../utils/scriptBackup'
import { shareOrDownload } from '../utils/shareOrDownload'
import styles from './ScriptBackup.module.css'

function importMessage({ added, updated }: Omit<MergeResult, 'scripts'>): string {
  const parts = [added > 0 && `${added}件を追加`, updated > 0 && `${updated}件を更新`].filter(Boolean)
  return parts.length > 0 ? `${parts.join('、')}しました` : '新しいスクリプトはありませんでした'
}

/** Write the scripts to a file, or bring them back from one. */
export default function ScriptBackup() {
  const { scripts, importScripts } = useScripts()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setMessage(null)
    setError(null)
    const blob = new Blob([serializeBackup(scripts)], { type: 'application/json' })
    const date = new Date().toISOString().slice(0, 10)
    await shareOrDownload(blob, `teleprompter-scripts-${date}`)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow choosing the same file again
    if (!file) return
    setMessage(null)
    setError(null)
    const parsed = parseBackup(await file.text())
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setMessage(importMessage(importScripts(parsed.scripts)))
  }

  return (
    <div>
      <div className={styles.sub}>
        {'スクリプト（タイトルとショット）をファイルに書き出し、あとで読み込めます。撮影した動画は含まれません。' +
          '読み込むと新しいスクリプトは追加され、同じスクリプトは新しい方が残ります。'}
      </div>
      <div className={styles.buttons}>
        <button type="button" className={styles.btn} onClick={handleExport} disabled={scripts.length === 0}>
          スクリプトを書き出す
        </button>
        <button type="button" className={styles.btn} onClick={() => inputRef.current?.click()}>
          バックアップから読み込む
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label="バックアップファイルを選ぶ"
          className={styles.hiddenInput}
          onChange={handleImport}
        />
      </div>
      {message && <p className={styles.message} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
