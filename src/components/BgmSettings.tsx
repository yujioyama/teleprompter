import { GENRE_LABELS, GENRE_ORDER, MUSIC_TRACKS } from '../data/musicTracks'
import { useTrackPreview } from '../hooks/useTrackPreview'
import type { AppSettings } from '../hooks/useSettings'
import styles from './BgmSettings.module.css'

interface BgmSettingsProps {
  trackId: string | null
  volume: number
  onChange: (patch: Partial<Pick<AppSettings, 'defaultBgmId' | 'bgmVolume'>>) => void
}

export default function BgmSettings({ trackId, volume, onChange }: BgmSettingsProps) {
  const track = MUSIC_TRACKS.find(t => t.id === trackId) ?? null
  const { previewingId, toggle, stop } = useTrackPreview()
  const previewing = previewingId !== null && previewingId === track?.id

  return (
    <div className={styles.wrapper}>
      <div className={styles.field}>
        <div className={styles.label}>いつものBGM</div>
        <div className={styles.sub}>仕上げで自動的に付けます（動画ごとに変更も可）</div>
        <div className={styles.trackRow}>
          <select
            aria-label="いつものBGM"
            className={styles.select}
            value={track?.id ?? ''}
            onChange={e => {
              stop()
              onChange({ defaultBgmId: e.target.value || null })
            }}
          >
            <option value="">なし</option>
            {GENRE_ORDER.map(genre => (
              <optgroup key={genre} label={GENRE_LABELS[genre]}>
                {MUSIC_TRACKS.filter(t => t.genre === genre).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className={styles.previewBtn} onClick={() => track && toggle(track)} disabled={!track}>
            {previewing ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      </div>

      <div className={`${styles.field} ${!track ? styles.disabled : ''}`}>
        <div className={styles.header}>
          <span className={styles.label}>BGMの音量</span>
          <span className={styles.value}>{Math.round(volume * 100)}%</span>
        </div>
        <input
          aria-label="BGMの音量"
          className={styles.slider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!track}
          onChange={e => onChange({ bgmVolume: parseFloat(e.target.value) })}
        />
      </div>
    </div>
  )
}
