import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { trimAndNormalizeShot } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { shareOrDownload } from '../utils/shareOrDownload'
import ShotTrimmer from '../components/ShotTrimmer'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
  duration: number
  trimStart: number
  trimEnd: number
}

type CombineState = 'idle' | 'combining' | 'done' | 'error'

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const urlsRef = useRef<string[]>([])
  const combinedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) {
          urlsRef.current.push(url)
        }
        return {
          shotId: shot.id,
          text: shot.text,
          blob,
          url,
          duration: 0,
          trimStart: 0,
          trimEnd: 0,
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

  // Revoke shot object URLs on unmount to avoid leaking memory
  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Revoke the combined-preview object URL whenever it changes or on unmount
  useEffect(() => {
    return () => {
      if (combinedUrlRef.current) {
        URL.revokeObjectURL(combinedUrlRef.current)
      }
    }
  }, [])

  function updateEntry(shotId: string, changes: Partial<ShotEntry>) {
    setEntries(prev => prev.map(e => (e.shotId === shotId ? { ...e, ...changes } : e)))
  }

  const availableEntries = entries.filter(e => e.blob)
  const canCombine = availableEntries.length > 0 && availableEntries.every(e => e.duration > 0)

  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    try {
      const normalized: Blob[] = []
      for (const entry of availableEntries) {
        const trimmed = await trimAndNormalizeShot(entry.blob!, entry.trimStart, entry.trimEnd || entry.duration)
        normalized.push(trimmed)
      }
      const combined = await concatVideos(normalized)
      if (combinedUrlRef.current) {
        URL.revokeObjectURL(combinedUrlRef.current)
      }
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }

  async function handleSaveCombined() {
    if (!combinedBlob || !script) return
    await shareOrDownload(combinedBlob, `${script.title}-combined`)
  }

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
        <button className={styles.backBtn} onClick={() => navigate(`/scripts/${script.id}/shots`)}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : (
        <>
          <div className={styles.shotList}>
            {entries.map((entry, i) => {
              const next = entries[i + 1]
              return (
                <div key={entry.shotId} className={styles.shotEntry}>
                  <p className={styles.shotEntryText}>{i + 1}. {entry.text}</p>
                  {entry.url ? (
                    <ShotTrimmer
                      url={entry.url}
                      nextUrl={next?.url ?? null}
                      duration={entry.duration}
                      trimStart={entry.trimStart}
                      trimEnd={entry.trimEnd || entry.duration}
                      onDurationKnown={duration =>
                        updateEntry(entry.shotId, { duration, trimEnd: duration })
                      }
                      onChange={(trimStart, trimEnd) => updateEntry(entry.shotId, { trimStart, trimEnd })}
                    />
                  ) : (
                    <p className={styles.missing}>このショットは保存された動画がありません</p>
                  )}
                </div>
              )
            })}
          </div>

          <button
            className={styles.finalizeBtn}
            onClick={handleCombine}
            disabled={!canCombine || combineState === 'combining'}
          >
            {combineState === 'combining' ? '結合中...' : '結合する'}
          </button>

          {combineState === 'error' && (
            <p className={styles.missing}>結合に失敗しました: {combineError}</p>
          )}

          {combineState === 'done' && combinedUrl && (
            <div className={styles.shotEntry}>
              <p className={styles.shotEntryText}>結合結果</p>
              <video className={styles.preview} src={combinedUrl} controls playsInline />
              <button className={styles.finalizeBtn} onClick={handleSaveCombined}>
                保存する
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
