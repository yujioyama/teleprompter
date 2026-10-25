// teleprompter-app/src/pages/RecordPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { saveShotVideo, listShotVideos } from '../utils/shotVideoStore'
import { releaseFFmpeg } from '../utils/ffmpegClient'
import { processRecordedVideo, inferMimeType } from '../utils/processRecordedVideo'
import { resolveImportTargets } from '../utils/matchShotRecordings'
import { stripEmphasis } from '../utils/subtitleEmphasis'
import { stripStickers } from '../utils/subtitleSticker'
import { Shot } from '../types'
import styles from './RecordPage.module.css'

export default function RecordPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()
  const [globalSettings] = useSettings()
  const script = id ? getScript(id) : undefined

  const [shotIndex, setShotIndex] = useState(0)
  const importInputRef = useRef<HTMLInputElement>(null)
  const mainScrollRef = useRef<HTMLDivElement>(null)

  const [shotSettingsOpen, setShotSettingsOpen] = useState(false)
  const [shotListOpen, setShotListOpen] = useState(false)
  const [bulkImportError, setBulkImportError] = useState<string | null>(null)
  const [bulkImportProgress, setBulkImportProgress] = useState<{ done: number; total: number } | null>(null)

  // Scroll the prompt text back to the top whenever another shot comes up —
  // after an import or jumping to another shot.
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 })
  }, [shotIndex])

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

  // Effective settings: shot override ?? global
  const effectiveTrimEnabled = currentShot?.trimEnabled ?? globalSettings.trimEnabled
  const effectiveTrimPaddingStart = currentShot?.trimPaddingStart ?? globalSettings.trimPaddingStart
  const effectiveTrimPaddingEnd = currentShot?.trimPaddingEnd ?? globalSettings.trimPaddingEnd
  const hasOverride =
    currentShot?.trimEnabled !== undefined ||
    currentShot?.trimPaddingStart !== undefined ||
    currentShot?.trimPaddingEnd !== undefined

  function handleJumpToShot(index: number) {
    setShotSettingsOpen(false)
    setShotIndex(index)
    setShotListOpen(false)
  }

  // Hands the remaining shots (from the current one onward) to the native
  // Cinematic-capture companion app (github.com/yujioyama/teleprompter-cam),
  // which is the only way to record — there is no in-browser camera anymore.
  function handleRecordInNativeApp() {
    const payload = encodeURIComponent(JSON.stringify(safeScript.shots.slice(shotIndex)))
    window.location.href = `teleprompter-cam://record?shots=${payload}`
  }

  function handleImportVideos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file(s)
    if (files.length === 0) return
    if (bulkImportProgress) return // a bulk import is already running

    const resolution = resolveImportTargets(files, safeScript.shots)

    if (resolution.kind === 'error') {
      setBulkImportError(`一致しないファイルがあります: ${resolution.unmatchedFilenames.join(', ')}`)
      return
    }

    // A take whose name doesn't say its shot (one renamed by the camera
    // roll, say) is the one on screen, and the next shot comes up after it.
    const run = resolution.kind === 'legacy'
      ? currentShot && runBulkImport([{ shot: currentShot, file: resolution.file }], shotIndex + 1)
      : runBulkImport(resolution.targets)
    run?.catch(err => {
      console.error('Bulk import failed unexpectedly', err)
      setBulkImportProgress(null)
      setBulkImportError('インポート中に予期しないエラーが発生しました。')
    })
  }

  // Lands on `nextIndex` when given, else on the first shot still missing a video.
  async function runBulkImport(targets: { shot: Shot; file: File }[], nextIndex?: number) {
    setBulkImportError(null)
    setBulkImportProgress({ done: 0, total: targets.length })
    const failedShotTexts: string[] = []
    const degradedShotTexts: string[] = []

    for (let i = 0; i < targets.length; i++) {
      const { shot, file } = targets[i]
      try {
        const mimeType = inferMimeType(file)
        const processed = await processRecordedVideo(file, mimeType, { normalizeAudio: globalSettings.normalizeAudio })
        // remuxMp4 always falls back to the original blob on failure, so this
        // is still worth saving — just flagged as degraded rather than dropped.
        await saveShotVideo(safeScript.id, shot.id, processed.blob)
        if (!processed.ok) {
          degradedShotTexts.push(stripEmphasis(shot.text))
        }
      } catch (err) {
        console.error('Failed to import a recorded shot video', err)
        failedShotTexts.push(stripEmphasis(shot.text))
      }
      setBulkImportProgress({ done: i + 1, total: targets.length })
    }

    // Free ffmpeg.wasm's grown heap before the user moves on to finalize.
    releaseFFmpeg()
    setBulkImportProgress(null)

    const messages: string[] = []
    if (failedShotTexts.length > 0) {
      messages.push(`保存できなかったショットがあります: ${failedShotTexts.join(', ')}`)
    }
    if (degradedShotTexts.length > 0) {
      messages.push(`動画の変換に失敗したため、元のファイルのまま保存しました: ${degradedShotTexts.join(', ')}`)
    }
    if (messages.length > 0) {
      setBulkImportError(messages.join(' / '))
    }

    setShotSettingsOpen(false)
    if (nextIndex !== undefined) {
      // Stay on the shot when its take couldn't be saved, so it can be tried again.
      if (failedShotTexts.length === 0) setShotIndex(nextIndex)
      return
    }
    const stored = await listShotVideos(safeScript.id)
    const savedIds = new Set(stored.map(v => v.shotId))
    const firstMissing = safeScript.shots.findIndex(s => !savedIds.has(s.id))
    setShotIndex(firstMissing === -1 ? safeScript.shots.length : firstMissing)
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
        {bulkImportError && (
          <p className={styles.persistError}>{bulkImportError}</p>
        )}
        <button
          className={styles.finalizeBtn}
          onClick={() => navigate(`/scripts/${safeScript.id}/finalize`)}
        >
          🎬 動画を仕上げる
        </button>
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
      <div className={styles.mainScroll} ref={mainScrollRef}>
        {/* Shot counter — tap to open shot list */}
        <button
          className={styles.counter}
          onClick={() => setShotListOpen(true)}
          disabled={bulkImportProgress !== null}
        >
          {shotIndex + 1} / {safeScript.shots.length} ≡
        </button>

        {/* Teleprompter text — top of screen, near front camera */}
        <div className={styles.promptArea}>
          <p className={styles.promptText}>{currentShot && stripStickers(stripEmphasis(currentShot.text))}</p>
        </div>

        {/* Per-shot trim settings */}
        {!bulkImportProgress && (
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
          {!bulkImportProgress && (
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
                📁 動画をインポート
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="video/*"
                multiple
                aria-label="録画した動画をインポート"
                onChange={handleImportVideos}
                className={styles.hiddenFileInput}
              />
            </>
          )}

          {bulkImportProgress && (
            <div className={styles.remuxing}>
              インポート中 ({bulkImportProgress.done}/{bulkImportProgress.total})...
            </div>
          )}

          {!bulkImportProgress && bulkImportError && (
            <p className={styles.persistError}>{bulkImportError}</p>
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
                  <span className={styles.shotListText}>{stripStickers(stripEmphasis(shot.text))}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
