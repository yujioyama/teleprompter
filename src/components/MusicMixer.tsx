import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  onMixed: (blob: Blob | null) => void
  onNext: () => void
}

type Stage = 'idle' | 'mixing' | 'done' | 'error'

const DEBOUNCE_MS = 300

export default function MusicMixer({ videoBlob, onMixed, onNext }: MusicMixerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mixedUrl, setMixedUrl] = useState<string | null>(null)
  const mixedUrlRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runMix(selectedId, volume)
    }, DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, volume])

  if (MUSIC_TRACKS.length === 0) return null

  async function runMix(trackId: string, vol: number) {
    const track = MUSIC_TRACKS.find(t => t.id === trackId)
    if (!track) return

    setStage('mixing')
    setErrorMessage(null)
    try {
      const trackResponse = await fetch(`/${track.file}`)
      if (!trackResponse.ok) {
        throw new Error(`「${track.title}」の合成に失敗しました: ファイルの読み込みエラー`)
      }
      const trackBlob = await trackResponse.blob()
      const mixed = await mixMusic(videoBlob, trackBlob, vol)
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      const url = URL.createObjectURL(mixed)
      mixedUrlRef.current = url
      setMixedUrl(url)
      setStage('done')
      onMixed(mixed)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setErrorMessage(`「${track.title}」の合成に失敗しました: ${detail}`)
      setStage('error')
    }
  }

  function handleSkip() {
    onMixed(null)
    onNext()
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
        {stage === 'mixing' && <p className={styles.status}>プレビュー更新中...</p>}
        {stage === 'error' && errorMessage && <p className={styles.error}>{errorMessage}</p>}
      </div>

      {stage === 'done' && mixedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>プレビュー</p>
          <video className={styles.preview} src={mixedUrl} controls playsInline />
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.skipBtn} onClick={handleSkip}>
          BGMなしで進む
        </button>
        <button className={styles.mixBtn} onClick={onNext} disabled={stage !== 'done'}>
          次へ
        </button>
      </div>
    </div>
  )
}
