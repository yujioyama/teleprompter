import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import ClaudeInbox from '../components/ClaudeInbox'
import { listStoredShots, pruneRemovedShotVideos } from '../utils/shotVideoStore'
import styles from './HomePage.module.css'

export default function HomePage() {
  const navigate = useNavigate()
  const { scripts, deleteScript } = useScripts()
  const [settings] = useSettings()
  const [scriptsWithVideos, setScriptsWithVideos] = useState<Set<string>>(new Set())

  const sorted = [...scripts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  // Drop the videos of shots no longer in their script first (shot
  // editing's undo is gone once the user is back here), then find which
  // scripts have a video for 仕上げ — from the keys alone, without reading
  // any video.
  useEffect(() => {
    let cancelled = false
    pruneRemovedShotVideos(scripts)
      .catch(err => console.error('Failed to delete videos of removed shots', err))
      .then(() => listStoredShots())
      .then(stored => {
        if (cancelled) return
        setScriptsWithVideos(new Set(stored.map(v => v.scriptId)))
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to check for stored shot videos', err)
      })
    return () => {
      cancelled = true
    }
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

      <ClaudeInbox
        // A new key starts from an empty list, never one fetched with the old key.
        key={settings.inboxKey}
        inboxKey={settings.inboxKey}
        onOpen={item => navigate('/scripts/new', { state: { inboxItem: item } })}
      />

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
