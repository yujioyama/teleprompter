import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { deleteInboxItem, type InboxItem } from '../utils/inbox'
import { splitShots, DEFAULT_SPLIT_OPTIONS, SplitOptions } from '../utils/splitShots'
import { reconcileShots } from '../utils/reconcileShots'
import { lineJapaneseOf, lineKey, takeLinesOf } from '../utils/subtitleCues'
import { assignToLines, lineImagesOf, reconcileLineImages } from '../utils/lineImages'
import { useLineImages } from '../hooks/useLineImages'
import LineImageEditor from '../components/LineImageEditor'
import { LineImage, Shot, type VideoType } from '../types'
import styles from './ScriptEditPage.module.css'

const DRAFT_KEY = 'teleprompter_new_script_draft'

const NEW_SCRIPT_SPLIT_OPTIONS: SplitOptions = {
  period: false,
  exclamation: false,
  englishPeriod: false,
  newline: true,
}

/**
 * Which of `lines` are 相手のセリフ, for a script Claude sent with some: by
 * line number while the lines are still as sent, else by their words (twin
 * lines take the marks in turn).
 */
function heardLinesOf(item: InboxItem | undefined, lines: string[]): boolean[] {
  if (!item?.heard?.length) return lines.map(() => false)
  const sent = takeLinesOf(item.body)
  const marked = new Set(item.heard)
  if (sent.length === lines.length && sent.every((line, i) => lineKey(line) === lineKey(lines[i]))) {
    return lines.map((_, i) => marked.has(i + 1))
  }
  const left = sent.filter((_, i) => marked.has(i + 1)).map(lineKey)
  return lines.map(line => {
    const at = left.indexOf(lineKey(line))
    if (at < 0) return false
    left.splice(at, 1)
    return true
  })
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
  // 一発撮り is the usual way to film now (2026-10-21), so new scripts start with it.
  // A script with 相手のセリフ is filmed line by line: the voice of such a line goes over its own listening take.
  const [oneTake, setOneTake] = useState<boolean>(() => existingScript ? Boolean(existingScript.oneTake) : !inboxItem?.heard?.length)
  // Type A/B only labels the video for the weekly comparison now (2026-11-05); Claude sends it with the script.
  const [videoType, setVideoType] = useState<VideoType | null>(
    () => (existingScript ? existingScript.videoType : inboxItem?.videoType) ?? null,
  )
  const [lineImages, setLineImages] = useState<LineImage[]>(() => {
    if (existingScript) return existingScript.lineImages ?? []
    return inboxItem?.images ? lineImagesOf(inboxItem.body, inboxItem.images) : []
  })
  const { stored: storedImages, loading: imagesLoading, retry: retryImages } = useLineImages(lineImages, settings.inboxKey)

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
    // An inbox item must not overwrite the hand-typed new-script draft.
    if (!isEdit && !inboxItem) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, caption, ...next }))
    }
  }

  function clearDraft() {
    sessionStorage.removeItem(DRAFT_KEY)
  }

  function handleSplit() {
    if (oneTake) {
      // One shot holding every line; each line becomes one subtitle.
      const lines = splitShots(body, NEW_SCRIPT_SPLIT_OPTIONS)
      setPreview(lines.length > 0 ? [lines.join('\n')] : [])
      // The images stay with their lines, wherever the edit put them.
      setLineImages(images => reconcileLineImages(images, lines))
      return
    }
    const segments = splitShots(body, splitOptions)
    setPreview(segments)
    setLineImages(images => reconcileLineImages(images, segments.flatMap(takeLinesOf)))
  }

  /** Put `image` on `line`, or take that line's away with null. */
  function setLineImage(line: string, old: LineImage | null, image: LineImage | null) {
    setLineImages(images => [...images.filter(i => i !== old), ...(image ? [{ ...image, en: line }] : [])])
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
      updateScript(existingScript.id, { title: title.trim(), shots, caption: caption.trim(), oneTake, videoType: videoType ?? undefined, lineImages })
      navigate(`/scripts/${existingScript.id}/shots`)
    } else {
      const heard = oneTake ? [] : heardLinesOf(inboxItem, preview)
      const speaker = inboxItem?.heardIcon ? { speaker: inboxItem.heardIcon } : {}
      const shots: Shot[] = preview.map((text, i) => ({ id: generateId(), text, ...(heard[i] ? { heard: true, ...speaker } : {}) }))
      // Kept against the lines as Claude sent them: edits made here just
      // leave those lines for the subtitle step's Claude用プロンプト.
      const japanese = inboxItem?.japanese ? lineJapaneseOf(inboxItem.body, inboxItem.japanese) : undefined
      const script = createScript(title.trim(), shots, caption.trim(), oneTake, japanese, videoType ?? undefined, lineImages)
      if (!inboxItem) clearDraft()
      if (inboxItem && settings.inboxKey) {
        // Taken: clear it from the inbox so no device offers it again. If
        // this fails the item just lingers until it expires.
        deleteInboxItem(settings.inboxKey, inboxItem.id)
          .catch(err => console.error('Failed to clear the inbox item', err))
      }
      // From the inbox, replace the /scripts/new entry: it carries the
      // consumed item in its state, and going back would reopen it
      // pre-filled and let it be saved a second time.
      navigate(`/scripts/${script.id}/shots`, { replace: Boolean(inboxItem) })
    }
  }

  const shownLines = preview.length === 0 ? [] : oneTake ? preview[0].split('\n') : preview
  const imageOfLine = assignToLines(lineImages, shownLines)

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

        <label className={styles.splitOptionItem}>
          <input
            type="checkbox"
            checked={oneTake}
            onChange={e => {
              setOneTake(e.target.checked)
              setPreview([])
            }}
          />
          一発撮り（最初から最後まで1回で撮る。字幕は1行ずつ自動で切り替え）
        </label>

        <div className={styles.splitOptions} role="group" aria-label="動画の型">
          <span className={styles.splitOptionsLabel}>動画の型（分析用の記録です。冒頭の演出は変わりません）</span>
          <div className={styles.splitOptionsList}>
            {([
              [null, 'なし'],
              ['A', 'A: 2021年型'],
              ['B', 'B: 表現ノート型'],
            ] as const).map(([value, label]) => (
              <label key={label} className={styles.splitOptionItem}>
                <input
                  type="radio"
                  name="videoType"
                  checked={videoType === value}
                  onChange={() => setVideoType(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {!oneTake && (
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
        )}

        <button className={styles.splitBtn} onClick={handleSplit}>
          {oneTake ? '行に分ける' : '自動分割する'}
        </button>

        {preview.length > 0 && (
          <div className={styles.preview}>
            <p className={styles.previewLabel}>
              {oneTake
                ? `一発撮り（字幕${preview[0].split('\n').length}行）`
                : `分割結果（${preview.length}ショット）`}
            </p>
            {lineImages.length > 0 && (
              <p className={styles.previewLabel}>画像がある台本なので、ステッカーと妖精は出ません</p>
            )}
            {shownLines.map((text, i) => (
              <div key={i} className={styles.previewItem}>
                <span className={styles.previewNum}>{i + 1}</span>
                <div className={styles.previewLine}>
                  <span className={styles.previewText}>{text}</span>
                  <LineImageEditor
                    line={text}
                    image={imageOfLine[i]}
                    stored={imageOfLine[i] ? storedImages.get(imageOfLine[i]!.imageId) : undefined}
                    loading={imagesLoading}
                    onChange={image => setLineImage(text, imageOfLine[i], image)}
                    onRetry={retryImages}
                  />
                </div>
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
