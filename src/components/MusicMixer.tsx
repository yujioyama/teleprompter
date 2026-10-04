import { useEffect, useRef, useState } from 'react'
import { MUSIC_TRACKS, MusicTrack } from '../data/musicTracks'
import { mixMusic } from '../utils/mixMusic'
import { fetchTrack } from '../utils/fetchTrack'
import { BgmPreview } from '../utils/bgmPreview'
import MusicPicker from './MusicPicker'
import styles from './MusicMixer.module.css'

interface MusicMixerProps {
  videoBlob: Blob
  onMixed: (blob: Blob | null) => void
  onNext: () => void
  /** Track and volume the picker opens with: the usual BGM from settings. */
  initialTrackId?: string | null
  initialVolume?: number
  /** Mix the initial track straight away and move on, without a tap. */
  autoMix?: boolean
  /** How a picked track is added; defaults to mixMusic onto `videoBlob`. */
  mix?: (track: MusicTrack, trackBlob: Blob, volume: number) => Promise<Blob>
  /**
   * The auto mix is over without having added the BGM: the user chose
   * another or it failed. Lets the page drop whatever the auto mix waited
   * on (a stalled prepared-audio job would otherwise hang the manual mix
   * too) and its own auto-mix state.
   */
  onLeaveAuto?: () => void
}

// 'auto': mixing the usual BGM on arrival, picker hidden.
type Stage = 'idle' | 'mixing' | 'auto' | 'error'

export default function MusicMixer({
  videoBlob,
  onMixed,
  onNext,
  initialTrackId = null,
  initialVolume = 0.3,
  autoMix = false,
  mix,
  onLeaveAuto,
}: MusicMixerProps) {
  const initialTrack = MUSIC_TRACKS.find(t => t.id === initialTrackId) ?? null
  const [selectedId, setSelectedId] = useState<string | null>(initialTrack?.id ?? null)
  const [volume, setVolume] = useState(initialVolume)
  const [stage, setStage] = useState<Stage>(autoMix && initialTrack ? 'auto' : 'idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<BgmPreview | null>(null)
  // Bumped when the component unmounts, the user skips or picks another
  // BGM, so a mix still running then is discarded instead of re-adding BGM
  // afterwards.
  const requestIdRef = useRef(0)
  const mixing = stage === 'mixing'
  const auto = stage === 'auto'

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  // On arrival only. StrictMode's simulated remount discards the first run
  // (the unmount effect above bumps requestIdRef) and starts a fresh one.
  useEffect(() => {
    if (autoMix && initialTrack) void runMix(initialTrack, initialVolume, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // The preview is hidden while auto-mixing; decoding the track for it
    // would compete with the real mix for memory (tight on iPhone).
    if (!preview || auto) return
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
  }, [selectedId, auto])

  if (MUSIC_TRACKS.length === 0) return null

  async function runMix(track: MusicTrack, mixVolume: number, isAuto: boolean) {
    videoRef.current?.pause()
    const requestId = ++requestIdRef.current
    setStage(isAuto ? 'auto' : 'mixing')
    setErrorMessage(null)
    try {
      const trackBlob = await fetchTrack(track)
      const mixed = await (mix ? mix(track, trackBlob, mixVolume) : mixMusic(videoBlob, trackBlob, mixVolume))
      if (requestIdRef.current !== requestId) return
      onMixed(mixed)
      onNext()
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      const detail = err instanceof Error ? err.message : String(err)
      setErrorMessage(`「${track.title}」の合成に失敗しました: ${detail}`)
      setStage('error')
      if (isAuto) onLeaveAuto?.()
    }
  }

  function handleSelect(id: string | null) {
    // Also unlocked by the wrapper's pointerdown; this covers keyboard picks.
    previewRef.current?.unlock()
    setSelectedId(id)
    setErrorMessage(null)
    if (stage === 'error') setStage('idle')
  }

  function handleNext() {
    const track = MUSIC_TRACKS.find(t => t.id === selectedId)
    if (track) void runMix(track, volume, false)
  }

  function handleChooseOther() {
    // The picker opens with a track already selected, so the user may start
    // the preview without ever tapping a track row.
    previewRef.current?.unlock()
    requestIdRef.current += 1
    setStage('idle')
    onLeaveAuto?.()
  }

  function handleSkip() {
    requestIdRef.current += 1
    videoRef.current?.pause()
    onMixed(null)
    onNext()
  }

  return (
    // iOS WebKit only honors click and touchEnd as audio-unlock gestures.
    // Also unlocked by track selection and 別のBGMを選ぶ for keyboard picks and other interactions.
    <div className={styles.wrapper} onClickCapture={() => previewRef.current?.unlock()} onTouchEndCapture={() => previewRef.current?.unlock()}>
      {auto ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>BGM</p>
          <p className={styles.status}>いつものBGM（{initialTrack?.title}）を合成中…</p>
          <button className={styles.skipBtn} onClick={handleChooseOther}>
            別のBGMを選ぶ
          </button>
        </div>
      ) : (
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
      )}

      {/* Kept mounted while auto-mixing: BgmPreview attaches to it once, on mount. */}
      <div className={styles.section} style={auto ? { display: 'none' } : undefined}>
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

      {!auto && (
        <div className={styles.actions}>
          {/* Left enabled while mixing, to give up on a slow mix. */}
          <button className={styles.skipBtn} onClick={handleSkip}>
            BGMなしで進む
          </button>
          <button className={styles.mixBtn} onClick={handleNext} disabled={!selectedId || mixing}>
            {mixing ? 'BGMを合成中...' : '次へ'}
          </button>
        </div>
      )}
    </div>
  )
}
