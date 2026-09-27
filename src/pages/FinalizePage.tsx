import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { unifyNormalizeBackends } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { ShotEncodeCache } from '../utils/shotEncodeCache'
import {
  burnSubtitlesByShot,
  encodeAll,
  normalizeRequest,
  shotBurnRequests,
  type ShotClip,
} from '../utils/shotEncoding'
import { canUseWebCodecs } from '../utils/webcodecs/support'
import { probeVideoDuration } from '../utils/probeVideoDuration'
import { detectSpeechBounds, type SpeechBounds } from '../utils/detectSpeechBounds'
import { clampTrimRange, resolveShotTrimSettings } from '../utils/shotTrim'
import { shareOrDownload } from '../utils/shareOrDownload'
import { normalizeLoudness } from '../utils/normalizeLoudness'
import { useSettings } from '../hooks/useSettings'
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
  // The cut found around the speech (issue #21); null when there's none.
  autoTrim: SpeechBounds | null
  autoTrimPending: boolean
  // Once the user drags a handle, a late detection result must not move it.
  trimEdited: boolean
}

type CombineState = 'idle' | 'combining' | 'done' | 'error'
// What 結合 is busy with, so the button never sits at 100% while work
// remains (issue #31): encoding each shot, re-encoding some onto one
// encoder after WebCodecs broke down partway, then joining them.
type CombinePhase = 'encoding' | 'unifying' | 'joining'
type LoudnessState = 'idle' | 'normalizing' | 'failed'

const STEP_ORDER: WizardStepId[] = ['trim', 'subtitle', 'bgm', 'export']

// How long trims or subtitles must stay unchanged before their shots start
// encoding in the background, so a drag or a burst of typing doesn't queue
// an encode per intermediate value.
const BACKGROUND_ENCODE_DELAY_MS = 800

function clipOf(entry: ShotEntry): ShotClip {
  return { shotId: entry.shotId, blob: entry.blob!, start: entry.trimStart, end: entry.trimEnd || entry.duration }
}

function combineLabel(phase: CombinePhase, progress: number): string {
  // Rounded down, so 100% only shows once that phase's work is really done.
  const percent = Math.floor(progress * 100)
  if (phase === 'joining') return '仕上げ中...'
  if (phase === 'unifying') return `再変換中... ${percent}%`
  return `結合中... ${percent}%`
}

function shotMeta(entry: ShotEntry): string {
  if (!entry.url) return '動画なし'
  if (entry.duration === 0) return '…'
  return `${((entry.trimEnd || entry.duration) - entry.trimStart).toFixed(1)}秒`
}

// The detected cut fitted to the shot's duration, or the whole shot.
function autoTrimRange(entry: ShotEntry): Pick<ShotEntry, 'trimStart' | 'trimEnd'> {
  if (!entry.autoTrim) return { trimStart: 0, trimEnd: entry.duration }
  const { start, end } = clampTrimRange(entry.autoTrim.start, entry.autoTrim.end, entry.duration)
  return { trimStart: start, trimEnd: end }
}

function findLastIndexBefore(entries: ShotEntry[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (entries[i].url) return i
  }
  return -1
}

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const [settings] = useSettings()
  const { normalizeAudio } = settings
  const script = id ? getScript(id) : undefined

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combineProgress, setCombineProgress] = useState(0)
  const [combinePhase, setCombinePhase] = useState<CombinePhase>('encoding')
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const [shotCueInputs, setShotCueInputs] = useState<ShotCueInput[]>([])
  // The shots exactly as they went into `combinedBlob`, for burning
  // subtitles shot by shot (trims may change afterwards without re-combining).
  const [combinedClips, setCombinedClips] = useState<ShotClip[]>([])
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
  // What the export step previews and saves: `finalBlob` with its loudness
  // brought to the platforms' level, or `finalBlob` itself if that's off.
  const [exportBlob, setExportBlob] = useState<Blob | null>(null)
  const [loudnessState, setLoudnessState] = useState<LoudnessState>('idle')
  const encodeCacheRef = useRef<ShotEncodeCache | null>(null)

  // Encodes run in the background only on the hardware (WebCodecs) path:
  // ffmpeg.wasm's memory use made iOS drop the on-screen previews (issue #12).
  function getEncodeCache(): ShotEncodeCache {
    if (!encodeCacheRef.current) {
      encodeCacheRef.current = new ShotEncodeCache(canUseWebCodecs)
    }
    return encodeCacheRef.current
  }

  useEffect(() => {
    return () => {
      encodeCacheRef.current?.dispose()
      encodeCacheRef.current = null
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
        return {
          shotId: shot.id, text: shot.text, blob, url, duration: 0, trimStart: 0, trimEnd: 0,
          autoTrim: null, autoTrimPending: blob !== null, trimEdited: false,
        }
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

      // Find where each shot's speech starts and ends, so it opens already
      // cut past the record-button press and the pause before stopping.
      // One at a time: each decodes the shot's whole audio track.
      ;(async () => {
        for (const entry of next) {
          if (cancelled) return
          if (!entry.blob) continue
          const shot = script.shots.find(s => s.id === entry.shotId)
          const trim = resolveShotTrimSettings(shot, settings)
          const bounds = trim.trimEnabled
            ? await detectSpeechBounds(entry.blob, trim.trimPaddingStart, trim.trimPaddingEnd)
            : null
          if (cancelled) return
          setAutoTrim(entry.shotId, bounds)
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
      prev.map(e => {
        if (e.shotId !== shotId || e.duration !== 0) return e
        const withDuration = { ...e, duration }
        return { ...withDuration, ...autoTrimRange(withDuration) }
      }),
    )
  }

  function setAutoTrim(shotId: string, autoTrim: SpeechBounds | null) {
    setEntries(prev =>
      prev.map(e => {
        if (e.shotId !== shotId) return e
        const next = { ...e, autoTrim, autoTrimPending: false }
        return next.duration > 0 && !next.trimEdited ? { ...next, ...autoTrimRange(next) } : next
      }),
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
  // A long script makes a list of every shot a long scroll away from the
  // player (issue #18), so shots are picked from a select above it instead,
  // with prev/next for the usual one-after-another trimming pass.
  const prevIndex = findLastIndexBefore(entries, selectedIndex)
  const nextIndex = entries.findIndex((e, i) => i > selectedIndex && e.url)
  const detectingCount = availableEntries.filter(e => e.autoTrimPending).length
  const canCombine =
    availableEntries.length > 0 && availableEntries.every(e => e.duration > 0) && detectingCount === 0
  const finalBlob = mixedBlob ?? burnedBlob ?? combinedBlob

  // Encode shots ahead while the user is still trimming, so 結合 only has
  // to join them. Waits for speech detection to finish (it decodes every
  // shot too) and for the trims to settle; a shot re-trimmed later is
  // re-queued and its stale queued encode skipped (see ShotEncodeCache).
  const trimSignature = availableEntries
    .map(e => `${e.shotId}:${e.trimStart}:${e.trimEnd || e.duration}`)
    .join('|')
  useEffect(() => {
    if (step !== 'trim' || !canCombine || combineState === 'combining') return
    const timer = setTimeout(() => {
      const cache = getEncodeCache()
      for (const entry of availableEntries) cache.prefetch(normalizeRequest(clipOf(entry)))
    }, BACKGROUND_ENCODE_DELAY_MS)
    return () => clearTimeout(timer)
    // availableEntries is captured through trimSignature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, canCombine, combineState, trimSignature])

  // Likewise burn subtitles into each shot once every cue is translated,
  // while the user checks the preview and position, so 次へ only has to
  // join them. Editing a cue or moving the subtitles re-queues just the
  // shots that changed.
  const { stage: subtitleStage, cues: subtitleCues, position: subtitlePosition } = subtitleState
  useEffect(() => {
    if (step !== 'subtitle' || subtitleStage !== 'reviewing' || combinedClips.length === 0) return
    if (subtitleCues.length === 0 || !subtitleCues.every(c => c.ja !== null && c.ja.trim() !== '')) return
    const timer = setTimeout(() => {
      const cache = getEncodeCache()
      for (const request of shotBurnRequests(combinedClips, subtitleCues, subtitlePosition)) {
        cache.prefetch(request)
      }
    }, BACKGROUND_ENCODE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [step, subtitleStage, subtitleCues, subtitlePosition, combinedClips])

  // Loudness is corrected once, on the finished video: the BGM mix halves
  // the voice (see mixMusicWebCodecs) and per-shot levels drift, so only the
  // final audio can be brought to the level Instagram/TikTok play back at.
  useEffect(() => {
    if (step !== 'export' || !finalBlob) {
      setExportBlob(null)
      setLoudnessState('idle')
      return
    }
    if (!normalizeAudio) {
      setExportBlob(finalBlob)
      setLoudnessState('idle')
      return
    }
    let cancelled = false
    setExportBlob(null)
    setLoudnessState('normalizing')
    normalizeLoudness(finalBlob).then(
      normalized => {
        if (cancelled) return
        setExportBlob(normalized)
        setLoudnessState('idle')
      },
      err => {
        if (cancelled) return
        // Still let the video be saved, just at its original level.
        console.warn('[FinalizePage] loudness normalization failed:', err)
        setExportBlob(finalBlob)
        setLoudnessState('failed')
      },
    )
    return () => {
      cancelled = true
    }
  }, [step, finalBlob, normalizeAudio])

  useEffect(() => {
    if (!exportBlob) {
      if (finalUrlRef.current) {
        URL.revokeObjectURL(finalUrlRef.current)
        finalUrlRef.current = null
      }
      setFinalUrl(null)
      return
    }
    const url = URL.createObjectURL(exportBlob)
    if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current)
    finalUrlRef.current = url
    setFinalUrl(url)
  }, [exportBlob])

  useEffect(() => {
    return () => {
      if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current)
    }
  }, [])

  async function handleCombine() {
    setCombineState('combining')
    setCombineError(null)
    setCombinePhase('encoding')
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
      const clips = availableEntries.map(clipOf)
      const encoded = await encodeAll(getEncodeCache(), clips.map(normalizeRequest), setCombineProgress)
      // If WebCodecs broke down partway (see trimAndNormalizeShot), some
      // clips came from the hardware encoder and some from ffmpeg; their
      // H.264 headers differ and can't be joined by packet copy, so some
      // have to be re-encoded onto the other's profile.
      const normalized = await unifyNormalizeBackends(clips, encoded, ratio => {
        setCombinePhase('unifying')
        setCombineProgress(ratio)
      })
      setCombinePhase('joining')
      const combined = await concatVideos(normalized)
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
      // Same clips, same order, same trim values used just above to build
      // `normalized` — keeps subtitle timing aligned with the actual
      // combined output by construction, not by keeping two formulas in sync.
      setCombinedClips(clips)
      setShotCueInputs(
        availableEntries.map((entry, i) => ({ text: entry.text, duration: clips[i].end - clips[i].start }))
      )
      setCombineState('done')
    } catch (err) {
      setCombineError(err instanceof Error ? err.message : String(err))
      setCombineState('error')
    }
  }

  async function handleSaveFinal() {
    if (!exportBlob || !script) return
    await shareOrDownload(exportBlob, `${script.title}-final`)
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
                  <div className={styles.shotNav}>
                    <button
                      type="button"
                      className={styles.shotNavBtn}
                      aria-label="前のショット"
                      disabled={prevIndex < 0}
                      onClick={() => setSelectedShotId(entries[prevIndex].shotId)}
                    >
                      ‹
                    </button>
                    <select
                      aria-label="ショットを選ぶ"
                      className={styles.shotSelect}
                      value={selected.shotId}
                      onChange={e => setSelectedShotId(e.target.value)}
                    >
                      {entries.map((entry, i) => (
                        <option key={entry.shotId} value={entry.shotId} disabled={!entry.url}>
                          {i + 1}. {shotMeta(entry)}｜{entry.text}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.shotNavBtn}
                      aria-label="次のショット"
                      disabled={nextIndex < 0}
                      onClick={() => setSelectedShotId(entries[nextIndex].shotId)}
                    >
                      ›
                    </button>
                  </div>
                  <p className={styles.shotEntryText}>
                    <span className={styles.shotCounter}>{selectedIndex + 1} / {entries.length}</span>
                    <span>{selected.text}</span>
                  </p>
                  <ShotTrimmer
                    url={selected.url}
                    nextUrl={entries[selectedIndex + 1]?.url ?? null}
                    duration={selected.duration}
                    trimStart={selected.trimStart}
                    trimEnd={selected.trimEnd || selected.duration}
                    onDurationKnown={duration => setDurationOnce(selected.shotId, duration)}
                    onChange={(trimStart, trimEnd) =>
                      updateEntry(selected.shotId, { trimStart, trimEnd, trimEdited: true })
                    }
                    onResetToAuto={
                      selected.autoTrim && selected.trimEdited
                        ? () => updateEntry(selected.shotId, { ...autoTrimRange(selected), trimEdited: false })
                        : undefined
                    }
                  />
                </div>
              ) : (
                <p className={styles.missing}>保存された動画がありません</p>
              )}

              <button
                className={styles.finalizeBtn}
                onClick={handleCombine}
                disabled={!canCombine || combineState === 'combining'}
              >
                {combineState === 'combining'
                  ? combineLabel(combinePhase, combineProgress)
                  : detectingCount > 0
                    ? `前後の無音を検出中... (残り${detectingCount})`
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
                burn={(cues, position, onProgress) =>
                  burnSubtitlesByShot(getEncodeCache(), combinedClips, combinedBlob, cues, position, onProgress)
                }
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

          {step === 'export' && loudnessState === 'normalizing' && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>音量を調整中...</p>
            </div>
          )}

          {step === 'export' && exportBlob && finalUrl && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>完成した動画</p>
              <video className={styles.preview} src={finalUrl} controls playsInline />
              {loudnessState === 'failed' && (
                <p className={styles.missing}>音量の自動調整に失敗したため、元の音量のまま保存されます</p>
              )}
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
