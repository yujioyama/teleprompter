// teleprompter-app/src/pages/RecordPage.tsx
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { useRecorder } from '../hooks/useRecorder'
import VideoReviewModal from '../components/VideoReviewModal'
import styles from './RecordPage.module.css'

export default function RecordPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()
  const [globalSettings] = useSettings()
  const script = id ? getScript(id) : undefined

  const [shotIndex, setShotIndex] = useState(0)
  const { state, importFile, shareOrDownload, reset, blobRef } = useRecorder()
  const importInputRef = useRef<HTMLInputElement>(null)

  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [shotSettingsOpen, setShotSettingsOpen] = useState(false)
  const [shotListOpen, setShotListOpen] = useState(false)

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
  const effectiveTrimPaddingStart = currentShot?.trimPaddingStart ?? globalSettings.trimPaddingStart
  const effectiveTrimPaddingEnd = currentShot?.trimPaddingEnd ?? globalSettings.trimPaddingEnd
  const hasOverride =
    currentShot?.trimEnabled !== undefined ||
    currentShot?.trimPaddingStart !== undefined ||
    currentShot?.trimPaddingEnd !== undefined

  function getFilename() {
    const safeTitle = safeScript.title.replace(/[^a-zA-Z0-9ぁ-ん一-龯ァ-ン]/g, '-')
    const num = String(shotIndex + 1).padStart(3, '0')
    return `${safeTitle}-shot-${num}`
  }

  async function handleSaveAndNext() {
    const saved = await shareOrDownload(getFilename())
    if (!saved) return  // user cancelled — stay on current shot
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }

  function handleSkipAndNext() {
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(i => i + 1)
  }

  function handleJumpToShot(index: number) {
    closeModal()
    reset()
    setShotSettingsOpen(false)
    setShotIndex(index)
    setShotListOpen(false)
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

  // Hands the remaining shots (from the current one onward) to the native
  // Cinematic-capture companion app (github.com/yujioyama/teleprompter-cam),
  // which is the only way to record — there is no in-browser camera anymore.
  function handleRecordInNativeApp() {
    const payload = encodeURIComponent(JSON.stringify(safeScript.shots.slice(shotIndex)))
    window.location.href = `teleprompter-cam://record?shots=${payload}`
  }

  function handleImportFromCameraRoll(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    importFile(file, {
      trimEnabled: effectiveTrimEnabled,
      trimPaddingStart: effectiveTrimPaddingStart,
      trimPaddingEnd: effectiveTrimPaddingEnd,
      normalizeAudio: globalSettings.normalizeAudio,
    })
  }

  function handleToggleOverride(enabled: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id
        ? {
            ...s,
            trimEnabled: enabled ? globalSettings.trimEnabled : undefined,
            trimPaddingStart: enabled ? globalSettings.trimPaddingStart : undefined,
            trimPaddingEnd: enabled ? globalSettings.trimPaddingEnd : undefined,
          }
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

  function handleShotTrimPaddingStart(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPaddingStart: value } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotTrimPaddingEnd(value: number) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, trimPaddingEnd: value } : s
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
      <div className={styles.mainScroll}>
        {/* Shot counter — tap to open shot list */}
        <button className={styles.counter} onClick={() => setShotListOpen(true)}>
          {shotIndex + 1} / {safeScript.shots.length} ≡
        </button>

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
                        <div className={styles.shotSettingsLabel}>前に残す時間</div>
                        <span className={styles.sliderValue}>{effectiveTrimPaddingStart.toFixed(1)}秒</span>
                      </div>
                      <input
                        type="range"
                        className={styles.shotSlider}
                        min={0.2}
                        max={2.0}
                        step={0.1}
                        value={effectiveTrimPaddingStart}
                        onChange={e => handleShotTrimPaddingStart(parseFloat(e.target.value))}
                        disabled={!effectiveTrimEnabled}
                      />
                    </div>

                    <div className={`${styles.sliderGroup} ${!effectiveTrimEnabled ? styles.overrideDisabled : ''}`}>
                      <div className={styles.sliderGroupHeader}>
                        <div className={styles.shotSettingsLabel}>後ろに残す時間</div>
                        <span className={styles.sliderValue}>{effectiveTrimPaddingEnd.toFixed(1)}秒</span>
                      </div>
                      <input
                        type="range"
                        className={styles.shotSlider}
                        min={0.2}
                        max={2.0}
                        step={0.1}
                        value={effectiveTrimPaddingEnd}
                        onChange={e => handleShotTrimPaddingEnd(parseFloat(e.target.value))}
                        disabled={!effectiveTrimEnabled}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls — bottom (fixed dock) */}
      <div className={styles.controls}>
        <div className={styles.buttons}>
          {state === 'idle' && (
            <>
              <button
                className={styles.recordBtn}
                onClick={handleRecordInNativeApp}
              >
                🔴 撮影開始
              </button>
              <button
                className={styles.importBtn}
                onClick={() => importInputRef.current?.click()}
              >
                🖼 カメラロールからインポート
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="video/*"
                onChange={handleImportFromCameraRoll}
                className={styles.hiddenFileInput}
              />
            </>
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
              <div className={styles.saveGroup}>
                <button className={styles.nextBtn} onClick={handleSaveAndNext}>
                  {isLast ? '保存して完了 ✓' : '保存して次へ →'}
                </button>
                <button className={styles.skipBtn} onClick={handleSkipAndNext}>
                  {isLast ? '保存せずに完了' : '保存せずに次へ'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Back navigation */}
      <button
        className={styles.backBtn}
        onClick={() => {
          closeModal()
          navigate(`/scripts/${safeScript.id}/shots`)
        }}
      >
        ‹ 編集に戻る
      </button>

      {/* Shot list overlay */}
      {shotListOpen && (
        <div className={styles.shotListOverlay} onClick={() => setShotListOpen(false)}>
          <div className={styles.shotListPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.shotListHeader}>
              <span>ショットを選択</span>
              <button onClick={() => setShotListOpen(false)}>✕</button>
            </div>
            <div className={styles.shotListScroll}>
              {safeScript.shots.map((shot, i) => (
                <button
                  key={shot.id}
                  className={`${styles.shotListItem} ${i === shotIndex ? styles.shotListItemActive : ''}`}
                  onClick={() => handleJumpToShot(i)}
                >
                  <span className={styles.shotListNum}>{i + 1}</span>
                  <span className={styles.shotListText}>{shot.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isReviewing && reviewUrl && (
        <VideoReviewModal url={reviewUrl} onClose={closeModal} />
      )}
    </div>
  )
}
