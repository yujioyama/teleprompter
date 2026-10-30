import type { AppSettings } from '../hooks/useSettings'
import type { YoutubeExportState } from '../hooks/useYoutubeExport'
import styles from './YoutubeExportSettings.module.css'

interface Props {
  enabled: boolean
  /** The BGM the YouTube version gets (設定 › BGM). */
  trackTitle: string
  /** Whether the normal version has a BGM to swap. */
  hasBgm: boolean
  state: YoutubeExportState
  onChange: (patch: Partial<Pick<AppSettings, 'youtubeExportEnabled'>>) => void
}

/**
 * The export's YouTube用も書き出す switch: saving then hands over a second
 * video, with the YouTube BGM in place of the usual one and no cover frames.
 * Remembered for the next video.
 */
export default function YoutubeExportSettings({ enabled, trackTitle, hasBgm, state, onChange }: Props) {
  return (
    <div className={styles.wrapper}>
      <label className={styles.header}>
        <span className={styles.label}>YouTube用も書き出す</span>
        <input
          aria-label="YouTube用も書き出す"
          type="checkbox"
          checked={enabled}
          onChange={e => onChange({ youtubeExportEnabled: e.target.checked })}
        />
      </label>
      <div className={styles.sub}>
        {hasBgm
          ? `BGMを「${trackTitle}」に差し替え、カバーのコマを入れない版も一緒に保存します（曲は設定 › BGMで変更）`
          : 'BGMなしの動画なので、YouTube用はカバーのコマを入れないだけの版になります'}
      </div>
      {enabled && state === 'making' && <p className={styles.status}>YouTube用を作っています...</p>}
      {enabled && state === 'failed' && (
        <p className={styles.status}>YouTube用を作れなかったため、通常版だけ保存されます</p>
      )}
    </div>
  )
}
