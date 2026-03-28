import { useNavigate } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import styles from './HomePage.module.css'

export default function HomePage() {
  const navigate = useNavigate()
  const { scripts, deleteScript } = useScripts()

  const sorted = [...scripts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

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
