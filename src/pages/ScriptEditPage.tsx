import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { splitShots, DEFAULT_SPLIT_OPTIONS, SplitOptions } from '../utils/splitShots'
import { Shot } from '../types'
import styles from './ScriptEditPage.module.css'

const DRAFT_KEY = 'teleprompter_new_script_draft'

function generateId() {
  return crypto.randomUUID()
}

export default function ScriptEditPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { createScript, updateScript, getScript } = useScripts()

  const existingScript = id ? getScript(id) : undefined
  const isEdit = Boolean(existingScript)

  const [title, setTitle] = useState(() => {
    if (existingScript) return existingScript.title
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}').title ?? '' } catch { return '' }
  })
  const [body, setBody] = useState(() => {
    if (existingScript) return existingScript.shots.map(s => s.text).join('\n')
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}').body ?? '' } catch { return '' }
  })
  const [preview, setPreview] = useState<string[]>(
    () => existingScript ? existingScript.shots.map(s => s.text) : []
  )
  const [splitOptions, setSplitOptions] = useState<SplitOptions>(DEFAULT_SPLIT_OPTIONS)

  function saveDraft(nextTitle: string, nextBody: string) {
    if (!isEdit) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: nextTitle, body: nextBody }))
    }
  }

  function clearDraft() {
    sessionStorage.removeItem(DRAFT_KEY)
  }

  function handleSplit() {
    const segments = splitShots(body, splitOptions)
    setPreview(segments)
  }

  function handleNext() {
    if (!title.trim()) {
      alert('タイトルを入力してください')
      return
    }
    if (preview.length === 0) {
      alert('テキストを入力して「自動分割」してください')
      return
    }

    const shots: Shot[] = preview.map(text => ({ id: generateId(), text }))

    if (isEdit && id) {
      updateScript(id, { title: title.trim(), shots })
      navigate(`/scripts/${id}/shots`)
    } else {
      const script = createScript(title.trim(), shots)
      clearDraft()
      navigate(`/scripts/${script.id}/shots`)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>
          {isEdit ? 'スクリプト編集' : '新規スクリプト'}
        </h1>
      </header>

      <div className={styles.body}>
        <label className={styles.label} htmlFor="script-title">タイトル</label>
        <input
          id="script-title"
          className={styles.titleInput}
          type="text"
          placeholder="例：商品紹介動画"
          value={title}
          onChange={e => { setTitle(e.target.value); saveDraft(e.target.value, body) }}
        />

        <label className={styles.label} htmlFor="script-body">スクリプト全文</label>
        <textarea
          id="script-body"
          className={styles.textarea}
          placeholder="ここにスクリプトを入力または貼り付け..."
          value={body}
          onChange={e => {
            setBody(e.target.value)
            setPreview([])
            saveDraft(title, e.target.value)
          }}
          rows={8}
        />

        <div className={styles.splitOptions}>
          <span className={styles.splitOptionsLabel}>区切り単位</span>
          <div className={styles.splitOptionsList}>
            {([
              ['period', '句点（。）'],
              ['exclamation', '感嘆・疑問符（！？）'],
              ['englishPeriod', '英語ピリオド（.）'],
              ['newline', '改行'],
            ] as const).map(([key, label]) => (
              <label key={key} className={styles.splitOptionItem}>
                <input
                  type="checkbox"
                  checked={splitOptions[key]}
                  onChange={e => setSplitOptions(o => ({ ...o, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button className={styles.splitBtn} onClick={handleSplit}>
          自動分割する
        </button>

        {preview.length > 0 && (
          <div className={styles.preview}>
            <p className={styles.previewLabel}>
              分割結果（{preview.length}ショット）
            </p>
            {preview.map((text, i) => (
              <div key={i} className={styles.previewItem}>
                <span className={styles.previewNum}>{i + 1}</span>
                <span className={styles.previewText}>{text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button
          className={styles.nextBtn}
          onClick={handleNext}
          disabled={preview.length === 0}
        >
          編集へ進む →
        </button>
      </div>
    </div>
  )
}
