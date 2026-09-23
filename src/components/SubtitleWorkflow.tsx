import { useEffect, useRef, useState } from 'react'
import { SubtitleCue, buildClaudePrompt, parseJapanesePaste } from '../utils/subtitleCues'
import { transcribeSpeech } from '../utils/transcribeSpeech'
import { burnSubtitles } from '../utils/burnSubtitles'
import { SubtitlePosition } from '../utils/subtitlePosition'
import { shareOrDownload } from '../utils/shareOrDownload'
import SubtitleEditor from './SubtitleEditor'
import styles from './SubtitleWorkflow.module.css'

interface SubtitleWorkflowProps {
  combinedBlob: Blob
  filenameBase: string
  onBurned?: (blob: Blob) => void
}

type Stage = 'idle' | 'transcribing' | 'reviewing' | 'burning' | 'done' | 'error'

export default function SubtitleWorkflow({ combinedBlob, filenameBase, onBurned }: SubtitleWorkflowProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [position, setPosition] = useState<SubtitlePosition>('bottom')
  const [burnedUrl, setBurnedUrl] = useState<string | null>(null)
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)
  const burnedUrlRef = useRef<string | null>(null)

  // Revoke the burned-video preview object URL whenever it changes or on unmount
  useEffect(() => {
    return () => {
      if (burnedUrlRef.current) {
        URL.revokeObjectURL(burnedUrlRef.current)
      }
    }
  }, [])

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
      if (burnedUrlRef.current) {
        URL.revokeObjectURL(burnedUrlRef.current)
      }
      const url = URL.createObjectURL(burned)
      burnedUrlRef.current = url
      setBurnedBlob(burned)
      setBurnedUrl(url)
      setStage('done')
      onBurned?.(burned)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  async function handleSaveBurned() {
    if (!burnedBlob) return
    await shareOrDownload(burnedBlob, `${filenameBase}-subtitled`)
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

      {(stage === 'reviewing' || stage === 'burning' || stage === 'done') && cues.length > 0 && (
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
              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow}>
                {(['top', 'center', 'bottom'] as const).map(p => (
                  <button
                    key={p}
                    className={`${styles.positionBtn} ${position === p ? styles.positionBtnActive : ''}`}
                    onClick={() => setPosition(p)}
                  >
                    {p === 'top' ? '上部' : p === 'center' ? '中央' : '下部'}
                  </button>
                ))}
              </div>
              <button
                className={styles.genBtn}
                onClick={handleBurnIn}
                disabled={!allTranslated || stage === 'burning'}
              >
                {stage === 'burning' ? '焼き込み中...' : '字幕を焼き込む'}
              </button>
            </div>
          )}
        </>
      )}

      {stage === 'error' && errorMessage && (
        <p className={styles.error}>エラーが発生しました: {errorMessage}</p>
      )}

      {stage === 'done' && burnedUrl && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>字幕付き動画</p>
          <video className={styles.preview} src={burnedUrl} controls playsInline />
          <button className={styles.genBtn} onClick={handleSaveBurned}>
            保存する
          </button>
        </div>
      )}
    </div>
  )
}
