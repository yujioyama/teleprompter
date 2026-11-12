import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import ClaudeInbox from '../components/ClaudeInbox'
import { listStoredShots, pruneRemovedShotVideos } from '../utils/shotVideoStore'
import type { Script } from '../types'
import styles from './HomePage.module.css'

// How long 元に戻す stays up before a deleted script is really deleted.
const UNDO_DELETE_MS = 6000

export default function HomePage() {
  const navigate = useNavigate()
  const { scripts, deleteScript } = useScripts()
  const [settings] = useSettings()
  const [scriptsWithVideos, setScriptsWithVideos] = useState<Set<string>>(new Set())

  // A script taken off the list by 🗑 but not deleted yet: its videos go
  // with it for good, so 元に戻す gets a few seconds first. It is deleted
  // when the toast runs out, another script is deleted, or the page is left.
  const [pendingDelete, setPendingDelete] = useState<Script | null>(null)
  const pendingRef = useRef<{ script: Script; timer: ReturnType<typeof setTimeout> } | null>(null)
  // The latest render's, for the timer and the unmount to delete with.
  const deleteScriptRef = useRef(deleteScript)
  deleteScriptRef.current = deleteScript

  function commitPendingDelete() {
    const pending = pendingRef.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingRef.current = null
    deleteScriptRef.current(pending.script.id)
  }

  function handleDelete(script: Script) {
    commitPendingDelete()
    const timer = setTimeout(() => {
      commitPendingDelete()
      setPendingDelete(null)
    }, UNDO_DELETE_MS)
    pendingRef.current = { script, timer }
    setPendingDelete(script)
  }

  function handleUndoDelete() {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer)
    pendingRef.current = null
    setPendingDelete(null)
  }

  useEffect(() => commitPendingDelete, [])

  const sorted = scripts
    .filter(script => script.id !== pendingDelete?.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

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
        scripts={scripts}
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
                onClick={() => handleDelete(script)}
                aria-label="削除"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <div className={styles.undoToast} role="status">
          <span className={styles.undoText}>「{pendingDelete.title}」を削除しました</span>
          <button className={styles.undoBtn} onClick={handleUndoDelete}>
            元に戻す
          </button>
        </div>
      )}
    </div>
  )
}
