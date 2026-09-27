import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import {
  normalizedBackendOf,
  trimAndNormalizeShot,
  trimAndNormalizeShotFFmpeg,
} from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { NormalizedShotCache } from '../utils/normalizedShotCache'
import { probeVideoDuration } from '../utils/probeVideoDuration'
import { shareOrDownload } from '../utils/shareOrDownload'
import ShotTrimmer from '../components/ShotTrimmer'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from '../components/SubtitleWorkflow'
import { ShotCueInput } from '../utils/subtitleCues'
import MusicMixer from '../components/MusicMixer'
import WizardSteps, { WizardStepId } from '../components/WizardSteps'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
  duration: number
  trimStart: number
  trimEnd: number
}

type CombineState = 'idle' | 'combining' | 'done' | 'error'

const STEP_ORDER: WizardStepId[] = ['trim', 'subtitle', 'bgm', 'export']

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combineProgress, setCombineProgress] = useState(0)
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const [shotCueInputs, setShotCueInputs] = useState<ShotCueInput[]>([])
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)
  // Lifted up from SubtitleWorkflow so its cues/position/stage/paste-text
  // survive the component unmounting when the wizard leaves the subtitle
  // step and remounting when it comes back (e.g. via goToStep) — otherwise
  // all translation/subtitle work would be lost on back-navigation.
  const [subtitleState, setSubtitleState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  const [step, setStep] = useState<WizardStepId>('trim')
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([])
  const urlsRef = useRef<string[]>([])
  const combinedUrlRef = useRef<string | null>(null)
  const finalUrlRef = useRef<string | null>(null)
  const [finalUrl, setFinalUrl] = useState<string | null>(null)
  const normalizeCacheRef = useRef<NormalizedShotCache | null>(null)

  function getNormalizeCache(): NormalizedShotCache {
    if (!normalizeCacheRef.current) {
      normalizeCacheRef.current = new NormalizedShotCache(trimAndNormalizeShot)
    }
    return normalizeCacheRef.current
  }

  useEffect(() => {
    return () => {
      normalizeCacheRef.current?.dispose()
      normalizeCacheRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(stored => {
      if (cancelled) return
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) urlsRef.current.push(url)
        return { shotId: shot.id, text: shot.text, blob, url, duration: 0, trimStart: 0, trimEnd: 0 }
      })
      setEntries(next)
      setLoading(false)

      // Only the selected shot has a live <video> (issue #12), so shots never
      // selected would otherwise never report a duration — which combining
      // needs. Probe them one at a time.
      ;(async () => {
        for (const entry of next) {
          if (cancelled) return
          if (!entry.blob) continue
          const duration = await probeVideoDuration(entry.blob)
          if (cancelled) return
          if (duration > 0) setDurationOnce(entry.shotId, duration)
        }
      })()
    }).catch(err => {
      if (cancelled) return
      console.error('Failed to load stored shot videos', err)
      setLoadError('動画の読み込みに失敗しました。ページを再読み込みしてください。')
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    return () => {
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
    }
  }, [])

  // A duration can arrive twice — from the probe and from the ShotTrimmer
  // player loading that shot — so only the first one initializes the trim range.
  function setDurationOnce(shotId: string, duration: number) {
    setEntries(prev =>
      prev.map(e => (e.shotId === shotId && e.duration === 0 ? { ...e, duration, trimEnd: duration } : e)),
    )
  }

  function updateEntry(shotId: string, changes: Partial<ShotEntry>) {
    setEntries(prev => prev.map(e => (e.shotId === shotId ? { ...e, ...changes } : e)))
  }

  function markStepDone(done: WizardStepId, next: WizardStepId) {
    setCompletedSteps(prev => (prev.includes(done) ? prev : [...prev, done]))
    setStep(next)
  }

  function goToStep(target: WizardStepId) {
    // Going back to an earlier step invalidates every step after it, since
    // its input may change (e.g. re-combining after adjusting a trim).
    const targetIndex = STEP_ORDER.indexOf(target)
    setCompletedSteps(prev => prev.filter(s => STEP_ORDER.indexOf(s) < targetIndex))
    if (STEP_ORDER.indexOf('subtitle') >= targetIndex) setBurnedBlob(null)
    if (STEP_ORDER.indexOf('bgm') >= targetIndex) setMixedBlob(null)
    setStep(target)
  }

  // Block back-navigation via the wizard indicator (and the page's own back
  // button) while a burn-in is in flight: it updates lifted subtitle state
  // after its await resolves, and navigating away mid-flight (especially
  // re-combining, which resets that lifted state) can leave the eventual
  // resolution merging onto a state it no longer matches.
  const subtitleProcessing = subtitleState.stage === 'burning'

  const availableEntries = entries.filter(e => e.blob)
  // One player for the whole trim step: every live <video> holds a decoder,
  // and iOS fails to decode once a handful exist at once (issue #12).
  const pickedIndex = entries.findIndex(e => e.url && e.shotId === selectedShotId)
  const selectedIndex = pickedIndex >= 0 ? pickedIndex : entries.findIndex(e => e.url)
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : undefined
  const canCombine = availableEntries.length > 0 && availableEntries.every(e => e.duration > 0)
  const finalBlob = mixedBlob ?? burnedBlob ?? combinedBlob

  useEffect(() => {
    if (!finalBlob) {
      if (finalUrlRef.current) {
        URL.revokeObjectURL(finalUrlRef.current)
        finalUrlRef.current = null
      }
      setFinalUrl(null)
      return
    }
    const url = URL.createObjectURL(finalBlob)
    if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current)
    finalUrlRef.current = url
    setFinalUrl(url)
  }, [finalBlob])

  useEffect(() => {
    return () => {
      if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current)
    }
  }, [])

  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    setCombineProgress(0)
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixedBlob(null)
    // A re-combined video invalidates any subtitle cues tied to the old one.
    setSubtitleState(INITIAL_SUBTITLE_STATE)
    try {
      const cache = getNormalizeCache()
      const total = availableEntries.length
      const shotDurations = availableEntries.map(e => (e.trimEnd || e.duration) - e.trimStart)
      const keys = availableEntries.map(e =>
        cache.keyFor(e.shotId, e.blob!, e.trimStart, e.trimEnd || e.duration),
      )
      // Per-shot completion ratio; shots already encoded in the background
      // jump straight to 1 as soon as their cached promise resolves.
      const ratios = new Map(keys.map(k => [k, 0]))
      const report = () => {
        let sum = 0
        ratios.forEach(r => (sum += r))
        setCombineProgress(sum / total)
      }
      cache.onProgress = (key, ratio) => {
        if (!ratios.has(key)) return
        ratios.set(key, ratio)
        report()
      }
      let normalized: Blob[]
      try {
        normalized = await Promise.all(
          availableEntries.map((entry, i) =>
            cache
              .get(entry.shotId, entry.blob!, entry.trimStart, entry.trimEnd || entry.duration)
              .then(blob => {
                ratios.set(keys[i], 1)
                report()
                return blob
              }),
          ),
        )
      } finally {
        cache.onProgress = null
      }
      // If WebCodecs broke down partway (see trimAndNormalizeShot), some
      // clips came from the hardware encoder and some from ffmpeg; their
      // H.264 headers differ and can't be joined by packet copy, so bring
      // the stragglers onto the ffmpeg profile too.
      if (new Set(normalized.map(normalizedBackendOf)).size > 1) {
        for (let i = 0; i < normalized.length; i++) {
          if (normalizedBackendOf(normalized[i]) === 'ffmpeg') continue
          const entry = availableEntries[i]
          normalized[i] = await trimAndNormalizeShotFFmpeg(
            entry.blob!, entry.trimStart, entry.trimEnd || entry.duration,
          )
        }
      }
      setCombineProgress(1)
      const combined = await concatVideos(normalized)
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
      // Same entries, same order, same trim-end values used just above to
      // build `normalized` — keeps subtitle timing aligned with the actual
      // combined output by construction, not by keeping two formulas in sync.
      setShotCueInputs(
        availableEntries.map((entry, i) => ({ text: entry.text, duration: shotDurations[i] }))
      )
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }

  async function handleSaveFinal() {
    if (!finalBlob || !script) return
    await shareOrDownload(finalBlob, `${script.title}-final`)
  }

  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate(`/scripts/${script.id}/shots`)}
          disabled={subtitleProcessing}
        >
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : loadError ? (
        <p className={styles.missing}>{loadError}</p>
      ) : (
        <>
          <WizardSteps current={step} completed={completedSteps} onSelect={goToStep} disabled={subtitleProcessing} />

          {step === 'trim' && (
            <div className={styles.stepBody}>
              {selected?.url ? (
                <div className={styles.shotEntry}>
                  <p className={styles.shotEntryText}>{selectedIndex + 1}. {selected.text}</p>
                  <ShotTrimmer
                    url={selected.url}
                    nextUrl={entries[selectedIndex + 1]?.url ?? null}
                    duration={selected.duration}
                    trimStart={selected.trimStart}
                    trimEnd={selected.trimEnd || selected.duration}
                    onDurationKnown={duration => setDurationOnce(selected.shotId, duration)}
                    onChange={(trimStart, trimEnd) => updateEntry(selected.shotId, { trimStart, trimEnd })}
                  />
                </div>
              ) : (
                <p className={styles.missing}>保存された動画がありません</p>
              )}

              <ul className={styles.shotList}>
                {entries.map((entry, i) => {
                  const kept = (entry.trimEnd || entry.duration) - entry.trimStart
                  const isSelected = i === selectedIndex
                  return (
                    <li key={entry.shotId}>
                      <button
                        type="button"
                        className={`${styles.shotRow} ${isSelected ? styles.shotRowSelected : ''}`}
                        aria-current={isSelected}
                        disabled={!entry.url}
                        onClick={() => setSelectedShotId(entry.shotId)}
                      >
                        <span className={styles.shotRowNumber}>{i + 1}</span>
                        <span className={styles.shotRowText}>{entry.text}</span>
                        <span className={styles.shotRowMeta}>
                          {!entry.url
                            ? '動画なし'
                            : entry.duration > 0
                              ? `${kept.toFixed(1)}秒`
                              : '…'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <button
                className={styles.finalizeBtn}
                onClick={handleCombine}
                disabled={!canCombine || combineState === 'combining'}
              >
                {combineState === 'combining'
                  ? `結合中... ${Math.round(combineProgress * 100)}%`
                  : '結合する'}
              </button>

              {combineState === 'error' && (
                <p className={styles.missing}>結合に失敗しました: {combineError}</p>
              )}

              {combineState === 'done' && combinedUrl && (
                <div className={styles.shotEntry}>
                  <p className={styles.shotEntryText}>結合結果</p>
                  <video className={styles.preview} src={combinedUrl} controls playsInline />
                  <button
                    className={styles.finalizeBtn}
                    onClick={() => markStepDone('trim', 'subtitle')}
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'subtitle' && combinedBlob && (
            <div className={styles.stepBody}>
              <SubtitleWorkflow
                key={combinedUrl}
                combinedBlob={combinedBlob}
                shotCueInputs={shotCueInputs}
                state={subtitleState}
                onStateChange={setSubtitleState}
                onBurned={burned => {
                  setBurnedBlob(burned)
                  markStepDone('subtitle', 'bgm')
                }}
              />
            </div>
          )}

          {step === 'bgm' && (burnedBlob ?? combinedBlob) && (
            <div className={styles.stepBody}>
              <MusicMixer
                // Deliberately NOT `finalBlob`: MusicMixer must always mix onto
                // the video from before any BGM was ever added, otherwise a
                // track/volume change re-mixes onto its own previous mixed
                // output and BGM layers stack indefinitely.
                videoBlob={(burnedBlob ?? combinedBlob) as Blob}
                onMixed={setMixedBlob}
                onNext={() => markStepDone('bgm', 'export')}
              />
            </div>
          )}

          {step === 'export' && finalBlob && finalUrl && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>完成した動画</p>
              <video className={styles.preview} src={finalUrl} controls playsInline />
              <button className={styles.finalizeBtn} onClick={handleSaveFinal}>
                保存する
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
