import { useRef } from 'react'
import { useObjectUrl } from '../hooks/useObjectUrl'
import type { AppSettings } from '../hooks/useSettings'
import { MAX_COVER_FRAMES, MIN_COVER_FRAMES, type CoverFramePlacement, type CoverFrameSource } from '../utils/coverFrames'
import styles from './CoverFrameSettings.module.css'

const PLACEMENTS: { value: CoverFramePlacement; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'first', label: '最初' },
  { value: 'last', label: '最後' },
]

const SOURCES: { value: CoverFrameSource; label: string }[] = [
  { value: 'made', label: '作ったカバー' },
  { value: 'picked', label: '選んだ画像' },
]

const COUNTS = Array.from({ length: MAX_COVER_FRAMES - MIN_COVER_FRAMES + 1 }, (_, i) => MIN_COVER_FRAMES + i)

interface Props {
  source: CoverFrameSource
  /** The cover カバー画像を作る drew last; null until it has been opened. */
  madeCover: Blob | null
  /** The cover image picked for this video; not kept between visits. */
  image: File | null
  onImageChange: (image: File | null) => void
  placement: CoverFramePlacement
  count: number
  onChange: (
    patch: Partial<Pick<AppSettings, 'coverFrameSource' | 'coverFramePlacement' | 'coverFrameCount'>>,
  ) => void
}

/**
 * The export's カバー画像 settings: the cover made with カバー画像を作る, or
 * an image made elsewhere, put into the video as frames of its own at its
 * start or its end (see insertCoverFrames). Which image, where and how many
 * frames are remembered for the next video; a picked image is picked each time.
 */
export default function CoverFrameSettings({
  source,
  madeCover,
  image,
  onImageChange,
  placement,
  count,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const made = source === 'made'
  const thumbUrl = useObjectUrl(made ? madeCover : image)
  const off = placement === 'none'

  return (
    <div className={styles.wrapper}>
      <div className={styles.label}>カバー画像を動画に入れる</div>
      <div className={styles.sub}>SNSのサムネイル用。カバーのコマの間は無音で、声と字幕はそのぶん後ろにずれます</div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>使う画像</span>
        <div className={styles.presets} role="group" aria-label="使う画像">
          {SOURCES.map(s => (
            <button
              key={s.value}
              type="button"
              className={`${styles.presetBtn} ${source === s.value ? styles.presetBtnActive : ''}`}
              aria-pressed={source === s.value}
              onClick={() => onChange({ coverFrameSource: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {made ? (
        <div className={styles.imageRow}>
          {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="作ったカバー" />}
          <p className={styles.sub}>
            {madeCover
              ? '「カバー画像を作る」のカバーが入ります。直すと入れ直します'
              : '下の「カバー画像を作る」を開くと、そのカバーが入ります'}
          </p>
        </div>
      ) : (
        <div className={styles.imageRow}>
          {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="選んだカバー画像" />}
          <button type="button" className={styles.pickBtn} onClick={() => inputRef.current?.click()}>
            {image ? '画像を選び直す' : 'カバー画像を選ぶ'}
          </button>
          {image && (
            <button type="button" className={styles.clearBtn} onClick={() => onImageChange(null)}>
              外す
            </button>
          )}
          <input
            ref={inputRef}
            aria-label="カバー画像"
            className={styles.fileInput}
            type="file"
            accept="image/png,image/jpeg"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) onImageChange(file)
              // Picking the same file again should still count as a pick.
              e.target.value = ''
            }}
          />
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>入れる位置</span>
        <div className={styles.presets} role="group" aria-label="入れる位置">
          {PLACEMENTS.map(p => (
            <button
              key={p.value}
              type="button"
              className={`${styles.presetBtn} ${placement === p.value ? styles.presetBtnActive : ''}`}
              aria-pressed={placement === p.value}
              onClick={() => onChange({ coverFramePlacement: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className={`${styles.field} ${off ? styles.disabled : ''}`}>
        <span className={styles.fieldLabel}>コマ数</span>
        <select
          aria-label="コマ数"
          className={styles.select}
          value={count}
          disabled={off}
          onChange={e => onChange({ coverFrameCount: Number(e.target.value) })}
        >
          {COUNTS.map(n => (
            <option key={n} value={n}>
              {n}コマ
            </option>
          ))}
        </select>
      </label>

      {!off && !made && !image && <p className={styles.sub}>画像を選ぶと動画に入ります</p>}
    </div>
  )
}
