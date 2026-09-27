import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import { BgmPreview } from '../utils/bgmPreview'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  onMixed: (blob: Blob | null) => void
  onNext: () => void
}

type Stage = 'idle' | 'mixing' | 'error'

// Each track's file, fetched once per session and shared by the live
// preview and the real mix.
const trackBlobs = new Map<string, Promise<Blob>>()

function fetchTrack(track: MusicTrack): Promise<Blob> {
  let blob = trackBlobs.get(track.id)
  if (!blob) {
    blob = fetch(`/${track.file}`).then(response => {
      if (!response.ok) throw new Error(`「${track.title}」の読み込みに失敗しました`)
      return response.blob()
    })
    trackBlobs.set(track.id, blob)
    blob.catch(() => trackBlobs.delete(track.id))
  }
  return blob
}

export default function MusicMixer({ videoBlob, onMixed, onNext }: MusicMixerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.3)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<BgmPreview | null>(null)
  // Bumped when the component unmounts or the user skips, so a mix still
  // running then is discarded instead of re-adding BGM afterwards.
  const requestIdRef = useRef(0)

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  // Created and revoked in the same effect so StrictMode's simulated
  // remount never leaves the player on a revoked URL (see SubtitleWorkflow).
  useEffect(() => {
    const url = URL.createObjectURL(videoBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [videoBlob])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const preview = new BgmPreview(video)
    previewRef.current = preview
    return () => {
      preview.dispose()
      previewRef.current = null
    }
  }, [])

  useEffect(() => {
    previewRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (!track) {
      void preview.setTrack(null)
      return
    }
    let cancelled = false
    fetchTrack(track).then(
      blob => {
        if (!cancelled) void preview.setTrack(blob)
      },
      err => console.warn('[MusicMixer] could not load the track for preview:', err),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId])

  if (MUSIC_TRACKS.length === 0) return null

  function handleSelect(id: string | null) {
    // A tap: the only moment iOS lets the preview's audio start.
    previewRef.current?.unlock()
    setSelectedId(id)
    setErrorMessage(null)
    if (stage === 'error') setStage('idle')
  }

  async function handleNext() {
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (!track) return
    videoRef.current?.pause()
    const requestId = ++requestIdRef.current
    setStage('mixing')
    setErrorMessage(null)
    try {
      const mixed = await mixMusic(videoBlob, await fetchTrack(track), volume)
      if (requestIdRef.current !== requestId) return
      onMixed(mixed)
      onNext()
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      const detail = err instanceof Error ? err.message : String(err)
      setErrorMessage(`「${track.title}」の合成に失敗しました: ${detail}`)
      setStage('error')
    }
  }

  function handleSkip() {
    requestIdRef.current += 1
    videoRef.current?.pause()
    onMixed(null)
    onNext()
  }

  const mixing = stage === 'mixing'

  return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>BGMを追加</p>
        <MusicPicker
          tracks={MUSIC_TRACKS}
          selectedId={selectedId}
          onSelect={handleSelect}
          volume={volume}
          onVolumeChange={setVolume}
        />
        {stage === 'error' && errorMessage && <p className={styles.error}>{errorMessage}</p>}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>プレビュー</p>
        <video
          ref={videoRef}
          className={styles.preview}
          src={previewUrl ?? undefined}
          controls={!mixing}
          playsInline
        />
        {selectedId && <p className={styles.status}>再生するとBGMを重ねて確認できます</p>}
      </div>

      <div className={styles.actions}>
        {/* Left enabled while mixing, to give up on a slow mix. */}
        <button className={styles.skipBtn} onClick={handleSkip}>
          BGMなしで進む
        </button>
        <button className={styles.mixBtn} onClick={handleNext} disabled={!selectedId || mixing}>
          {mixing ? 'BGMを合成中...' : '次へ'}
        </button>
      </div>
    </div>
  )
}
