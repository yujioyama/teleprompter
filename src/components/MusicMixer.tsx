import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import { shareOrDownload } from '../utils/shareOrDownload'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  filenameBase: string
}

type Stage = 'idle' | 'mixing' | 'done' | 'error'

export default function MusicMixer({ videoBlob, filenameBase }: MusicMixerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mixedUrl, setMixedUrl] = useState<string | null>(null)
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)
  const mixedUrlRef = useRef<string | null>(null)

  // Revoke the mixed-video preview object URL whenever it changes or on unmount
  useEffect(() => {
    return () => {
      if (mixedUrlRef.current) {
        URL.revokeObjectURL(mixedUrlRef.current)
      }
    }
  }, [])

  if (MUSIC_TRACKS.length === 0) return null

  async function handleMix() {
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (!track) return

    setStage('mixing')
    setErrorMessage(null)
    try {
      const trackBlob = await fetch(`/${track.file}`).then(r => r.blob())
      const mixed = await mixMusic(videoBlob, trackBlob, volume)
      if (mixedUrlRef.current) {
        URL.revokeObjectURL(mixedUrlRef.current)
      }
      const url = URL.createObjectURL(mixed)
      mixedUrlRef.current = url
      setMixedBlob(mixed)
      setMixedUrl(url)
      setStage('done')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  async function handleSave() {
    if (!mixedBlob) return
    await shareOrDownload(mixedBlob, `${filenameBase}-final`)
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>BGMを追加</p>
        <MusicPicker
          tracks={MUSIC_TRACKS}
          selectedId={selectedId}
          onSelect={setSelectedId}
          volume={volume}
          onVolumeChange={setVolume}
        />
        <button
          className={styles.mixBtn}
          onClick={handleMix}
          disabled={!selectedId || stage === 'mixing'}
        >
          {stage === 'mixing' ? '合成中...' : 'BGMを合成する'}
        </button>
        {stage === 'error' && errorMessage && <p className={styles.error}>エラーが発生しました: {errorMessage}</p>}
      </div>

      {stage === 'done' && mixedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>完成した動画</p>
          <video className={styles.preview} src={mixedUrl} controls playsInline />
          <button className={styles.mixBtn} onClick={handleSave}>
            保存する
          </button>
        </div>
      )}
    </div>
  )
}
