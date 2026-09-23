import { useRef, useState } from 'react'
import { MusicTrack, GENRE_LABELS, MusicGenre } from '../data/musicTracks'
import styles from './MusicPicker.module.css'

interface MusicPickerProps {
  tracks: MusicTrack[]
  selectedId: string | null
  onSelect: (id: string) => void
  volume: number
  onVolumeChange: (volume: number) => void
}

const GENRE_ORDER: MusicGenre[] = ['lofi', 'pop', 'cinematic', 'corporate']

export default function MusicPicker({ tracks, selectedId, onSelect, volume, onVolumeChange }: MusicPickerProps) {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
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

  return (
    <div className={styles.wrapper}>
      {GENRE_ORDER.map(genre => {
        const genreTracks = tracks.filter(t => t.genre === genre)
        if (genreTracks.length === 0) return null
        return (
          <div key={genre} className={styles.genreGroup}>
            <p className={styles.genreLabel}>{GENRE_LABELS[genre]}</p>
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
          </div>
        )
      })}

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
