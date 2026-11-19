// teleprompter-app/src/pages/RecordPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { useSettings } from '../hooks/useSettings'
import { saveShotVideo, listShotVideos } from '../utils/shotVideoStore'
import { releaseFFmpeg } from '../utils/ffmpegClient'
import { processRecordedVideo, inferMimeType, type ProcessedVideo } from '../utils/processRecordedVideo'
import { isCardVoiceFile, extractShotId, isVoiceFile, resolveImportTargets, voiceOfVoiceFile, voicesByShotId } from '../utils/matchShotRecordings'
import { analyzeTake } from '../utils/analyzeTake'
import { withSpeakerVoice } from '../utils/speakerVoice'
import { DEVICE_RESTART_HINT, heardShotFailureText, makeHeardShot, makeHeardShotFromVoice, needsDeviceRestart } from '../utils/heardShot'
import { DEFAULT_SPEAKER_ICON } from '../utils/speakers'
import VoiceTry from '../components/VoiceTry'
import { HEARD_VOICES, HEARD_VOICE_LABELS, isHeardVoice, type HeardVoice } from '../utils/voiceEffects'
import { resolveShotTrimSettings } from '../utils/shotTrim'
import { stripEmphasis } from '../utils/subtitleEmphasis'
import { stripStickers } from '../utils/subtitleSticker'
import { Shot } from '../types'
import { saveCardVoice } from '../utils/cardVoiceStore'
import { camShotsOf, cardAfterShot, cardsInOrder } from '../utils/insertCard'
import styles from './RecordPage.module.css'

const CARD_VOICE_FAILED = 'カードの声を保存できませんでした。'

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
  const [bulkImportNotice, setBulkImportNotice] = useState<string | null>(null)
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
    const payload = encodeURIComponent(JSON.stringify(camShotsOf(safeScript).slice(shotIndex)))
    window.location.href = `teleprompter-cam://record?shots=${payload}`
  }

  async function handleImportVideos(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file(s)
    if (picked.length === 0) return
    if (bulkImportProgress) return // a bulk import is already running

    setBulkImportNotice(null)
    // 挿入カード voices come picked with the takes too: each goes to the card after the shot named in its file.
    const cardVoices = picked.filter(isCardVoiceFile)
    const rest = picked.filter(file => !isCardVoiceFile(file))
    // 相手のセリフ voices recorded ahead in the camera app likewise.
    const voices = voicesByShotId(rest.filter(isVoiceFile))
    const files = rest.filter(file => !isVoiceFile(file))
    let cardVoiceFailed = false
    if (cardVoices.length > 0) {
      const cardOfShot = new Map(cardsInOrder(safeScript).map(({ card }) => [card.afterShotId, card.id]))
      let count = 0
      try {
        await Promise.all(cardVoices.map(async file => {
          const shotId = extractShotId(file.name)
          const cardId = shotId ? cardOfShot.get(shotId) : undefined
          if (!cardId) return
          await saveCardVoice(safeScript.id, cardId, file)
          count++
        }))
      } catch (err) {
        console.error('Saving card voices failed', err)
        cardVoiceFailed = true
      }
      if (files.length === 0 && voices.size === 0) {
        setBulkImportError(cardVoiceFailed ? CARD_VOICE_FAILED : null)
        if (!cardVoiceFailed && count > 0) setBulkImportNotice(`カードの声を保存しました（${count}枚）`)
        return
      }
    }
    if (files.length === 0) {
      setBulkImportError('相手の声のファイルだけが選ばれています。動画も一緒に選んでください。')
      return
    }

    const resolution = resolveImportTargets(files, safeScript.shots)

    if (resolution.kind === 'error') {
      setBulkImportError(`一致しないファイルがあります: ${resolution.unmatchedFilenames.join(', ')}`)
      return
    }

    // A take whose name doesn't say its shot (one renamed by the camera
    // roll, say) is the one on screen, and the next shot comes up after it.
    const run = resolution.kind === 'legacy'
      ? currentShot && runBulkImport([{ shot: currentShot, file: resolution.file }], shotIndex + 1, voices, cardVoiceFailed)
      : runBulkImport(resolution.targets, undefined, voices, cardVoiceFailed)
    run?.catch(err => {
      console.error('Bulk import failed unexpectedly', err)
      setBulkImportProgress(null)
      setBulkImportError('インポート中に予期しないエラーが発生しました。')
    })
  }

  // Lands on `nextIndex` when given, else on the first shot still missing a video.
  async function runBulkImport(
    targets: { shot: Shot; file: File }[],
    nextIndex?: number,
    voices: Map<string, File> = new Map(),
    cardVoiceFailed = false,
  ) {
    setBulkImportError(null)
    setBulkImportProgress({ done: 0, total: targets.length })
    const failedShotTexts: string[] = []
    const degradedShotTexts: string[] = []
    const unheardShotTexts: string[] = []
    let restartHint = false
    // A voice picked in the camera app (named in its file) is the line's voice from now on, for every line of that person.
    let shots = safeScript.shots
    for (const { shot } of targets) {
      const picked = voices.has(shot.id) ? voiceOfVoiceFile(voices.get(shot.id)!.name) : null
      if (picked && picked !== (shot.voice ?? 'natural')) shots = withSpeakerVoice(shots, shot.id, picked)
    }
    if (shots !== safeScript.shots && id) updateScript(id, { shots })
    const voiceOf = (shot: Shot) => shots.find(s => s.id === shot.id)?.voice

    for (let i = 0; i < targets.length; i++) {
      const { shot, file } = targets[i]
      try {
        const mimeType = inferMimeType(file)
        // Our own voice gets the noise taken out; a 相手のセリフ or 心の声 take's sound is replaced anyway.
        const ownVoice = !(shot.heard || shot.thought) || safeScript.oneTake
        const processTake = () => processRecordedVideo(file, mimeType, {
          normalizeAudio: globalSettings.normalizeAudio,
          ...(ownVoice ? { noiseReduction: globalSettings.noiseReduction } : {}),
        })
        let processed: ProcessedVideo | null = null
        let take: Blob
        if (ownVoice) {
          processed = await processTake()
          take = processed.blob
        } else {
          // 相手のセリフ: the voice goes over the listening, built straight
          // from the take as it came in. Its own sound is either replaced by
          // the voice recorded ahead or leveled as the line (levelVoice), so
          // bringing it to the target loudness first would only be a pass
          // over the whole take for nothing. A take that can't be turned into
          // that is kept, loudness-corrected as before, to be seen and retaken.
          try {
            const recordedVoice = voices.get(shot.id)
            // 心の声: our own voice, echoed, over the thinking face.
            const thought = shot.thought ? globalSettings.thoughtEcho : undefined
            take = recordedVoice
              ? await makeHeardShotFromVoice(file, recordedVoice, voiceOf(shot), thought)
              : await makeHeardShot(file, voiceOf(shot), thought)
          } catch (err) {
            console.warn('Could not make the 相手のセリフ clip', err)
            unheardShotTexts.push(`${shot.thought ? '心の声: ' : ''}${stripEmphasis(shot.text)}(${heardShotFailureText(err, shot.thought)})`)
            if (needsDeviceRestart(err)) restartHint = true
            processed = await processTake()
            take = processed.blob
          }
        }
        const savedAt = await saveShotVideo(safeScript.id, shot.id, take)
        // Only where the finalize step would look for the speech itself.
        if (safeScript.oneTake || resolveShotTrimSettings(shot, globalSettings).trimEnabled) {
          await analyzeTake(safeScript.id, shot.id, savedAt, take)
        }
        // remuxMp4 always falls back to the original blob on failure, so a
        // take whose conversion failed is still worth saving — just flagged.
        if (processed && !processed.ok) {
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
    if (cardVoiceFailed) messages.push(CARD_VOICE_FAILED)
    if (failedShotTexts.length > 0) {
      messages.push(`保存できなかったショットがあります: ${failedShotTexts.join(', ')}`)
    }
    if (degradedShotTexts.length > 0) {
      messages.push(`動画の変換に失敗したため、元のファイルのまま保存しました: ${degradedShotTexts.join(', ')}`)
    }
    if (unheardShotTexts.length > 0) {
      messages.push(`相手のセリフにできず、撮ったまま保存しました: ${unheardShotTexts.join(', ')}`)
      if (restartHint) messages.push(DEVICE_RESTART_HINT)
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

  // 相手のセリフ: read aloud, then listened to in silence (see planHeardShot).
  const heardHere = Boolean(currentShot?.heard) && !safeScript.oneTake
  // 心の声: the mouth stays shut while the voice plays.
  const thoughtHere = Boolean(currentShot?.thought) && !safeScript.oneTake
  // 挿入カード: nothing to film, only where it goes.
  const cardNext = currentShot ? cardAfterShot(safeScript, currentShot.id) : undefined

  // A line is ours, the other person's, or a thought: never two at once.
  function handleShotHeard(value: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, heard: value || undefined, ...(value ? { thought: undefined } : {}) } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotThought(value: boolean) {
    if (!currentShot || !id) return
    const updatedShots = safeScript.shots.map(s =>
      s.id === currentShot.id ? { ...s, thought: value || undefined, ...(value ? { heard: undefined } : {}) } : s
    )
    updateScript(id, { shots: updatedShots })
  }

  function handleShotVoice(value: HeardVoice) {
    if (!currentShot || !id) return
    updateScript(id, { shots: withSpeakerVoice(safeScript.shots, currentShot.id, value) })
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
        {bulkImportNotice && (
          <p className={styles.importNotice}>{bulkImportNotice}</p>
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
          {heardHere && currentShot && (
            <div className={styles.heardGuide} role="note">
              <span className={styles.heardBadge}>{currentShot.speaker ?? DEFAULT_SPEAKER_ICON} 相手のセリフ</span>
              <span>カメラアプリで先に相手の声を録っておけば、撮影では流れる声を聞くだけ（自動で止まります）。録っていなければ、声に出して読んだら1秒ほど黙って聞く顔をしてから止める</span>
            </div>
          )}
          {thoughtHere && (
            <div className={styles.heardGuide} role="note">
              <span className={styles.heardBadge}>💭 心の声</span>
              <span>カメラアプリで先に心の声を録っておけば、撮影では口を閉じたまま考える顔をするだけ（声が終わると自動で止まります）。録っていなければ、声に出して読んだら1秒ほど考える顔をしてから止める</span>
            </div>
          )}
          <p className={`${styles.promptText} ${heardHere || thoughtHere ? styles.promptTextHeard : ''}`}>
            {currentShot && stripStickers(stripEmphasis(currentShot.text))}
          </p>
          {cardNext && (
            <p className={styles.cardMark} role="note">🎬 このあとにカード「{cardNext}」が入ります（撮るものはありません）</p>
          )}
        </div>

        {/* Per-shot trim settings */}
        {!bulkImportProgress && (
          <div className={styles.shotSettings}>
            <button
              className={styles.shotSettingsToggle}
              onClick={() => setShotSettingsOpen(o => !o)}
            >
              ⚙ このショットの設定{hasOverride || currentShot?.heard || currentShot?.thought ? ' ●' : ''} {shotSettingsOpen ? '▲' : '▼'}
            </button>

            {shotSettingsOpen && (
              <div className={styles.shotSettingsPanel}>
                {/* 相手のセリフ: only where each line is its own take */}
                {!safeScript.oneTake && (
                  <div className={styles.shotSettingsRow}>
                    <div>
                      <div className={styles.shotSettingsLabel}>相手のセリフ</div>
                      <div className={styles.shotSettingsSub}>
                        カメラアプリで先に録った相手の声（.m4a）を動画と一緒にインポートすると、聞いている映像にその声がのります。録っていなければ、セリフを声に出したあと1秒ほど黙って聞く顔を撮ると、聞いている映像（短ければゆっくり再生）に声だけがのります
                      </div>
                    </div>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        aria-label="相手のセリフ"
                        checked={Boolean(currentShot?.heard)}
                        onChange={e => handleShotHeard(e.target.checked)}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>
                )}
                {!safeScript.oneTake && (
                  <div className={styles.shotSettingsRow}>
                    <div>
                      <div className={styles.shotSettingsLabel}>心の声</div>
                      <div className={styles.shotSettingsSub}>
                        口を動かさずに思っている行です。カメラアプリで先に録った声（.m4a）を動画と一緒にインポートすると、考えている映像に自分の声がエコーつきでのります
                      </div>
                    </div>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        aria-label="心の声"
                        checked={Boolean(currentShot?.thought)}
                        onChange={e => handleShotThought(e.target.checked)}
                      />
                      <span className={styles.toggleTrack} />
                    </label>
                  </div>
                )}
                {!safeScript.oneTake && currentShot?.heard && (
                  <div className={styles.shotSettingsRow}>
                    <div>
                      <div className={styles.shotSettingsLabel}>相手の声</div>
                      <div className={styles.shotSettingsSub}>同じ相手のセリフ全部にかかります。インポートするときにかかるので、変えたら動画をもう一度インポートしてください</div>
                    </div>
                    <select
                      aria-label="相手の声"
                      value={currentShot.voice ?? 'natural'}
                      onChange={e => isHeardVoice(e.target.value) && handleShotVoice(e.target.value)}
                    >
                      {HEARD_VOICES.map(voice => (
                        <option key={voice} value={voice}>{HEARD_VOICE_LABELS[voice]}</option>
                      ))}
                    </select>
                    <VoiceTry voice={currentShot.voice ?? 'natural'} />
                  </div>
                )}
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
                accept="video/*,audio/*,.m4a"
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

          {!bulkImportProgress && bulkImportNotice && (
            <p className={styles.importNotice}>{bulkImportNotice}</p>
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
                  {shot.heard && !safeScript.oneTake && (
                    <span className={styles.shotListHeard} aria-label="相手のセリフ">{shot.speaker ?? DEFAULT_SPEAKER_ICON}</span>
                  )}
                  {shot.thought && !safeScript.oneTake && (
                    <span className={styles.shotListHeard} aria-label="心の声">💭</span>
                  )}
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
