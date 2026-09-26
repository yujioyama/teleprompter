import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { trimAndNormalizeShot } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import { shareOrDownload } from '../utils/shareOrDownload'
import ShotTrimmer from '../components/ShotTrimmer'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from '../components/SubtitleWorkflow'
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [combineState, setCombineState] = useState<CombineState>('idle')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [combinedUrl, setCombinedUrl] = useState<string | null>(null)
  const [combinedBlob, setCombinedBlob] = useState<Blob | null>(null)
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null)
  // Lifted up from SubtitleWorkflow so its cues/position/stage/paste-text
  // survive the component unmounting when the wizard leaves the subtitle
  // step and remounting when it comes back (e.g. via goToStep) — otherwise
  // all transcription/translation work would be lost on back-navigation.
  const [subtitleState, setSubtitleState] = useState<SubtitleState>(INITIAL_SUBTITLE_STATE)
  const [step, setStep] = useState<WizardStepId>('trim')
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([])
  const urlsRef = useRef<string[]>([])
  const combinedUrlRef = useRef<string | null>(null)
  const finalUrlRef = useRef<string | null>(null)
  const [finalUrl, setFinalUrl] = useState<string | null>(null)

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
  // button) while a transcription or burn-in is in flight: both update lifted
  // subtitle state after their await resolves, and navigating away mid-flight
  // (especially re-combining, which resets that lifted state) can leave the
  // eventual resolution merging onto a state it no longer matches.
  const subtitleProcessing = subtitleState.stage === 'transcribing' || subtitleState.stage === 'burning'

  const availableEntries = entries.filter(e => e.blob)
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
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixedBlob(null)
    // A re-combined video invalidates any transcription tied to the old one.
    setSubtitleState(INITIAL_SUBTITLE_STATE)
    try {
      const normalized: Blob[] = []
      for (const entry of availableEntries) {
        const trimmed = await trimAndNormalizeShot(entry.blob!, entry.trimStart, entry.trimEnd || entry.duration)
        normalized.push(trimmed)
      }
      const combined = await concatVideos(normalized)
      if (combinedUrlRef.current) URL.revokeObjectURL(combinedUrlRef.current)
      const url = URL.createObjectURL(combined)
      combinedUrlRef.current = url
      setCombinedBlob(combined)
      setCombinedUrl(url)
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
              <div className={styles.shotList}>
                {entries.map((entry, i) => {
                  const next = entries[i + 1]
                  return (
                    <div key={entry.shotId} className={styles.shotEntry}>
                      <p className={styles.shotEntryText}>{i + 1}. {entry.text}</p>
                      {entry.url ? (
                        <ShotTrimmer
                          url={entry.url}
                          nextUrl={next?.url ?? null}
                          duration={entry.duration}
                          trimStart={entry.trimStart}
                          trimEnd={entry.trimEnd || entry.duration}
                          onDurationKnown={duration => updateEntry(entry.shotId, { duration, trimEnd: duration })}
                          onChange={(trimStart, trimEnd) => updateEntry(entry.shotId, { trimStart, trimEnd })}
                        />
                      ) : (
                        <p className={styles.missing}>このショットは保存された動画がありません</p>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                className={styles.finalizeBtn}
                onClick={handleCombine}
                disabled={!canCombine || combineState === 'combining'}
              >
                {combineState === 'combining' ? '結合中...' : '結合する'}
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
