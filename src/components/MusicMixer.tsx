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
  // Bumped each time a new mix is scheduled (or the user skips), so an
  // in-flight mix's eventual result can be told apart from a newer request
  // superseding it. mixMusic uses one shared FFmpeg instance with fixed
  // filenames — two mixes running concurrently would corrupt each other's
  // files — but debouncing only cancels a *pending* timer, not a mix whose
  // FFmpeg call has already started. This guard doesn't prevent that overlap;
  // it ensures that whichever call finishes, only the result matching the
  // latest request is ever applied to state (a stale one is silently
  // discarded, not treated as an error and not further processed).
  const requestIdRef = useRef(0)

  useEffect(() => {
    return () => {
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      requestIdRef.current += 1
      void runMix(requestIdRef.current, selectedId, volume)
    }, DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, volume])

  if (MUSIC_TRACKS.length === 0) return null

  async function runMix(requestId: number, trackId: string, vol: number) {
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
      // A newer request (or a skip) has superseded this one — discard the
      // result quietly. Don't revoke any URL here: the newer/skip path
      // already owns URL lifecycle from this point on.
      if (requestIdRef.current !== requestId) return
      if (mixedUrlRef.current) URL.revokeObjectURL(mixedUrlRef.current)
      const url = URL.createObjectURL(mixed)
      mixedUrlRef.current = url
      setMixedUrl(url)
      setStage('done')
      onMixed(mixed)
    } catch (err) {
      // Same guard for the rejection path: a stale failure must not stomp a
      // newer request's in-progress or already-applied state.
      if (requestIdRef.current !== requestId) return
      const detail = err instanceof Error ? err.message : String(err)
      setErrorMessage(`「${track.title}」の合成に失敗しました: ${detail}`)
      setStage('error')
    }
  }

  function handleSkip() {
    // Bump the generation so any mix still in flight is ignored when it
    // eventually resolves — it must not silently re-add BGM after the user
    // has explicitly chosen to skip it.
    requestIdRef.current += 1
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
