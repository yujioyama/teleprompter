import { useRef, useState } from 'react'
import { MusicTrack, GENRE_LABELS, MusicGenre } from '../data/musicTracks'
import styles from './MusicPicker.module.css'

interface MusicPickerProps {
  tracks: MusicTrack[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  volume: number
  onVolumeChange: (volume: number) => void
}

const GENRE_ORDER: MusicGenre[] = ['lofi', 'pop', 'cinematic', 'corporate']

export default function MusicPicker({ tracks, selectedId, onSelect, volume, onVolumeChange }: MusicPickerProps) {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [genre, setGenre] = useState<MusicGenre>(
    () => GENRE_ORDER.find(g => tracks.some(t => t.genre === g)) ?? GENRE_ORDER[0]
  )
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handlePreview(track: MusicTrack) {
    if (previewingId === track.id) {
      audioRef.current?.pause()
      setPreviewingId(null)
      return
    }
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => setPreviewingId(null))
    }
    audioRef.current.src = `/${track.file}`
    audioRef.current.play()
    setPreviewingId(track.id)
  }

  function handleGenreChange(next: MusicGenre) {
    setGenre(next)
    onSelect(null)
  }

  const genreTracks = tracks.filter(t => t.genre === genre)

  return (
    <div className={styles.wrapper}>
      <label className={styles.genreRow}>
        <span className={styles.genreRowLabel}>ジャンル</span>
        <select
          aria-label="ジャンル"
          className={styles.genreSelect}
          value={genre}
          onChange={e => handleGenreChange(e.target.value as MusicGenre)}
        >
          {GENRE_ORDER.filter(g => tracks.some(t => t.genre === g)).map(g => (
            <option key={g} value={g}>
              {GENRE_LABELS[g]}
            </option>
          ))}
        </select>
      </label>

      {genreTracks.map(track => (
        <div
          key={track.id}
          className={`${styles.trackRow} ${selectedId === track.id ? styles.trackRowSelected : ''}`}
        >
          <button className={styles.trackTitle} onClick={() => onSelect(track.id)}>
            {track.title}
          </button>
          <button className={styles.previewBtn} onClick={() => handlePreview(track)}>
            {previewingId === track.id ? '■ 停止' : '▶ 試聴'}
          </button>
        </div>
      ))}

      <div className={styles.volumeRow}>
        <span className={styles.volumeLabel}>音量 {Math.round(volume * 100)}%</span>
        <input
          className={styles.volumeSlider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}
