import { useState } from 'react'
import { SubtitleCue, buildClaudePrompt, parseJapanesePaste } from '../utils/subtitleCues'
import { transcribeSpeech } from '../utils/transcribeSpeech'
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

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  onBurned?: (blob: Blob) => void
}

type Stage = 'idle' | 'transcribing' | 'reviewing' | 'burning' | 'error'

const PRESETS: { label: string; value: SubtitlePosition }[] = [
  { label: '上部', value: SUBTITLE_POSITION_TOP },
  { label: '中央', value: SUBTITLE_POSITION_CENTER },
  { label: '下部', value: SUBTITLE_POSITION_BOTTOM },
]

export default function SubtitleWorkflow({ combinedBlob, onBurned }: SubtitleWorkflowProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [position, setPosition] = useState<SubtitlePosition>(SUBTITLE_POSITION_BOTTOM)
  const [fineTune, setFineTune] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const previewUrl = URL.createObjectURL(combinedBlob)

  async function handleGenerate() {
    setStage('transcribing')
    setErrorMessage(null)
    try {
      const generated = await transcribeSpeech(combinedBlob)
      setCues(generated)
      setStage('reviewing')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  function handleEditEn(id: string, text: string) {
    setCues(prev => prev.map(c => (c.id === id ? { ...c, en: text } : c)))
  }

  function handleEditJa(id: string, text: string) {
    setCues(prev => prev.map(c => (c.id === id ? { ...c, ja: text } : c)))
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(buildClaudePrompt(cues))
  }

  function handleApplyPaste() {
    const result = parseJapanesePaste(pasteText, cues)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    setPasteError(null)
    setCues(result.cues)
  }

  async function handleBurnIn() {
    setStage('burning')
    setErrorMessage(null)
    try {
      const burned = await burnSubtitles(combinedBlob, cues, position)
      onBurned?.(burned)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  const hasAnyJapanese = cues.some(c => c.ja !== null)
  const allTranslated = cues.length > 0 && cues.every(c => c.ja !== null && c.ja.trim() !== '')

  return (
    <div className={styles.wrapper}>
      {stage === 'idle' && (
        <button className={styles.genBtn} onClick={handleGenerate}>
          🎤 英語字幕を生成
        </button>
      )}

      {stage === 'transcribing' && (
        <p className={styles.sectionTitle}>字幕を生成中...（初回はモデルのダウンロードが入ります）</p>
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
                onChange={e => setPasteText(e.target.value)}
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
                  src={previewUrl}
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
                    onClick={() => setPosition(p.value)}
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
                    onChange={e => setPosition(Number(e.target.value))}
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

      {stage === 'error' && errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}
    </div>
  )
}
