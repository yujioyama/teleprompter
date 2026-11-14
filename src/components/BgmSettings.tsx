import { GENRE_LABELS, GENRE_ORDER, MUSIC_TRACKS } from '../data/musicTracks'
import { useTrackPreview } from '../hooks/useTrackPreview'
import { youtubeBgmTrack, type AppSettings } from '../hooks/useSettings'
import styles from './BgmSettings.module.css'

interface BgmSettingsProps {
  trackId: string | null
  /** The usual BGM of a conversation (a script with 相手のセリフ). */
  conversationTrackId: string | null
  volume: number
  stopBeforePunchline: boolean
  /** The YouTube version's BGM (see youtubeBgmTrack). */
  youtubeTrackId: string
  /** The YouTube version's BGM for a conversation. */
  conversationYoutubeTrackId: string
  onChange: (
    patch: Partial<Pick<AppSettings, 'defaultBgmId' | 'conversationBgmId' | 'bgmVolume' | 'bgmStopBeforePunchline' | 'youtubeBgmId' | 'conversationYoutubeBgmId'>>,
  ) => void
}

function TrackOptions() {
  return GENRE_ORDER.map(genre => (
    <optgroup key={genre} label={GENRE_LABELS[genre]}>
      {MUSIC_TRACKS.filter(t => t.genre === genre).map(t => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </optgroup>
  ))
}

export default function BgmSettings({ trackId, conversationTrackId, volume, stopBeforePunchline, youtubeTrackId, conversationYoutubeTrackId, onChange }: BgmSettingsProps) {
  const track = MUSIC_TRACKS.find(t => t.id === trackId) ?? null
  const youtubeTrack = youtubeBgmTrack({ youtubeBgmId: youtubeTrackId })
  const { previewingId, toggle, stop } = useTrackPreview()
  const previewing = previewingId !== null && previewingId === track?.id
  const previewingYoutube = previewingId === youtubeTrack.id
  const conversationYoutubeTrack = youtubeBgmTrack({ youtubeBgmId: youtubeTrackId, conversationYoutubeBgmId: conversationYoutubeTrackId }, true)
  const previewingConversationYoutube = previewingId === conversationYoutubeTrack.id
  const conversationTrack = MUSIC_TRACKS.find(t => t.id === conversationTrackId) ?? null
  const previewingConversation = previewingId !== null && previewingId === conversationTrack?.id

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
            <TrackOptions />
          </select>
          <button type="button" className={styles.previewBtn} onClick={() => track && toggle(track)} disabled={!track}>
            {previewing ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>会話形式のBGM</div>
        <div className={styles.sub}>相手のセリフがある台本では、いつものBGMの代わりにこの曲を付けます</div>
        <div className={styles.trackRow}>
          <select
            aria-label="会話形式のBGM"
            className={styles.select}
            value={conversationTrack?.id ?? ''}
            onChange={e => {
              stop()
              onChange({ conversationBgmId: e.target.value || null })
            }}
          >
            <option value="">なし</option>
            <TrackOptions />
          </select>
          <button
            type="button"
            aria-label={previewingConversation ? '会話形式のBGMの試聴を止める' : '会話形式のBGMを試聴'}
            className={styles.previewBtn}
            onClick={() => conversationTrack && toggle(conversationTrack)}
            disabled={!conversationTrack}
          >
            {previewingConversation ? '■ 停止' : '▶ 試聴'}
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

      <div className={`${styles.field} ${!track ? styles.disabled : ''}`}>
        <label className={styles.header}>
          <span className={styles.label}>オチの直前でBGMを止める</span>
          <input
            aria-label="オチの直前でBGMを止める"
            type="checkbox"
            checked={stopBeforePunchline}
            disabled={!track}
            onChange={e => onChange({ bgmStopBeforePunchline: e.target.checked })}
          />
        </label>
        <div className={styles.sub}>最後のショットの手前でBGMがふっと消え、最後の一言は無音になります</div>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>YouTube用のBGM</div>
        <div className={styles.sub}>
          仕上げで「YouTube用も書き出す」をオンにしたとき、BGMをこの曲に差し替えます（音量と終わり方はいつもと同じ）
        </div>
        <div className={styles.trackRow}>
          <select
            aria-label="YouTube用のBGM"
            className={styles.select}
            value={youtubeTrack.id}
            onChange={e => {
              stop()
              onChange({ youtubeBgmId: e.target.value })
            }}
          >
            <TrackOptions />
          </select>
          <button
            type="button"
            aria-label={previewingYoutube ? 'YouTube用のBGMの試聴を止める' : 'YouTube用のBGMを試聴'}
            className={styles.previewBtn}
            onClick={() => toggle(youtubeTrack)}
          >
            {previewingYoutube ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>YouTube用のBGM（会話形式）</div>
        <div className={styles.sub}>相手のセリフがある台本のYouTube版は、この曲に差し替えます</div>
        <div className={styles.trackRow}>
          <select
            aria-label="YouTube用のBGM（会話形式）"
            className={styles.select}
            value={conversationYoutubeTrack.id}
            onChange={e => {
              stop()
              onChange({ conversationYoutubeBgmId: e.target.value })
            }}
          >
            <TrackOptions />
          </select>
          <button
            type="button"
            aria-label={previewingConversationYoutube ? 'YouTube用のBGM（会話形式）の試聴を止める' : 'YouTube用のBGM（会話形式）を試聴'}
            className={styles.previewBtn}
            onClick={() => toggle(conversationYoutubeTrack)}
          >
            {previewingConversationYoutube ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      </div>
    </div>
  )
}
