import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import { splitShots, DEFAULT_SPLIT_OPTIONS, SplitOptions } from '../utils/splitShots'
import { reconcileShots } from '../utils/reconcileShots'
import { Shot } from '../types'
import styles from './ScriptEditPage.module.css'

const DRAFT_KEY = 'teleprompter_new_script_draft'

const NEW_SCRIPT_SPLIT_OPTIONS: SplitOptions = {
  period: false,
  exclamation: false,
  englishPeriod: false,
  newline: true,
}

function generateId() {
  return crypto.randomUUID()
}

interface Draft {
  title?: string
  body?: string
  caption?: string
}

function loadDraft(): Draft {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}

export default function ScriptEditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { createScript, updateScript, getScript } = useScripts()
  const [settings] = useSettings()

  const existingScript = id ? getScript(id) : undefined
  const isEdit = Boolean(existingScript)
  // A script sent from Claude chat, opened from Home's inbox section.
  const inboxItem = isEdit ? undefined : (location.state as { inboxItem?: InboxItem } | null)?.inboxItem

  const [initial] = useState(() => {
    if (existingScript) {
      return {
        title: existingScript.title,
        body: existingScript.shots.map(s => s.text).join('\n'),
        caption: existingScript.caption ?? '',
      }
    }
    if (inboxItem) return { title: inboxItem.title, body: inboxItem.body, caption: inboxItem.caption }
    const draft = loadDraft()
    return { title: draft.title ?? '', body: draft.body ?? '', caption: draft.caption ?? '' }
  })
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [caption, setCaption] = useState(initial.caption)
  const [preview, setPreview] = useState<string[]>(
    () => existingScript ? existingScript.shots.map(s => s.text) : []
  )
  const [splitOptions, setSplitOptions] = useState<SplitOptions>(
    () => existingScript ? DEFAULT_SPLIT_OPTIONS : NEW_SCRIPT_SPLIT_OPTIONS
  )

  // Grow the textarea to fit its content so a long pasted script is visible
  // in full, instead of hiding most of it in a small scroll box nested
  // inside the scrolling page.
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // Resetting the height briefly shortens the page, which would clamp and
    // jump the surrounding scroll position; restore it after measuring.
    const scroller = el.parentElement
    const scrollTop = scroller?.scrollTop ?? 0
    el.style.height = 'auto'
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
    }
    if (scroller) scroller.scrollTop = scrollTop
  }, [body])

  function saveDraft(next: Partial<Draft>) {
    if (!isEdit) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, caption, ...next }))
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

    if (existingScript) {
      const shots = reconcileShots(existingScript.shots, preview, generateId)
      updateScript(existingScript.id, { title: title.trim(), shots, caption: caption.trim() })
      navigate(`/scripts/${existingScript.id}/shots`)
    } else {
      const shots: Shot[] = preview.map(text => ({ id: generateId(), text }))
      const script = createScript(title.trim(), shots, caption.trim())
      clearDraft()
      if (inboxItem && settings.inboxKey) {
        // Taken: clear it from the inbox so no device offers it again. If
        // this fails the item just lingers until it expires.
        deleteInboxItem(settings.inboxKey, inboxItem.id)
          .catch(err => console.error('Failed to clear the inbox item', err))
      }
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
          onChange={e => { setTitle(e.target.value); saveDraft({ title: e.target.value }) }}
        />

        <label className={styles.label} htmlFor="script-body">スクリプト全文</label>
        <textarea
          id="script-body"
          ref={bodyRef}
          className={styles.textarea}
          placeholder="ここにスクリプトを入力または貼り付け..."
          value={body}
          onChange={e => {
            setBody(e.target.value)
            setPreview([])
            saveDraft({ body: e.target.value })
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

        <label className={styles.label} htmlFor="script-caption">キャプション（任意）</label>
        <textarea
          id="script-caption"
          className={`${styles.textarea} ${styles.captionTextarea}`}
          placeholder="TikTokに投稿するときのキャプション"
          value={caption}
          onChange={e => {
            setCaption(e.target.value)
            saveDraft({ caption: e.target.value })
          }}
          rows={4}
        />
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
