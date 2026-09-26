import { useState, useEffect, useRef } from 'react'
import { SubtitleCue, ShotCueInput, buildClaudePrompt, cuesFromShotEntries, parseJapanesePaste } from '../utils/subtitleCues'
import { burnSubtitles } from '../utils/burnSubtitles'
import {
  SubtitlePosition,
  SUBTITLE_POSITION_TOP,
  SUBTITLE_POSITION_CENTER,
  SUBTITLE_POSITION_BOTTOM,
} from '../utils/subtitlePosition'
import SubtitleEditor from './SubtitleEditor'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import styles from './SubtitleWorkflow.module.css'

// No 'error' stage: a failed generate/burn reverts to the stage the user was
// on before attempting it ('idle' or 'reviewing' respectively), with the
// failure surfaced via `errorMessage` instead, so the review/position UI
// (and the ability to retry) is never fully replaced by an error screen.
export type SubtitleStage = 'idle' | 'reviewing' | 'burning'

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
}

export const INITIAL_SUBTITLE_STATE: SubtitleState = {
  stage: 'idle',
  cues: [],
  pasteText: '',
  position: SUBTITLE_POSITION_BOTTOM,
}

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  shotCueInputs: ShotCueInput[]
  state: SubtitleState
  onStateChange: (updater: SubtitleState | ((prev: SubtitleState) => SubtitleState)) => void
  onBurned?: (blob: Blob) => void
}

const PRESETS: { label: string; value: SubtitlePosition }[] = [
  { label: '上部', value: SUBTITLE_POSITION_TOP },
  { label: '中央', value: SUBTITLE_POSITION_CENTER },
  { label: '下部', value: SUBTITLE_POSITION_BOTTOM },
]

export default function SubtitleWorkflow({ combinedBlob, shotCueInputs, state, onStateChange, onBurned }: SubtitleWorkflowProps) {
  const { stage, cues, pasteText, position } = state
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [fineTune, setFineTune] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [copyToastVisible, setCopyToastVisible] = useState(false)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  function handleGenerate() {
    const generated = cuesFromShotEntries(shotCueInputs)
    if (generated.length === 0) {
      setErrorMessage('字幕にできるテキストがありません。トリミング画面でスクリプトのテキストを確認してください。')
      return
    }
    patch({ cues: generated, stage: 'reviewing' })
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
    patch({ stage: 'burning' })
    setErrorMessage(null)
    try {
      const burned = await burnSubtitles(combinedBlob, cues, position)
      // Reset to 'reviewing' on success too: this state is lifted to the
      // parent and survives unmount, so without this the stage would stay
      // stuck on 'burning' (disabled button, "焼き込み中...") if the user
      // ever navigates back to this step after completing it.
      patch({ stage: 'reviewing' })
      onBurned?.(burned)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      // Back to 'reviewing' (not a separate error stage) so the cues,
      // position controls and next button remain visible and usable —
      // the user can adjust position or just retry burning in.
      patch({ stage: 'reviewing' })
    }
  }

  const hasAnyJapanese = cues.some(c => c.ja !== null)
  const allTranslated = cues.length > 0 && cues.every(c => c.ja !== null && c.ja.trim() !== '')

  return (
    <div className={styles.wrapper}>
      {errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}

      {stage === 'idle' && (
        <button className={styles.genBtn} onClick={handleGenerate}>
          📝 英語字幕を生成
        </button>
      )}

      {(stage === 'reviewing' || stage === 'burning') && cues.length > 0 && (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>英語字幕（必要なら修正してください）</p>
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
                  className={styles.preview}
                  src={previewUrl ?? undefined}
                  controls
                  playsInline
                  onTimeUpdate={e => setPreviewTime(e.currentTarget.currentTime)}
                />
                <SubtitleOverlayPreview cues={cues} position={position} currentTime={previewTime} />
              </div>

              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow}>
                {PRESETS.map(p => (
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
                {stage === 'burning' ? '焼き込み中...' : '次へ'}
              </button>
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
