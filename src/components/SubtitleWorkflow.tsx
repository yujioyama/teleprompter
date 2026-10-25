import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { SubtitleCue, ShotCueInput, buildClaudePrompt, cuesFromShotEntries, parseJapanesePaste, withJapaneseLines, withScriptJapanese, shiftCueStart, setCueStart } from '../utils/subtitleCues'
import { deleteSubtitles, fetchSubtitles, subtitleRequestId } from '../utils/subtitleRequest'
import { useForegroundCheck } from '../hooks/useForegroundCheck'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useObjectUrl } from '../hooks/useObjectUrl'
import {
  SubtitlePosition,
  SUBTITLE_POSITION_BOTTOM,
  SUBTITLE_POSITION_PRESETS,
} from '../utils/subtitlePosition'
import {
  hookOptionsOf,
  oneTakeHookSettings,
  PUNCH_IN_ZOOMS,
  punchInScale,
  followsFrames,
  ZOOM_ANCHOR_Y,
  type HookSettings,
  type PunchInDuration,
  type ZoomDirection,
} from '../utils/subtitleHook'
import { fairiesFromSubtitles } from '../utils/fairyPlan'
import { midZoomScale, planMidZoom } from '../utils/midZoom'
import { reapplyStickers, type StickerPlacement } from '../utils/subtitleSticker'
import type { StickerMotion } from '../utils/stickerMotion'
import { useVideoFrameTime } from '../hooks/useVideoFrameTime'
import SubtitleEditor from './SubtitleEditor'
import SubtitleOverlayPreview from './SubtitleOverlayPreview'
import CancelProcessing from './CancelProcessing'
import { reapplyEmphasis } from '../utils/subtitleEmphasis'
import { raceAbort } from '../utils/cancellation'
import { transcribeSpeech, WhisperProgress } from '../utils/transcribeSpeech'
import type { LineJapanese } from '../types'
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
  /** The first shot's hook settings, kept in useSettings by the parent. */
  hookSettings: HookSettings
  onHookSettingsChange: (patch: Partial<HookSettings>) => void
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
  /**
   * The Claude inbox key (受け取り用キー). With one, the copied prompt asks
   * Claude to send the Japanese back and this step picks it up by itself.
   */
  inboxKey?: string
  /**
   * 一発撮り: the video is one take subtitled line by line. The hook lasts
   * the first line, line starts can be nudged, and there are no fairies or
   * mid-video zooms.
   */
  oneTake?: boolean
  /** The Japanese Claude sent with the script, put on the script's cues as they are made. */
  scriptJapanese?: LineJapanese[]
}

const ZOOM_DIRECTIONS: { label: string; value: ZoomDirection }[] = [
  { label: 'ズームアウト', value: 'out' },
  { label: 'ズームイン', value: 'in' },
]

const ZOOM_SPEEDS: { label: string; value: PunchInDuration }[] = [
  { label: '速い', value: 0.6 },
  { label: '普通', value: 1.2 },
  { label: 'ゆっくり', value: null },
]

const STICKER_PLACEMENT_OPTIONS: { label: string; value: StickerPlacement }[] = [
  { label: '胸元', value: 'chest' },
  { label: '左', value: 'left' },
  { label: '右', value: 'right' },
  { label: 'なし', value: 'off' },
]

const STICKER_MOTION_OPTIONS: { label: string; value: StickerMotion }[] = [
  { label: 'おまかせ', value: 'random' },
  { label: '気まぐれ旅', value: 'wander' },
  { label: 'DVD反射', value: 'bounce' },
  { label: '顔のまわりを周回', value: 'orbit' },
  { label: 'ワープ', value: 'warp' },
  { label: 'ちょこまか', value: 'dash' },
  { label: '動かさない', value: 'none' },
]

/** How far before an adjusted line's start the preview replays from. */
const REPLAY_LEAD_S = 1

const SOURCES: { label: string; value: SubtitleSource }[] = [
  { label: '台本から', value: 'script' },
  { label: '話した音声から', value: 'speech' },
]

export default function SubtitleWorkflow({
  combinedBlob,
  shotCueInputs,
  state,
  onStateChange,
  hookSettings,
  onHookSettingsChange,
  burn,
  onBurned,
  transcribe = transcribeSpeech,
  inboxKey = '',
  oneTake = false,
  scriptJapanese = [],
}: SubtitleWorkflowProps) {
  const { stage, cues, pasteText, position, source } = state
  const hasAnyJapanese = cues.some(c => c.ja !== null)
  const allTranslated = cues.length > 0 && cues.every(c => c.ja !== null && c.ja.trim() !== '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [fineTune, setFineTune] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  // The zoom in is only shown while playing: it would scale (and clip) the native controls.
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const previewUrl = useObjectUrl(combinedBlob)
  const [burnProgress, setBurnProgress] = useState(0)
  const [transcribeProgress, setTranscribeProgress] = useState<WhisperProgress | null>(null)
  const [copyToastVisible, setCopyToastVisible] = useState(false)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  // The cues as they are now, not as some earlier callback saw them: when a
  // Claude answer arrives, and between the steps of a held timing button.
  const latestCuesRef = useRef(cues)
  useLayoutEffect(() => {
    latestCuesRef.current = cues
  })
  // The same element as previewRef, as state, so the frame-time hook
  // re-subscribes when the player mounts (it appears with the first translation).
  const [previewVideo, setPreviewVideo] = useState<HTMLVideoElement | null>(null)
  // Memoized so the fairy plan below isn't recomputed on every render (hookSettings is stable in the parent).
  const hook = useMemo(
    () => hookOptionsOf(oneTake ? oneTakeHookSettings(hookSettings) : hookSettings),
    [hookSettings, oneTake],
  )
  // The first clip of the 結合: hook cues are the ones starting within it.
  // In a 一発撮り take that's its first line.
  const firstShotDuration = oneTake ? (cues[0]?.end ?? null) : (shotCueInputs[0]?.duration ?? null)
  // Read from the subtitles' emoji, so editing them is what the preview shows.
  const fairies = useMemo(
    () => fairiesFromSubtitles(cues, shotCueInputs.map(s => s.duration), hook, position),
    [cues, shotCueInputs, hook, position],
  )
  // Likewise the peaks and the punchline the picture zooms in on.
  const midZoom = useMemo(
    () => planMidZoom(cues, shotCueInputs.map(s => s.duration), hook),
    [cues, shotCueInputs, hook],
  )
  // Frame accuracy only matters around the first shot, the fairies and the
  // zooms; elsewhere onTimeUpdate is enough, and per-frame state would
  // re-render the whole workflow.
  useVideoFrameTime(previewVideo, t => {
    if (followsFrames(t, hook, firstShotDuration, fairies, midZoom)) setPreviewTime(t)
  })
  // Must be stable: an inline arrow would be re-run on every render, setting state each time and looping.
  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    previewRef.current = el
    setPreviewVideo(el)
  }, [])
  // Aborted by 中断する (issue #34) or if this unmounts mid-burn.
  const burnAbortRef = useRef<AbortController | null>(null)
  const transcribeAbortRef = useRef<AbortController | null>(null)

  function patch(changes: Partial<SubtitleState>) {
    onStateChange(prev => ({ ...prev, ...changes }))
  }

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
    const generated = withScriptJapanese(cuesFromShotEntries(shotCueInputs), scriptJapanese)
    if (generated.length === 0) {
      setErrorMessage('字幕にできるテキストがありません。トリミング画面でスクリプトのテキストを確認してください。')
      return
    }
    setErrorMessage(null)
    const missing = generated.filter(c => c.ja === '').length
    if (generated.some(c => c.ja)) {
      setNotice(
        missing > 0
          ? `台本と一緒に届いた日本語訳を入れました（台本を直した${missing}行は空欄です。手で入れるか、Claude用プロンプトで訳せます）`
          : '台本と一緒に届いた日本語訳を入れました',
      )
    }
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
      // The script's *emphasis* (Claude marks it) carries over to what was said.
      // So do each line's emoji: the first shot's sticker and the fairies.
      const scriptTexts = shotCueInputs.map(s => s.text)
      const cues = reapplyStickers(reapplyEmphasis(transcribed, scriptTexts), shotCueInputs)
      patch({ cues, stage: 'reviewing', source: 'speech', pasteText: '' })
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

  // Each timing step builds on the last before React re-renders, and the
  // replay right after it reads the result.
  function applyTiming(next: typeof cues) {
    latestCuesRef.current = next
    patch({ cues: next })
  }

  function handleShiftStart(id: string, delta: number) {
    applyTiming(shiftCueStart(latestCuesRef.current, id, delta))
  }

  function handleStartAtPlayhead(id: string) {
    const video = previewRef.current
    if (!video) return
    applyTiming(setCueStart(latestCuesRef.current, id, video.currentTime))
    handleStartAdjusted(id)
  }

  // Play the adjusted line in from just before it, so the change can be
  // checked at once. Off screen it would only be heard, so there the
  // preview is just left waiting at that point.
  function handleStartAdjusted(id: string) {
    const video = previewRef.current
    const cue = latestCuesRef.current.find(c => c.id === id)
    if (!video || !cue || stage === 'burning') return
    video.currentTime = Math.max(0, cue.start - REPLAY_LEAD_S)
    const { top, bottom } = video.getBoundingClientRect()
    if (top < window.innerHeight && bottom > 0) video.play().catch(() => {})
  }

  function handleEditJa(id: string, text: string) {
    patch({ cues: cues.map(c => (c.id === id ? { ...c, ja: text } : c)) })
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(buildClaudePrompt(cues, inboxKey ? requestId : undefined))
    if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
    setCopyToastVisible(true)
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToastVisible(false)
      copyToastTimerRef.current = null
    }, 2000)
  }

  // Lines Claude sent back through the connector for exactly these English
  // cues: looked for on arrival and whenever the user returns from Claude.
  // While the English is being edited, wait for it to settle rather than
  // asking about every keystroke's version.
  const requestId = subtitleRequestId(cues)
  const settledRequestId = useDebouncedValue(requestId, 500)
  const awaitingClaude = Boolean(inboxKey) && stage === 'reviewing' && cues.length > 0 && !allTranslated
  useForegroundCheck(awaitingClaude ? settledRequestId : null, (id, isStale) => {
    fetchSubtitles(inboxKey, id)
      .then(lines => {
        const current = latestCuesRef.current
        // The English may have moved on while the check was out.
        if (!lines || isStale() || subtitleRequestId(current) !== id) return
        const result = withJapaneseLines(current, lines)
        if (!result.ok) {
          setPasteError(result.error)
          return
        }
        setPasteError(null)
        setNotice('Claudeの日本語訳を反映しました')
        patch({ cues: result.cues })
        deleteSubtitles(inboxKey, id).catch(err => console.error('Failed to clear Claude subtitles', err))
      })
      .catch(err => {
        if (!isStale()) console.error('Failed to check for Claude subtitles', err)
      })
  })

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

  // The zoom in is previewed by zooming the player itself; the subtitle
  // overlay is a sibling of it, so it keeps its size as in the burn.
  const previewZoom = !previewPlaying
    ? 1
    : hook.punchIn && firstShotDuration !== null && previewTime < firstShotDuration
      ? punchInScale(previewTime, hook.punchIn, firstShotDuration)
      : midZoomScale(previewTime, midZoom)

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
            <SubtitleEditor
              cues={cues}
              onEditEn={handleEditEn}
              onEditJa={handleEditJa}
              onShiftStart={oneTake ? handleShiftStart : undefined}
              onStartAtPlayhead={oneTake && hasAnyJapanese ? handleStartAtPlayhead : undefined}
              onStartAdjusted={handleStartAdjusted}
              playheadTime={hasAnyJapanese ? previewTime : null}
            />
            <p className={styles.hint}>*で囲んだ語は黄色で強調されます（例: I *love* it）</p>
            <p className={styles.hint}>最初のショットの字幕に絵文字を入れると、字幕には出さず、大きなステッカーとして最初のショットの間ずっと表示します（例: I put *Vaseline*🧴 on…）</p>
          </div>

          {!allTranslated && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Claudeで日本語訳を作成</p>
              <button className={styles.copyBtn} onClick={handleCopyPrompt}>
                📋 Claude用プロンプトをコピー
              </button>
              {inboxKey && <p className={styles.hint}>Claudeチャットに貼ると、訳がこの画面に自動で入ります</p>}
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
                  ref={attachPreview}
                  className={styles.preview}
                  src={previewUrl ?? undefined}
                  controls={stage !== 'burning'}
                  playsInline
                  style={previewZoom !== 1
                    ? { transform: `scale(${previewZoom})`, transformOrigin: `50% ${Math.round(ZOOM_ANCHOR_Y * 100)}%` }
                    : undefined}
                  onTimeUpdate={e => setPreviewTime(e.currentTarget.currentTime)}
                  onPlay={() => setPreviewPlaying(true)}
                  onPlaying={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  onEnded={() => setPreviewPlaying(false)}
                />
                <SubtitleOverlayPreview
                  cues={cues}
                  position={position}
                  currentTime={previewTime}
                  hook={hook}
                  firstShotDuration={firstShotDuration}
                  fairies={fairies}
                />
              </div>

              <p className={styles.sectionTitle}>字幕の位置</p>
              <div className={styles.positionRow} role="group" aria-label="字幕の位置">
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

              <p className={styles.sectionTitle}>最初のショット（フック）</p>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={hookSettings.hookStyleEnabled}
                  onChange={e => onHookSettingsChange({ hookStyleEnabled: e.target.checked })}
                />
                フック字幕
              </label>
              <p className={styles.hint}>最初のショットの字幕を顔にかからない位置に、1フレーム目から表示します</p>
              <div className={styles.positionRow} role="group" aria-label="フック字幕の位置">
                {SUBTITLE_POSITION_PRESETS.map(p => (
                  <button
                    key={p.label}
                    className={`${styles.positionBtn} ${hookSettings.hookPosition === p.value ? styles.positionBtnActive : ''}`}
                    aria-pressed={hookSettings.hookPosition === p.value}
                    disabled={!hookSettings.hookStyleEnabled}
                    onClick={() => onHookSettingsChange({ hookPosition: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={hookSettings.punchInEnabled}
                  onChange={e => onHookSettingsChange({ punchInEnabled: e.target.checked })}
                />
                ズーム
              </label>
              <p className={styles.hint}>
                {hookSettings.punchInDirection === 'out'
                  ? '1フレーム目から寄った状態で始まり、引いて元の大きさに戻ります。「ゆっくり」は最初のショットの終わりまでかけて戻ります（字幕は拡大しません）'
                  : '最初のショットの途中から寄っていき、2つ目のショットで元に戻ります。「ゆっくり」は最初のショットの終わりまでかけて寄ります（字幕は拡大しません）'}
              </p>
              {hookSettings.punchInEnabled && (
                <>
                  <div className={styles.positionRow} role="group" aria-label="ズームの向き">
                    {ZOOM_DIRECTIONS.map(d => (
                      <button
                        key={d.value}
                        className={`${styles.positionBtn} ${hookSettings.punchInDirection === d.value ? styles.positionBtnActive : ''}`}
                        aria-pressed={hookSettings.punchInDirection === d.value}
                        onClick={() => onHookSettingsChange({ punchInDirection: d.value })}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.positionRow} role="group" aria-label="ズーム倍率">
                    {PUNCH_IN_ZOOMS.map(z => (
                      <button
                        key={z}
                        className={`${styles.positionBtn} ${hookSettings.punchInZoom === z ? styles.positionBtnActive : ''}`}
                        aria-pressed={hookSettings.punchInZoom === z}
                        onClick={() => onHookSettingsChange({ punchInZoom: z })}
                      >
                        {z}倍
                      </button>
                    ))}
                  </div>
                  <div className={styles.positionRow} role="group" aria-label="ズームの速さ">
                    {ZOOM_SPEEDS.map(s => (
                      <button
                        key={s.label}
                        className={`${styles.positionBtn} ${hookSettings.punchInDuration === s.value ? styles.positionBtnActive : ''}`}
                        aria-pressed={hookSettings.punchInDuration === s.value}
                        onClick={() => onHookSettingsChange({ punchInDuration: s.value })}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.fineTuneRow}>
                    <label htmlFor="punch-in-at-slider">動き始めるタイミング {hookSettings.punchInAt.toFixed(1)}秒</label>
                    <input
                      id="punch-in-at-slider"
                      aria-label="動き始めるタイミング"
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={hookSettings.punchInAt}
                      onChange={e => onHookSettingsChange({ punchInAt: Number(e.target.value) })}
                    />
                  </div>
                </>
              )}
              {!oneTake && (
                <>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={hookSettings.midZoomEnabled}
                      onChange={e => onHookSettingsChange({ midZoomEnabled: e.target.checked })}
                    />
                    中盤のズーム
                  </label>
                  <p className={styles.hint}>途中の山場（英語字幕に絵文字がある行）でじわっと寄り、最後のオチはカットの瞬間に寄ります（字幕は拡大しません）</p>
                </>
              )}
              <p className={styles.sectionTitle}>ステッカーの位置</p>
              <div className={styles.positionRow} role="group" aria-label="ステッカーの位置">
                {STICKER_PLACEMENT_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`${styles.positionBtn} ${hookSettings.stickerPlacement === o.value ? styles.positionBtnActive : ''}`}
                    aria-pressed={hookSettings.stickerPlacement === o.value}
                    onClick={() => onHookSettingsChange({ stickerPlacement: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>1つ目の字幕に入れた絵文字を、最初のショットの間ステッカーとして表示します</p>
              {hookSettings.stickerPlacement !== 'off' && (
                <>
                  <p className={styles.sectionTitle}>ステッカーの動き</p>
                  <div className={styles.positionRow} role="group" aria-label="ステッカーの動き">
                    {STICKER_MOTION_OPTIONS.map(o => (
                      <button
                        key={o.value}
                        className={`${styles.positionBtn} ${hookSettings.stickerMotion === o.value ? styles.positionBtnActive : ''}`}
                        aria-pressed={hookSettings.stickerMotion === o.value}
                        onClick={() => onHookSettingsChange({ stickerMotion: o.value })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {hookSettings.stickerMotion !== 'none' && (
                    <p className={styles.hint}>画面を旅して、最初のショットが終わるまでに元の位置に戻ってきます。ルートは動画ごとに決まります（最初のショットが短いと動きません）</p>
                  )}
                  {!oneTake && (
                  <>
                  <p className={styles.sectionTitle}>妖精（途中と締め）</p>
                  <div className={styles.positionRow} role="group" aria-label="妖精（途中と締め）">
                    {[{ label: 'オン', value: true }, { label: 'オフ', value: false }].map(o => (
                      <button
                        key={o.label}
                        className={`${styles.positionBtn} ${hookSettings.fairyEnabled === o.value ? styles.positionBtnActive : ''}`}
                        aria-pressed={hookSettings.fairyEnabled === o.value}
                        onClick={() => onHookSettingsChange({ fairyEnabled: o.value })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className={styles.hint}>途中のショットの英語字幕に入れた絵文字が妖精になって横切り、最後のショットで最初の字幕の絵文字が戻ってきます</p>
                  </>
                  )}
                  {(hookSettings.stickerMotion !== 'none' || (!oneTake && hookSettings.fairyEnabled)) && (
                    <button
                      className={styles.copyBtn}
                      onClick={() => onHookSettingsChange({ stickerRoute: hookSettings.stickerRoute + 1 })}
                    >
                      ルートを変える
                    </button>
                  )}
                </>
              )}

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
                  <label htmlFor="hook-position-slider">フック字幕の上下位置</label>
                  <input
                    id="hook-position-slider"
                    aria-label="フック字幕の上下位置"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={hookSettings.hookPosition}
                    disabled={!hookSettings.hookStyleEnabled}
                    onChange={e => onHookSettingsChange({ hookPosition: Number(e.target.value) })}
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
