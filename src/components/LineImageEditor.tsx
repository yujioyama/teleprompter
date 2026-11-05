import { useRef, useState } from 'react'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { saveChosenImage } from '../utils/lineImageDownload'
import type { StoredLineImage } from '../utils/lineImages'
import type { LineImage } from '../types'
import styles from './LineImageEditor.module.css'

interface Props {
  /** The script line this is for. */
  line: string
  image: LineImage | null
  /** The image as this device has it. */
  stored?: StoredLineImage
  /** Still looking for it, on the device or the network. */
  loading: boolean
  onChange: (image: LineImage | null) => void
  onRetry: () => void
}

/** One script line's image: see it, change it, take it away, and say whose it is. */
export default function LineImageEditor({ line, image, stored, loading, onChange, onRetry }: Props) {
  const url = useObjectUrl(stored?.blob ?? null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function chooseFile(file: File | undefined) {
    if (!file) return
    setError(null)
    saveChosenImage(file).then(
      imageId => onChange({ en: line, imageId }),
      err => {
        console.warn('Could not keep the chosen picture', err)
        setError('この画像は読み込めませんでした')
      },
    )
  }

  function enterUrl() {
    const entered = window.prompt('画像のURL（https://…）')?.trim()
    if (!entered) return
    if (!entered.startsWith('https://')) {
      setError('https:// で始まるURLを入れてください')
      return
    }
    setError(null)
    onChange({ en: line, imageId: entered, url: entered })
  }

  return (
    <div className={styles.editor}>
      {image && (
        <div className={styles.picture}>
          {url ? (
            <img className={styles.thumb} src={url} alt={`${line} の画像`} />
          ) : loading ? (
            <span className={styles.status}>画像を読み込み中...</span>
          ) : (
            <span className={styles.status} role="alert">
              画像を取得できませんでした
              {image.url && (
                <button type="button" className={styles.btn} onClick={onRetry}>再試行</button>
              )}
            </span>
          )}
          <input
            className={styles.credit}
            type="text"
            placeholder="クレジット（例: 作者名 / CC BY 4.0。不要なら空欄）"
            aria-label={`${line} のクレジット`}
            maxLength={120}
            value={image.credit ?? ''}
            onChange={e => {
              const next: LineImage = { ...image, credit: e.target.value }
              if (!next.credit) delete next.credit
              onChange(next)
            }}
          />
        </div>
      )}
      <div className={styles.actions}>
        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept="image/*"
          aria-label={`${line} の画像を選ぶ`}
          onChange={e => {
            chooseFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button type="button" className={styles.btn} onClick={() => fileRef.current?.click()}>
          {image ? '写真で差し替え' : '＋ 写真'}
        </button>
        <button type="button" className={styles.btn} onClick={enterUrl}>
          {image ? 'URLで差し替え' : '＋ URL'}
        </button>
        {image && (
          <button type="button" className={styles.btn} onClick={() => onChange(null)}>画像を削除</button>
        )}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
