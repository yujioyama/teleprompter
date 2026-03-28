// teleprompter-app/src/pages/RecordPage.tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { useCamera } from '../hooks/useCamera'
import { useRecorder } from '../hooks/useRecorder'
import { useWakeLock } from '../hooks/useWakeLock'
import CameraPreview from '../components/CameraPreview'
import VideoReviewModal from '../components/VideoReviewModal'
import styles from './RecordPage.module.css'

export default function RecordPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()
  const [globalSettings] = useSettings()
  const script = id ? getScript(id) : undefined

  const [shotIndex, setShotIndex] = useState(0)
  const { videoRef, error: cameraError, ready, restart: restartCamera } = useCamera()
  const { state, startRecording, stopRecording, shareOrDownload, reset, blobRef } = useRecorder()
  const { supported: wakeLockSupported } = useWakeLock()

  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [shotSettingsOpen, setShotSettingsOpen] = useState(false)

  if (!script || script.shots.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  const safeScript = script
  const isComplete = shotIndex >= safeScript.shots.length
  const currentShot = safeScript.shots[shotIndex] as (typeof safeScript.shots)[0] | undefined
  const isLast = shotIndex === safeScript.shots.length - 1

  // Effective settings: shot override ?? global
  const effectiveTrimEnabled = currentShot?.trimEnabled ?? globalSettings.trimEnabled
  const effectiveTrimPadding = currentShot?.trimPadding ?? globalSettings.trimPadding
  const hasOverride = currentShot?.trimEnabled !== undefined || currentShot?.trimPadding !== undefined

  function getFilename() {
    const safeTitle = safeScript.title.replace(/[^a-zA-Z0-9ぁ-ん一-龯ァ-ン]/g, '-')
    const num = String(shotIndex + 1).padStart(3, '0')
    return `${safeTitle}-shot-${num}`
  }

  function handleStop() {
    stopRecording()
  }

  async function handleNext() {
    try {
      await shareOrDownload(getFilename())
    } catch {
      // save cancelled or failed — still advance
    }
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }

  function openModal() {
    if (isReviewing) return
    if (!blobRef.current) return
    try {
      const url = URL.createObjectURL(blobRef.current)
      setReviewUrl(url)
      setIsReviewing(true)
    } catch (err) {
      console.error('createObjectURL failed', err)
    }
  }

  function closeModal() {
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl)
    }
    setReviewUrl(null)
    setIsReviewing(false)
  }

  function handleRetry() {
    closeModal()
    reset()
    setShotSettingsOpen(false)
  }

  function handleRecord() {
    if (state !== 'idle') return
    const stream = (videoRef.current?.srcObject as MediaStream) ?? null
    if (!stream) return
    startRecording(stream, { trimEnabled: effectiveTrimEnabled, trimPadding: effectiveTrimPadding })
  }

  function handleToggleOverride(enabled: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id
        ? { ...s, trimEnabled: enabled ? globalSettings.trimEnabled : undefined, trimPadding: enabled ? globalSettings.trimPadding : undefined }
        : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimEnabled(value: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimEnabled: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimPadding(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPadding: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  if (isComplete) {
    return (
      <div className={styles.complete}>
        <div className={styles.completeIcon}>🎉</div>
        <h2 className={styles.completeTitle}>撮影完了！</h2>
        <p className={styles.completeSub}>
          {safeScript.shots.length}ショット すべて録画しました
        </p>
        <button
          className={styles.doneBtn}
          onClick={() => navigate(`/scripts/${safeScript.id}/shots`)}
        >
          ショット一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Wake Lock warning */}
      {!wakeLockSupported && (
        <div className={styles.wakeLockWarning}>
          ⚠️ 画面オフに注意してください（iOS 16.4未満では自動防止できません）
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className={styles.errorBanner}>{cameraError}</div>
      )}

      {/* Shot counter */}
      <div className={styles.counter}>
        {shotIndex + 1} / {safeScript.shots.length}
      </div>

      {/* Teleprompter text — top of screen, near front camera */}
      <div className={styles.promptArea}>
        <p className={styles.promptText}>{currentShot?.text}</p>
      </div>

      {/* Per-shot trim settings */}
      {state === 'idle' && (
        <div className={styles.shotSettings}>
          <button
            className={styles.shotSettingsToggle}
            onClick={() => setShotSettingsOpen(o => !o)}
          >
            ⚙ このショットの設定{hasOverride ? ' ●' : ''} {shotSettingsOpen ? '▲' : '▼'}
          </button>

          {shotSettingsOpen && (
            <div className={styles.shotSettingsPanel}>
              {/* Use global / override toggle */}
              <div className={styles.shotSettingsRow}>
                <div>
                  <div className={styles.shotSettingsLabel}>グローバル設定を使用</div>
                  <div className={styles.shotSettingsSub}>
                    {hasOverride ? 'このショット専用の設定を使用中' : '設定ページの値を使用中'}
                  </div>
                </div>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={!hasOverride}
                    // checked=true means "use global" (no override), so checked→false means "enable override"
                    onChange={e => handleToggleOverride(!e.target.checked)}
                  />
                  <span className={styles.toggleTrack} />
                </label>
              </div>

              {/* Per-shot controls — only shown when override is active */}
              {hasOverride && (
                <>
                  <div className={styles.shotSettingsRow}>
                    <div className={styles.shotSettingsLabel}>自動トリミング</div>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={effectiveTrimEnabled}
                        onChange={e => handleShotTrimEnabled(e.target.checked)}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>

                  <div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
                    <div className={styles.sliderGroupHeader}>
                      <div className={styles.shotSettingsLabel}>前後に残す時間</div>
                      <span className={styles.sliderValue}>{effectiveTrimPadding.toFixed(1)}秒</span>
                    </div>
                    <input
                      type="range"
                      className={styles.shotSlider}
                      min={0.2}
                      max={2.0}
                      step={0.1}
                      value={effectiveTrimPadding}
                      onChange={e => handleShotTrimPadding(parseFloat(e.target.value))}
                      disabled={!effectiveTrimEnabled}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Camera + controls — bottom */}
      <div className={styles.controls}>
        <CameraPreview videoRef={videoRef} />

        <div className={styles.buttons}>
          {state === 'idle' && (
            <>
              <button
                className={styles.recordBtn}
                onClick={handleRecord}
                disabled={!ready}
              >
                🔴 録画
              </button>
              <button
                className={styles.micRestartBtn}
                onClick={restartCamera}
              >
                🎙 マイク再接続
              </button>
            </>
          )}

          {state === 'recording' && (
            <button className={`${styles.recordBtn} ${styles.recording}`} onClick={handleStop}>
              ⏹ 停止
            </button>
          )}

          {state === 'remuxing' && (
            <div className={styles.remuxing}>
              🔄 変換中...
            </div>
          )}

          {state === 'stopped' && (
            <div className={styles.stoppedActions}>
              <button className={styles.playBtn} onClick={openModal} aria-label="録画を再生">
                ▶ 再生
              </button>
              <button className={styles.retryBtn} onClick={handleRetry}>
                もう一度
              </button>
              <button className={styles.nextBtn} onClick={handleNext}>
                {isLast ? '完了 ✓' : '次へ →'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Back navigation */}
      <button
        className={styles.backBtn}
        onClick={() => {
          if (state === 'recording') stopRecording()
          closeModal()
          navigate(`/scripts/${safeScript.id}/shots`)
        }}
      >
        ‹ 編集に戻る
      </button>

      {isReviewing && reviewUrl && (
        <VideoReviewModal url={reviewUrl} onClose={closeModal} />
      )}
    </div>
  )
}
