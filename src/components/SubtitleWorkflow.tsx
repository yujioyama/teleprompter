import { useState, useEffect, useRef } from 'react'
import { SubtitleCue, ShotCueInput, buildClaudePrompt, cuesFromShotEntries, parseJapanesePaste } from '../utils/subtitleCues'
import {
  SubtitlePosition,
  SUBTITLE_POSITION_BOTTOM,
  SUBTITLE_POSITION_PRESETS,
} from '../utils/subtitlePosition'
import SubtitleEditor from './SubtitleEditor'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import CancelProcessing from './CancelProcessing'
import { raceAbort } from '../utils/cancellation'
import { transcribeSpeech, WhisperProgress } from '../utils/transcribeSpeech'
import styles from './SubtitleWorkflow.module.css'

// No 'error' stage: a failed generate/transcribe/burn reverts to the stage
// the user was on before attempting it, with the failure surfaced via
// `errorMessage` instead, so the review/position UI (and the ability to
// retry) is never fully replaced by an error screen.
export type SubtitleStage = 'idle' | 'transcribing' | 'reviewing' | 'burning'

/**
 * Where the English cues come from: the teleprompter script (one cue per
 * shot), or what was actually said, transcribed by Whisper — for free talk
 * and self-corrections that stray from the script.
 */
export type SubtitleSource = 'script' | 'speech'

/**
 * Subtitle work lifted up to the parent (FinalizePage) so it survives
 * SubtitleWorkflow unmounting/remounting when the wizard navigates away from
 * and back to the subtitle step. Only the state needed for a faithful resume
 * lives here; purely ephemeral UI state (error text, fine-tune toggle,
 * preview scrub position) stays local to the component.
 */
export interface SubtitleState {
  stage: SubtitleStage
  cues: SubtitleCue[]
  pasteText: string
  position: SubtitlePosition
  source: SubtitleSource
}

export const INITIAL_SUBTITLE_STATE: SubtitleState = {
  stage: 'idle',
  cues: [],
  pasteText: '',
  position: SUBTITLE_POSITION_BOTTOM,
  source: 'script',
}

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  state: SubtitleState
  onStateChange: (updater: SubtitleState | ((prev: SubtitleState) => SubtitleState)) => void
  /** Burn `cues` into the combined video, reporting progress 0–1; `signal` aborts it. */
  burn: (
    cues: SubtitleCue[],
    position: SubtitlePosition,
    onProgress: (ratio: number) => void,
    signal: AbortSignal,
  ) => Promise<Blob>
  onBurned?: (blob: Blob) => void
  /** Transcribe the combined video into timed English cues; `signal` aborts it. */
  transcribe?: (
    blob: Blob,
    onProgress: (progress: WhisperProgress) => void,
    signal: AbortSignal,
  ) => Promise<SubtitleCue[]>
}

const SOURCES: { label: string; value: SubtitleSource }[] = [
  { label: '台本から', value: 'script' },
  { label: '話した音声から', value: 'speech' },
]

export default function SubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  state,
  onStateChange,
  burn,
  onBurned,
  transcribe = transcribeSpeech,
}: SubtitleWorkflowProps) {
  const { stage, cues, pasteText, position, source } = state
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [fineTune, setFineTune] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [burnProgress, setBurnProgress] = useState(0)
  const [transcribeProgress, setTranscribeProgress] = useState<WhisperProgress | null>(null)
  const [copyToastVisible, setCopyToastVisible] = useState(false)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  // Aborted by 中断する (issue #34) or if this unmounts mid-burn.
  const burnAbortRef = useRef<AbortController | null>(null)
  const transcribeAbortRef = useRef<AbortController | null>(null)

  function patch(changes: Partial<SubtitleState>) {
    onStateChange(prev => ({ ...prev, ...changes }))
  }

  // Create the preview object URL inside the effect (not via useMemo) and
  // revoke the previous one in this same effect's cleanup. Under StrictMode's
  // dev-only mount→unmount→remount simulation, an effect's cleanup always
  // reruns before its body reruns on the same deps — so the URL created here
  // is always the one currently revoked, unlike useMemo (which caches across
  // the simulated remount and would keep returning an already-revoked URL).
  useEffect(() => {
    const url = URL.createObjectURL(combinedBlob)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [combinedBlob])

  useEffect(() => {
    return () => {
      burnAbortRef.current?.abort()
      transcribeAbortRef.current?.abort()
    }
  }, [])

  // The English cues come straight from the script and trims, so there is
  // nothing to wait for: build them on arrival. Only then — coming back
  // to this step keeps the cues (and edits) already there.
  useEffect(() => {
    if (stage === 'idle' && cues.length === 0) handleGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleGenerate() {
    const generated = cuesFromShotEntries(shotCueInputs)
    if (generated.length === 0) {
      setErrorMessage('字幕にできるテキストがありません。トリミング画面でスクリプトのテキストを確認してください。')
      return
    }
    setErrorMessage(null)
    patch({ cues: generated, stage: 'reviewing', source: 'script', pasteText: '' })
  }

  async function handleTranscribe() {
    const before = stage
    const controller = new AbortController()
    transcribeAbortRef.current = controller
    const { signal } = controller
    patch({ stage: 'transcribing' })
    setErrorMessage(null)
    setNotice(null)
    setTranscribeProgress(null)
    try {
      const transcribed = await raceAbort(
        transcribe(combinedBlob, progress => {
          if (!signal.aborted) setTranscribeProgress(progress)
        }, signal),
        signal,
      )
      if (transcribed.length === 0) {
        setErrorMessage('音声から言葉を聞き取れませんでした。')
        patch({ stage: before })
        return
      }
      patch({ cues: transcribed, stage: 'reviewing', source: 'speech', pasteText: '' })
    } catch (err) {
      if (signal.aborted) setNotice('中断しました')
      else setErrorMessage(err instanceof Error ? err.message : String(err))
      patch({ stage: before })
    } finally {
      if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null
    }
  }

  function handleChooseSource(next: SubtitleSource) {
    if (next === source && cues.length > 0) return
    // New cues mean new lines, so any translation no longer lines up.
    if (hasAnyJapanese && !window.confirm('字幕を作り直すと、日本語訳は消えます。作り直しますか？')) return
    if (next === 'script') handleGenerate()
    else void handleTranscribe()
  }

  function handleEditEn(id: string, text: string) {
    patch({ cues: cues.map(c => (c.id === id ? { ...c, en: text } : c)) })
  }

  function handleEditJa(id: string, text: string) {
    patch({ cues: cues.map(c => (c.id === id ? { ...c, ja: text } : c)) })
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(buildClaudePrompt(cues))
    if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
    setCopyToastVisible(true)
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToastVisible(false)
      copyToastTimerRef.current = null
    }, 2000)
  }

  function handleApplyPaste() {
    const result = parseJapanesePaste(pasteText, cues)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    setPasteError(null)
    patch({ cues: result.cues })
  }

  async function handleBurnIn() {
    // A playing preview holds the phone's hardware decoder while the burn
    // needs it too; on iOS that could fail the hardware encode over to the
    // far slower ffmpeg.wasm path, leaving the button near 0% (issue #33).
    previewRef.current?.pause()
    const controller = new AbortController()
    burnAbortRef.current = controller
    const { signal } = controller
    patch({ stage: 'burning' })
    setErrorMessage(null)
    setNotice(null)
    setBurnProgress(0)
    try {
      // Raced so 中断する frees the page even if the burn never settles.
      const burned = await raceAbort(
        burn(cues, position, ratio => {
          if (!signal.aborted) setBurnProgress(ratio)
        }, signal),
        signal,
      )
      // Reset to 'reviewing' on success too: this state is lifted to the
      // parent and survives unmount, so without this the stage would stay
      // stuck on 'burning' (disabled button, "焼き込み中...") if the user
      // ever navigates back to this step after completing it.
      patch({ stage: 'reviewing' })
      onBurned?.(burned)
    } catch (err) {
      if (signal.aborted) setNotice('中断しました')
      else setErrorMessage(err instanceof Error ? err.message : String(err))
      // Back to 'reviewing' (not a separate error stage) so the cues,
      // position controls and next button remain visible and usable —
      // the user can adjust position or just retry burning in.
      patch({ stage: 'reviewing' })
    } finally {
      if (burnAbortRef.current === controller) burnAbortRef.current = null
    }
  }

  const hasAnyJapanese = cues.some(c => c.ja !== null)
  const allTranslated = cues.length > 0 && cues.every(c => c.ja !== null && c.ja.trim() !== '')

  return (
    <div className={styles.wrapper}>
      {errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}

      {(stage === 'idle' || stage === 'reviewing') && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>字幕の作り方</p>
          <div className={styles.positionRow}>
            {SOURCES.map(s => (
              <button
                key={s.value}
                className={`${styles.positionBtn} ${cues.length > 0 && source === s.value ? styles.positionBtnActive : ''}`}
                aria-pressed={cues.length > 0 && source === s.value}
                onClick={() => handleChooseSource(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className={styles.hint}>アドリブや言い直しがある動画は「話した音声から」がおすすめです</p>
        </div>
      )}

      {stage === 'transcribing' && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>
            {transcribeProgress?.phase === 'download'
              ? `音声認識モデルをダウンロード中... ${Math.round(transcribeProgress.ratio * 100)}%`
              : '話した音声から字幕を作成中...'}
          </p>
          <p className={styles.hint}>初回だけモデル（約80MB）のダウンロードがあります。動画が長いと数分かかることがあります</p>
          <CancelProcessing progress={transcribeProgress} onCancel={() => transcribeAbortRef.current?.abort()} />
        </div>
      )}

      {(stage === 'reviewing' || stage === 'burning') && cues.length > 0 && (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>
              {source === 'speech' ? '英語字幕（聞き取り違いがあれば直してください）' : '英語字幕（必要なら修正してください）'}
            </p>
            <SubtitleEditor cues={cues} onEditEn={handleEditEn} onEditJa={handleEditJa} />
          </div>

          {!hasAnyJapanese && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Claudeで日本語訳を作成</p>
              <button className={styles.copyBtn} onClick={handleCopyPrompt}>
                📋 Claude用プロンプトをコピー
              </button>
              <textarea
                className={styles.pasteArea}
                placeholder="Claudeからの返信をここに貼り付け"
                value={pasteText}
                onChange={e => patch({ pasteText: e.target.value })}
              />
              <button className={styles.copyBtn} onClick={handleApplyPaste}>
                日本語を反映
              </button>
              {pasteError && <p className={styles.error}>{pasteError}</p>}
            </div>
          )}

          {hasAnyJapanese && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>プレビュー</p>
              <div className={styles.previewWrapper}>
                <video
                  ref={previewRef}
                  className={styles.preview}
                  src={previewUrl ?? undefined}
                  controls={stage !== 'burning'}
                  playsInline
                  onTimeUpdate={e => setPreviewTime(e.currentTarget.currentTime)}
                />
                <SubtitleOverlayPreview cues={cues} position={position} currentTime={previewTime} />
              </div>

              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow}>
                {SUBTITLE_POSITION_PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`${styles.positionBtn} ${position === p.value ? styles.positionBtnActive : ''}`}
                    aria-pressed={position === p.value}
                    onClick={() => patch({ position: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button className={styles.copyBtn} onClick={() => setFineTune(v => !v)}>
                細かく調整
              </button>

              {fineTune && (
                <div className={styles.fineTuneRow}>
                  <label htmlFor="subtitle-position-slider">字幕の上下位置</label>
                  <input
                    id="subtitle-position-slider"
                    aria-label="字幕の上下位置"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={position}
                    onChange={e => patch({ position: Number(e.target.value) })}
                  />
                </div>
              )}

              <button
                className={styles.genBtn}
                onClick={handleBurnIn}
                disabled={!allTranslated || stage === 'burning'}
              >
                {stage === 'burning' ? `焼き込み中... ${Math.round(burnProgress * 100)}%` : '次へ'}
              </button>

              {stage === 'burning' && (
                <CancelProcessing progress={burnProgress} onCancel={() => burnAbortRef.current?.abort()} />
              )}
            </div>
          )}
        </>
      )}

      {copyToastVisible && (
        <div className={styles.copyToast}>コピーしました</div>
      )}
    </div>
  )
}
