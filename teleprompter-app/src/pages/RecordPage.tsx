import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useCamera } from '../hooks/useCamera'
import { useRecorder } from '../hooks/useRecorder'
import { useWakeLock } from '../hooks/useWakeLock'
import CameraPreview from '../components/CameraPreview'
import styles from './RecordPage.module.css'

export default function RecordPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript } = useScripts()
  const script = id ? getScript(id) : undefined

  const [shotIndex, setShotIndex] = useState(0)
  const { videoRef, error: cameraError, ready } = useCamera()
  const { state, startRecording, stopRecording, shareOrDownload, reset } = useRecorder()
  const { supported: wakeLockSupported } = useWakeLock()

  if (!script || script.shots.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  // Narrowed after guard — safeScript is always defined below this point
  const safeScript = script
  const isComplete = shotIndex >= safeScript.shots.length
  // Guard against undefined — currentShot is only used when !isComplete
  const currentShot = safeScript.shots[shotIndex] as (typeof safeScript.shots)[0] | undefined
  const isLast = shotIndex === safeScript.shots.length - 1

  function getFilename() {
    const safeTitle = safeScript.title.replace(/[^a-zA-Z0-9ぁ-ん一-龯ァ-ン]/g, '-')
    const num = String(shotIndex + 1).padStart(3, '0')
    return `${safeTitle}-shot-${num}`
  }

  function handleStop() {
    stopRecording()
    // State transitions to 'stopped' via MediaRecorder.onstop — shareOrDownload
    // is called by the "保存" button after state becomes 'stopped'
  }

  async function handleSave() {
    await shareOrDownload(getFilename())
  }

  function handleNext() {
    reset()
    setShotIndex(i => i + 1)
  }

  function handleRetry() {
    reset()
  }

  function handleRecord() {
    const stream = (videoRef.current?.srcObject as MediaStream) ?? null
    if (!stream) return
    startRecording(stream)
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

      {/* Camera + controls — bottom */}
      <div className={styles.controls}>
        <CameraPreview videoRef={videoRef} />

        <div className={styles.buttons}>
          {state === 'idle' && (
            <button
              className={styles.recordBtn}
              onClick={handleRecord}
              disabled={!ready}
            >
              🔴 録画
            </button>
          )}

          {state === 'recording' && (
            <button className={`${styles.recordBtn} ${styles.recording}`} onClick={handleStop}>
              ⏹ 停止
            </button>
          )}

          {state === 'stopped' && (
            <div className={styles.stoppedActions}>
              <button className={styles.saveBtn} onClick={handleSave}>
                📤 保存
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
        onClick={() => navigate(`/scripts/${safeScript.id}/shots`)}
      >
        ‹ 編集に戻る
      </button>
    </div>
  )
}
