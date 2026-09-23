import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
}

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        return {
          shotId: shot.id,
          text: shot.text,
          blob,
          url: blob ? URL.createObjectURL(blob) : null,
        }
      })
      setEntries(next)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  // Revoke object URLs on unmount to avoid leaking memory
  useEffect(() => {
    return () => {
      entries.forEach(e => {
        if (e.url) URL.revokeObjectURL(e.url)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(`/scripts/${script.id}/record`)}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : (
        <div className={styles.shotList}>
          {entries.map((entry, i) => (
            <div key={entry.shotId} className={styles.shotEntry}>
              <p className={styles.shotEntryText}>{i + 1}. {entry.text}</p>
              {entry.url ? (
                <video className={styles.preview} src={entry.url} controls playsInline />
              ) : (
                <p className={styles.missing}>この ショットは保存された動画がありません</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
