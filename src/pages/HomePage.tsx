import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import styles from './HomePage.module.css'

export default function HomePage() {
  const navigate = useNavigate()
  const { scripts, deleteScript } = useScripts()
  const [scriptsWithVideos, setScriptsWithVideos] = useState<Set<string>>(new Set())

  const sorted = [...scripts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  // Small personal app with few scripts — one IndexedDB query per script on
  // mount is acceptable to find which ones have a Finalize entry point.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      scripts.map(async script => {
        const stored = await listShotVideos(script.id)
        return stored.length > 0 ? script.id : null
      })
    ).then(ids => {
      if (cancelled) return
      setScriptsWithVideos(new Set(ids.filter((id): id is string => id !== null)))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>🎬 Teleprompter</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.settingsBtn}
            onClick={() => navigate('/settings')}
            aria-label="設定"
          >
            ⚙
          </button>
          <button
            className={styles.newBtn}
            onClick={() => navigate('/scripts/new')}
          >
            ＋ 新規
          </button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className={styles.empty}>
          <p>スクリプトがありません</p>
          <button
            className={styles.emptyBtn}
            onClick={() => navigate('/scripts/new')}
          >
            最初のスクリプトを作成
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {sorted.map(script => (
            <li key={script.id} className={styles.item}>
              <button
                className={styles.itemMain}
                onClick={() => navigate(`/scripts/${script.id}/shots`)}
              >
                <span className={styles.itemTitle}>{script.title}</span>
                <span className={styles.itemMeta}>
                  {script.shots.length}ショット ·{' '}
                  {new Date(script.updatedAt).toLocaleDateString('ja-JP')}
                </span>
              </button>
              {scriptsWithVideos.has(script.id) && (
                <button
                  className={styles.finalizeBtn}
                  onClick={() => navigate(`/scripts/${script.id}/finalize`)}
                  aria-label="動画を仕上げる"
                >
                  🎬
                </button>
              )}
              <button
                className={styles.deleteBtn}
                onClick={() => {
                  if (confirm(`「${script.title}」を削除しますか？`)) {
                    deleteScript(script.id)
                  }
                }}
                aria-label="削除"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
