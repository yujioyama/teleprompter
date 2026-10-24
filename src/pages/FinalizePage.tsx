import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useScripts } from '../hooks/useScripts'
import { listShotVideos } from '../utils/shotVideoStore'
import { listShotAnalyses, updateShotAnalysis, type ShotAnalysis } from '../utils/shotAnalysisStore'
import {
  combinedClipsSignature,
  combinedForTakes,
  loadFinalizeProgress,
  updateFinalizeProgress,
  type FinalizeProgress,
  type SavedCombinedClip,
  type SavedSubtitles,
} from '../utils/finalizeProgressStore'
import { ShotEncodeCache } from '../utils/shotEncodeCache'
import { burnSubtitlesByShot, normalizeRequest, shotBurnRequests, type ShotClip } from '../utils/shotEncoding'
import { canUseWebCodecs } from '../utils/webcodecs/support'
import { probeVideoDuration } from '../utils/probeVideoDuration'
import { detectSpeech, type SpeechBounds, type SpeechRegion } from '../utils/detectSpeechBounds'
import { autoTrimOf, clampTrimRange, resolveShotTrimSettings } from '../utils/shotTrim'
import { shareOrDownload } from '../utils/shareOrDownload'
import { PreparedAudio, mixForExport } from '../utils/preparedAudio'
import { bgmEnding, punchlineStart } from '../utils/bgmStop'
import { transcribeSpeech } from '../utils/transcribeSpeech'
import { fetchTrack } from '../utils/fetchTrack'
import { defaultBgmTrack, useSettings } from '../hooks/useSettings'
import { useCombine, type CombinePhase } from '../hooks/useCombine'
import { useExport } from '../hooks/useExport'
import { useSaveWhenSettled } from '../hooks/useSaveWhenSettled'
import { hookOptionsOf, oneTakeHookSettings, type HookSettings } from '../utils/subtitleHook'
import { stripEmphasis } from '../utils/subtitleEmphasis'
import ShotTrimmer from '../components/ShotTrimmer'
import CancelProcessing from '../components/CancelProcessing'
import SubtitleWorkflow, { INITIAL_SUBTITLE_STATE, SubtitleState } from '../components/SubtitleWorkflow'
import { ShotCueInput, lineStartsInTake, takeLinesOf } from '../utils/subtitleCues'
import MusicMixer, { type MixedVideo } from '../components/MusicMixer'
import CoverMaker from '../components/CoverMaker'
import { coverWordsOf } from '../utils/coverImage'
import WizardSteps, { WizardStepId } from '../components/WizardSteps'
import type { TrimRecord } from '../../shared/videoRecord'
import { buildVideoRecord, type BurnInputs, type MixInputs } from '../utils/videoRecord'
import { postVideoRecord } from '../utils/records'
import styles from './FinalizePage.module.css'

interface ShotEntry {
  shotId: string
  text: string
  blob: Blob | null
  url: string | null
  duration: number
  trimStart: number
  trimEnd: number
  // Where the speech is; undefined until detected, null when there's none.
  speech: SpeechRegion | null | undefined
  // The cut found around the speech (issue #21); null when there's none.
  autoTrim: SpeechBounds | null
  autoTrimPending: boolean
  // Once the user drags a handle, a late detection result must not move it.
  trimEdited: boolean
}


const STEP_ORDER: WizardStepId[] = ['trim', 'subtitle', 'bgm', 'export']

// How long trims or subtitles must stay unchanged before their shots start
// encoding in the background, so a drag or a burst of typing doesn't queue
// an encode per intermediate value.
const BACKGROUND_ENCODE_DELAY_MS = 800
// Likewise for saving hand-set cuts and subtitle work, but short: leaving
// the page right after a drag or an edit must not lose it.
const PROGRESS_SAVE_DELAY_MS = 300

// Stands in for the clips of a 結合 not made yet; one array, so effects
// that depend on the clips don't re-run on every render.
const NO_CLIPS: ShotClip[] = []

function clipOf(entry: ShotEntry): ShotClip {
  return { shotId: entry.shotId, blob: entry.blob!, start: entry.trimStart, end: entry.trimEnd || entry.duration }
}

function trimSignatureOf(clips: Pick<ShotClip, 'shotId' | 'start' | 'end'>[]): string {
  return clips.map(c => `${c.shotId}:${c.start}:${c.end}`).join('|')
}

// The text each shot of a combined video is subtitled with, and for how long.
// A 一発撮り take is subtitled line by line, split at the pauses in its speech.
function cueInputsOf(entries: ShotEntry[], clips: ShotClip[], oneTake = false): ShotCueInput[] {
  return entries.map((entry, i) => {
    const input: ShotCueInput = { text: entry.text, duration: clips[i].end - clips[i].start }
    if (!oneTake) return input
    const lines = takeLinesOf(entry.text)
    return { ...input, lineStarts: lineStartsInTake(lines, clips[i].start, clips[i].end, entry.speech) }
  })
}

function combineLabel(phase: CombinePhase, progress: number): string {
  // Rounded down, so 100% only shows once that phase's work is really done.
  const percent = Math.floor(progress * 100)
  if (phase === 'joining') return '仕上げ中...'
  if (phase === 'unifying') return `再変換中... ${percent}%`
  return `結合中... ${percent}%`
}

function shotMeta(entry: ShotEntry): string {
  if (!entry.url) return '動画なし'
  if (entry.duration === 0) return '…'
  return `${((entry.trimEnd || entry.duration) - entry.trimStart).toFixed(1)}秒`
}

// The detected cut fitted to the shot's duration, or the whole shot.
function autoTrimRange(entry: ShotEntry): Pick<ShotEntry, 'trimStart' | 'trimEnd'> {
  if (!entry.autoTrim) return { trimStart: 0, trimEnd: entry.duration }
  const { start, end } = clampTrimRange(entry.autoTrim.start, entry.autoTrim.end, entry.duration)
  return { trimStart: start, trimEnd: end }
}

function handSetTrimsOf(entries: ShotEntry[]): Pick<ShotClip, 'shotId' | 'start' | 'end'>[] {
  return entries
    .filter(e => e.blob && e.trimEdited)
    .map(e => ({ shotId: e.shotId, start: e.trimStart, end: e.trimEnd }))
}

// Compared to skip writing subtitle work that hasn't changed since loaded or saved.
function subtitlesSignatureOf(subtitles: SavedSubtitles): string {
  return JSON.stringify(subtitles)
}

// The clips of a 結合 tied to the takes they were cut from, for saving.
function savedClipsOf(clips: ShotClip[], takes: Map<string, string>): SavedCombinedClip[] {
  return clips.map(({ shotId, start, end }) => ({ shotId, start, end, videoUpdatedAt: takes.get(shotId)! }))
}

function findLastIndexBefore(entries: ShotEntry[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (entries[i].url) return i
  }
  return -1
}

export default function FinalizePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getScript, updateScript } = useScripts()
  // One settings instance for the page: the subtitle step changes the hook
  // settings through it, so the burn below always sees the current ones.
  const [settings, updateSettings] = useSettings()
  const { hookStyleEnabled, hookPosition, punchInEnabled, punchInZoom, punchInDirection, punchInAt, punchInDuration, stickerPlacement, stickerMotion, stickerRoute, fairyEnabled, midZoomEnabled } = settings
  const { normalizeAudio, voicePreset } = settings
  const defaultTrack = defaultBgmTrack(settings)
  const { bgmVolume, bgmStopBeforePunchline } = settings
  // A re-combine (or a fresh visit) starts the subtitles at the usual spot.
  const initialSubtitleState = (): SubtitleState => ({ ...INITIAL_SUBTITLE_STATE, position: settings.subtitlePosition })
  const script = id ? getScript(id) : undefined
  // The script as of now, for work that finishes after a 間を残す switch.
  const scriptRef = useRef(script)
  scriptRef.current = script

  const [entries, setEntries] = useState<ShotEntry[]>([])
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { status: combineStatus, combined, show: showCombined, combine, cancel: cancelCombine } = useCombine()
  const combinedBlob = combined?.blob ?? null
  const combinedUrl = combined?.url ?? null
  const combinedClips = combined?.clips ?? NO_CLIPS
  const [burnedBlob, setBurnedBlob] = useState<Blob | null>(null)
  const [mixed, setMixed] = useState<MixedVideo | null>(null)
  // What `burnedBlob` and `mixed` were made from, for the video record; only
  // read while those are set. The refs hold the run in flight.
  const [burnInputs, setBurnInputs] = useState<BurnInputs | null>(null)
  const [mixInputs, setMixInputs] = useState<MixInputs | null>(null)
  const burnInputsRef = useRef<BurnInputs | null>(null)
  const mixInputsRef = useRef<MixInputs | null>(null)
  // Lifted up from SubtitleWorkflow so its cues/position/stage/paste-text
  // survive the component unmounting when the wizard leaves the subtitle
  // step and remounting when it comes back (e.g. via goToStep) — otherwise
  // all translation/subtitle work would be lost on back-navigation.
  const [subtitleState, setSubtitleState] = useState<SubtitleState>(initialSubtitleState)
  const [step, setStep] = useState<WizardStepId>('trim')
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([])
  // The BGM step was just entered from a finished burn with a usual BGM
  // set: it mixes that straight away. Coming back to it later never does.
  const [bgmAutoPending, setBgmAutoPending] = useState(false)
  const [preparedAudio] = useState(() => new PreparedAudio())
  const urlsRef = useRef<string[]>([])
  const [captionCopy, setCaptionCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // The export step's cover maker; while open, the final preview is hidden so only one video decodes.
  const [coverOpen, setCoverOpen] = useState(false)
  const captionCopyTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(captionCopyTimerRef.current), [])
  const encodeCacheRef = useRef<ShotEncodeCache | null>(null)
  // Each shot's current take (StoredShotVideo.updatedAt), which saved cuts
  // and the saved 結合 are tied to.
  const takesRef = useRef<Map<string, string>>(new Map())

  // Keep the hand-set cuts, so they survive leaving the page or iOS
  // reloading it. Not until they're loaded, or the saved ones would be
  // overwritten with none.
  const handSetTrims = handSetTrimsOf(entries)
  const markTrimsSaved = useSaveWhenSettled(
    script && !loading && !loadError ? trimSignatureOf(handSetTrims) : null,
    () => {
      const trims = Object.fromEntries(
        handSetTrims.map(t => [t.shotId, { videoUpdatedAt: takesRef.current.get(t.shotId)!, start: t.start, end: t.end }]),
      )
      updateFinalizeProgress(script!.id, { trims }).catch(err =>
        console.warn('[FinalizePage] could not save the trims:', err),
      )
    },
    PROGRESS_SAVE_DELAY_MS,
  )

  // Keep the subtitle work on the current 結合 the same way.
  const subtitlesToSave: SavedSubtitles | null =
    combinedClips.length === 0
      ? null
      : {
          combinedClips: combinedClipsSignature(savedClipsOf(combinedClips, takesRef.current)),
          cues: subtitleState.cues,
          pasteText: subtitleState.pasteText,
          position: subtitleState.position,
          source: subtitleState.source,
        }
  const markSubtitlesSaved = useSaveWhenSettled(
    script && subtitlesToSave ? subtitlesSignatureOf(subtitlesToSave) : null,
    () => {
      updateFinalizeProgress(script!.id, { subtitles: subtitlesToSave! }).catch(err =>
        console.warn('[FinalizePage] could not save the subtitles:', err),
      )
    },
    PROGRESS_SAVE_DELAY_MS,
  )

  // Encodes run in the background only on the hardware (WebCodecs) path:
  // ffmpeg.wasm's memory use made iOS drop the on-screen previews (issue #12).
  function getEncodeCache(): ShotEncodeCache {
    if (!encodeCacheRef.current) {
      encodeCacheRef.current = new ShotEncodeCache(canUseWebCodecs)
    }
    return encodeCacheRef.current
  }

  useEffect(() => {
    return () => {
      encodeCacheRef.current?.dispose()
      encodeCacheRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!script) return
    let cancelled = false

    listShotVideos(script.id).then(async stored => {
      const takes = new Map(stored.map(v => [v.shotId, v.updatedAt]))
      // An unreadable cache only means analysing every shot again.
      const analyses = await listShotAnalyses(script.id, takes).catch(err => {
        console.warn('[FinalizePage] could not read stored shot analyses:', err)
        return new Map<string, ShotAnalysis>()
      })
      // Likewise an unreadable save only means trimming and combining again.
      const progress = await loadFinalizeProgress(script.id).catch((err): FinalizeProgress => {
        console.warn('[FinalizePage] could not read the saved trims and 結合:', err)
        return { trims: {}, combined: null, subtitles: null }
      })
      return { stored, takes, analyses, progress }
    }).then(({ stored, takes, analyses, progress }) => {
      if (cancelled) return
      takesRef.current = takes
      const byShotId = new Map(stored.map(v => [v.shotId, v.blob]))
      // The first and last shots with a take open and close the video, and
      // get their own lead-in and ending.
      const firstShotId = script.shots.find(shot => byShotId.has(shot.id))?.id
      const lastShotId = script.shots.filter(shot => byShotId.has(shot.id)).at(-1)?.id
      const trimSettings = new Map(
        script.shots.map(shot => [
          shot.id,
          resolveShotTrimSettings(shot, settings, shot.id === firstShotId, shot.id === lastShotId),
        ]),
      )
      const next = script.shots.map(shot => {
        const blob = byShotId.get(shot.id) ?? null
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) urlsRef.current.push(url)
        const trim = trimSettings.get(shot.id)!
        // What earlier visits already found for this take (see shotAnalysisStore).
        const known = analyses.get(shot.id)
        // A 一発撮り take is split into its lines at the pauses in its speech,
        // so its speech is found even when it isn't trimmed.
        const speech = trim.trimEnabled || script.oneTake ? known?.speech : null
        // A cut set by hand on an earlier visit, unless the shot was retaken since.
        const saved = progress.trims[shot.id]
        const handSet = blob && saved?.videoUpdatedAt === takes.get(shot.id) ? saved : undefined
        const entry: ShotEntry = {
          shotId: shot.id, text: shot.text, blob, url, duration: known?.duration ?? 0,
          trimStart: handSet?.start ?? 0, trimEnd: handSet?.end ?? 0,
          speech,
          autoTrim: speech && trim.trimEnabled ? autoTrimOf(speech, trim) : null,
          autoTrimPending: blob !== null && speech === undefined,
          trimEdited: handSet !== undefined,
        }
        return entry.duration > 0 && !entry.trimEdited ? { ...entry, ...autoTrimRange(entry) } : entry
      })
      setEntries(next)
      markTrimsSaved(trimSignatureOf(handSetTrimsOf(next)))
      // Back where 結合 left off, as long as it's still these takes.
      const withVideo = next.filter(e => e.blob)
      const combined = combinedForTakes(progress.combined, withVideo.map(e => [e.shotId, takes.get(e.shotId)!]))
      if (combined) {
        const clips = combined.clips.map((clip, i) => ({ ...clip, blob: withVideo[i].blob! }))
        showCombined({ blob: combined.blob, clips, cueInputs: cueInputsOf(withVideo, clips, Boolean(script.oneTake)), trim: combined.trim ?? null })
        // And the subtitles made on that very 結合, back on their step.
        const subtitles = progress.subtitles
        if (subtitles && subtitles.combinedClips === combinedClipsSignature(combined.clips)) {
          const { cues, pasteText, position, source } = subtitles
          markSubtitlesSaved(subtitlesSignatureOf(subtitles))
          setSubtitleState({ stage: cues.length > 0 ? 'reviewing' : 'idle', cues, pasteText, position, source })
          if (cues.length > 0) {
            setCompletedSteps(['trim'])
            setStep('subtitle')
          }
        }
      }
      setLoading(false)

      const remember = (shotId: string, changes: ShotAnalysis) => {
        updateShotAnalysis(script.id, shotId, takes.get(shotId)!, changes).catch(err =>
          console.warn('[FinalizePage] could not store a shot analysis:', err),
        )
      }

      // Only the selected shot has a live <video> (issue #12), so shots never
      // selected would otherwise never report a duration — which combining
      // needs. Probe them one at a time.
      ;(async () => {
        for (const entry of next) {
          if (cancelled) return
          if (!entry.blob || entry.duration > 0) continue
          const duration = await probeVideoDuration(entry.blob)
          if (cancelled) return
          if (duration > 0) {
            setDurationOnce(entry.shotId, duration)
            remember(entry.shotId, { duration })
          }
        }
      })()

      // Find where each shot's speech starts and ends, so it opens already
      // cut past the record-button press and the pause before stopping.
      // One at a time: each decodes the shot's whole audio track.
      ;(async () => {
        for (const entry of next) {
          if (cancelled) return
          if (!entry.autoTrimPending) continue
          const speech = await detectSpeech(entry.blob!).then(
            found => {
              remember(entry.shotId, { speech: found })
              return found
            },
            // Left untrimmed, but not remembered: it may well decode next time.
            err => {
              console.warn('[FinalizePage] speech detection failed, skipping auto-trim:', err)
              return null
            },
          )
          if (cancelled) return
          // 間を残す may have been switched while this shot was being checked.
          const shot = scriptRef.current?.shots.find(s => s.id === entry.shotId)
          const trim = resolveShotTrimSettings(shot, settings, entry.shotId === firstShotId, entry.shotId === lastShotId)
          setAutoTrim(entry.shotId, speech, speech && trim.trimEnabled ? autoTrimOf(speech, trim) : null)
        }
      })()
    }).catch(err => {
      if (cancelled) return
      console.error('Failed to load stored shot videos', err)
      setLoadError('動画の読み込みに失敗しました。ページを再読み込みしてください。')
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id])

  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // A duration can arrive twice — from the probe and from the ShotTrimmer
  // player loading that shot — so only the first one initializes the trim range.
  function setDurationOnce(shotId: string, duration: number) {
    setEntries(prev =>
      prev.map(e => {
        if (e.shotId !== shotId || e.duration !== 0) return e
        const withDuration = { ...e, duration }
        return withDuration.trimEdited ? withDuration : { ...withDuration, ...autoTrimRange(withDuration) }
      }),
    )
  }

  function setAutoTrim(shotId: string, speech: SpeechRegion | null, autoTrim: SpeechBounds | null) {
    setEntries(prev =>
      prev.map(e => {
        if (e.shotId !== shotId) return e
        const next = { ...e, speech, autoTrim, autoTrimPending: false }
        return next.duration > 0 && !next.trimEdited ? { ...next, ...autoTrimRange(next) } : next
      }),
    )
  }

  // 間を残す: the shot keeps a longer silence after its speech. A cut set by
  // hand stays as it is (see setAutoTrim).
  function setKeepPause(entry: ShotEntry, keepPause: boolean) {
    if (!script) return
    const shots = script.shots.map(shot => (shot.id === entry.shotId ? { ...shot, keepPause } : shot))
    updateScript(script.id, { shots })
    if (!entry.speech) return
    const withVideo = entries.filter(e => e.blob)
    const trim = resolveShotTrimSettings(
      shots.find(shot => shot.id === entry.shotId),
      settings,
      withVideo[0]?.shotId === entry.shotId,
      withVideo.at(-1)?.shotId === entry.shotId,
    )
    if (trim.trimEnabled) setAutoTrim(entry.shotId, entry.speech, autoTrimOf(entry.speech, trim))
  }

  function updateEntry(shotId: string, changes: Partial<ShotEntry>) {
    setEntries(prev => prev.map(e => (e.shotId === shotId ? { ...e, ...changes } : e)))
  }

  function markStepDone(done: WizardStepId, next: WizardStepId) {
    setCompletedSteps(prev => (prev.includes(done) ? prev : [...prev, done]))
    setStep(next)
  }

  function goToStep(target: WizardStepId) {
    // Going back to an earlier step invalidates every step after it, since
    // its input may change (e.g. re-combining after adjusting a trim).
    const targetIndex = STEP_ORDER.indexOf(target)
    setCompletedSteps(prev => prev.filter(s => STEP_ORDER.indexOf(s) < targetIndex))
    if (STEP_ORDER.indexOf('subtitle') >= targetIndex) setBurnedBlob(null)
    if (STEP_ORDER.indexOf('bgm') >= targetIndex) setMixed(null)
    setBgmAutoPending(false)
    setStep(target)
  }

  // Block back-navigation via the wizard indicator (and the page's own back
  // button) while a burn-in or transcription is in flight: it updates lifted subtitle state
  // after its await resolves, and navigating away mid-flight (especially
  // re-combining, which resets that lifted state) can leave the eventual
  // resolution merging onto a state it no longer matches.
  const subtitleProcessing = subtitleState.stage === 'burning' || subtitleState.stage === 'transcribing'

  const availableEntries = entries.filter(e => e.blob)
  // One player for the whole trim step: every live <video> holds a decoder,
  // and iOS fails to decode once a handful exist at once (issue #12).
  const pickedIndex = entries.findIndex(e => e.url && e.shotId === selectedShotId)
  const selectedIndex = pickedIndex >= 0 ? pickedIndex : entries.findIndex(e => e.url)
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : undefined
  // A long script makes a list of every shot a long scroll away from the
  // player (issue #18), so shots are picked from a select above it instead,
  // with prev/next for the usual one-after-another trimming pass.
  const prevIndex = findLastIndexBefore(entries, selectedIndex)
  const nextIndex = entries.findIndex((e, i) => i > selectedIndex && e.url)
  const detectingCount = availableEntries.filter(e => e.autoTrimPending).length
  const canCombine =
    availableEntries.length > 0 && availableEntries.every(e => e.duration > 0) && detectingCount === 0
  const finalBlob = mixed?.blob ?? burnedBlob ?? combinedBlob

  // Encode shots ahead while the user is still trimming, so 結合 only has
  // to join them. Waits for speech detection to finish (it decodes every
  // shot too) and for the trims to settle; a shot re-trimmed later is
  // re-queued and its stale queued encode skipped (see ShotEncodeCache).
  const trimSignature = trimSignatureOf(availableEntries.map(clipOf))
  // Nothing to encode ahead when 結合 already has these exact cuts — e.g.
  // reopened from a save, where encoding every shot again would only cost
  // memory iOS reloads the page over.
  const combining = combineStatus.state === 'combining'
  const combinedIsCurrent = combineStatus.state === 'done' && trimSignatureOf(combinedClips) === trimSignature
  useEffect(() => {
    if (step !== 'trim' || !canCombine || combining || combinedIsCurrent) return
    const timer = setTimeout(() => {
      const cache = getEncodeCache()
      for (const entry of availableEntries) cache.prefetch(normalizeRequest(clipOf(entry)))
    }, BACKGROUND_ENCODE_DELAY_MS)
    return () => clearTimeout(timer)
    // availableEntries is captured through trimSignature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, canCombine, combining, trimSignature, combinedIsCurrent])

  // Likewise burn subtitles into each shot once every cue is translated,
  // while the user checks the preview and position, so 次へ only has to
  // join them. Editing a cue or moving the subtitles re-queues just the
  // shots that changed.
  const { stage: subtitleStage, cues: subtitleCues, position: subtitlePosition } = subtitleState
  const hookSettings: HookSettings = useMemo(
    () => ({ hookStyleEnabled, hookPosition, punchInEnabled, punchInZoom, punchInDirection, punchInAt, punchInDuration, stickerPlacement, stickerMotion, stickerRoute, fairyEnabled, midZoomEnabled }),
    [hookStyleEnabled, hookPosition, punchInEnabled, punchInZoom, punchInDirection, punchInAt, punchInDuration, stickerPlacement, stickerMotion, stickerRoute, fairyEnabled, midZoomEnabled],
  )
  const oneTake = Boolean(script?.oneTake)
  // A 一発撮り take has no fairies or mid-video zooms (see oneTakeHookSettings).
  const hook = useMemo(
    () => hookOptionsOf(oneTake ? oneTakeHookSettings(hookSettings) : hookSettings),
    [hookSettings, oneTake],
  )
  // ...and its hook lasts just the first line rather than the whole take.
  const hookEnd = oneTake && subtitleCues.length > 0 ? subtitleCues[0].end : undefined
  useEffect(() => {
    if (step !== 'subtitle' || subtitleStage !== 'reviewing' || combinedClips.length === 0) return
    if (subtitleCues.length === 0 || !subtitleCues.every(c => c.ja !== null && c.ja.trim() !== '')) return
    const timer = setTimeout(() => {
      const cache = getEncodeCache()
      for (const request of shotBurnRequests(combinedClips, subtitleCues, subtitlePosition, hook, hookEnd)) {
        cache.prefetch(request)
      }
    }, BACKGROUND_ENCODE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [step, subtitleStage, subtitleCues, subtitlePosition, combinedClips, hook, hookEnd])

  // Where the BGM drops out (or is lowered, for a soft genre): just before
  // the last shot, the punchline — in a 一発撮り take, just before its last line.
  const bgmStopAt = useMemo(
    () => oneTake
      ? (bgmStopBeforePunchline && subtitleCues.length > 1 ? subtitleCues[subtitleCues.length - 1].start : null)
      : punchlineStart(combinedClips.map(c => c.end - c.start), bgmStopBeforePunchline),
    [oneTake, subtitleCues, combinedClips, bgmStopBeforePunchline],
  )

  // Build the finished audio (usual BGM + loudness) while the subtitles
  // are worked on: they only change the picture, so after the burn the
  // BGM step just joins this audio to the burned video. Hardware path
  // only; the ffmpeg.wasm fallback mixes after the burn as before.
  useEffect(() => {
    if (step !== 'subtitle' || !combinedBlob || !defaultTrack) return
    let cancelled = false
    void canUseWebCodecs().then(ok => {
      if (cancelled || !ok) return
      preparedAudio.prepare(
        combinedBlob,
        { trackId: defaultTrack.id, volume: bgmVolume, normalize: normalizeAudio, voice: voicePreset, ending: bgmEnding(defaultTrack.genre, bgmStopAt) },
        () => fetchTrack(defaultTrack),
      )
    })
    return () => {
      cancelled = true
    }
  }, [step, combinedBlob, defaultTrack, bgmVolume, normalizeAudio, voicePreset, bgmStopAt, preparedAudio])

  // Loudness is corrected once, on the finished video: the BGM mix halves
  // the voice (see mixMusicWebCodecs) and per-shot levels drift, so only the
  // final audio can be brought to the level Instagram/TikTok play back at.
  // The voice preset goes on the voice before any BGM under it, so this pass
  // applies it only when no mix did.
  const { blob: exportBlob, url: finalUrl, loudness: loudnessState } = useExport(
    step === 'export' ? finalBlob : null,
    { voice: mixed ? 'none' : voicePreset, normalize: normalizeAudio },
  )

  async function handleCombine() {
    // Re-combining invalidates any later step's output. `completedSteps`
    // never contains 'subtitle'/'bgm' while sitting on 'trim' (the only way
    // back here is goToStep, which already truncates completedSteps), so
    // clearing the blobs is sufficient — no completedSteps update needed.
    setBurnedBlob(null)
    setMixed(null)
    // A re-combined video invalidates any subtitle cues tied to the old one.
    setSubtitleState(initialSubtitleState())
    preparedAudio.clear()
    const clips = availableEntries.map(clipOf)
    const joined = await combine(getEncodeCache(), clips)
    if (!joined) return
    // Same clips, same order, same trim values used just above to build
    // `joined` — keeps subtitle timing aligned with the actual combined
    // output by construction, not by keeping two formulas in sync.
    const trim: TrimRecord = {
      firstStart: settings.firstShotPaddingStart,
      start: settings.trimPaddingStart,
      end: settings.trimPaddingEnd,
      lastEnd: settings.lastShotPaddingEnd,
      pauseShots: script?.shots.filter(shot => shot.keepPause && clips.some(c => c.shotId === shot.id)).length ?? 0,
    }
    showCombined({ blob: joined, clips, cueInputs: cueInputsOf(availableEntries, clips, Boolean(script?.oneTake)), trim })
    if (script) {
      const saved = savedClipsOf(clips, takesRef.current)
      // Subtitles made on the previous 結合 no longer line up with this one.
      updateFinalizeProgress(script.id, { combined: { blob: joined, clips: saved, trim }, subtitles: null }).catch(err =>
        console.warn('[FinalizePage] could not save the 結合:', err),
      )
    }
  }

  async function handleSaveFinal() {
    if (!exportBlob || !script) return
    // Tapping 保存する is "this is the version": record how it was made,
    // without holding up or failing the save.
    if (settings.inboxKey) {
      try {
        sendVideoRecord(settings.inboxKey)
      } catch (err) {
        console.warn('[FinalizePage] could not build the video record:', err)
      }
    }
    await shareOrDownload(exportBlob, `${script.title}-final`)
  }

  // Built from what the burn and the mix actually used (see buildVideoRecord).
  function sendVideoRecord(key: string) {
    if (!script) return
    const record = buildVideoRecord({
      script,
      savedAt: new Date().toISOString(),
      durationSec: Math.round(combinedClips.reduce((sum, c) => sum + c.end - c.start, 0) * 10) / 10,
      shotCount: combinedClips.length,
      burn: burnedBlob ? burnInputs : null,
      mix: mixed ? mixInputs : null,
      voicePreset,
      trim: combined?.trim ?? null,
    })
    postVideoRecord(key, record).catch(err => console.warn('[FinalizePage] could not send the video record:', err))
  }

  // The caption Claude wrote with the script, ready to paste into TikTok.
  async function handleCopyCaption() {
    if (!script?.caption) return
    try {
      await navigator.clipboard.writeText(script.caption)
      setCaptionCopy('copied')
    } catch {
      setCaptionCopy('failed')
    }
    // Restart the 2s from the latest tap, so an earlier tap's timer can't
    // cut the new message short.
    clearTimeout(captionCopyTimerRef.current)
    captionCopyTimerRef.current = setTimeout(() => setCaptionCopy('idle'), 2000)
  }

  if (!script) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        スクリプトが見つかりません
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate(`/scripts/${script.id}/shots`)}
          disabled={subtitleProcessing}
        >
          ‹ 戻る
        </button>
        <h1 className={styles.heading}>動画を仕上げる</h1>
      </div>

      {loading ? (
        <p className={styles.missing}>読み込み中...</p>
      ) : loadError ? (
        <p className={styles.missing}>{loadError}</p>
      ) : (
        <>
          <WizardSteps current={step} completed={completedSteps} onSelect={goToStep} disabled={subtitleProcessing} />

          {step === 'trim' && (
            <div className={styles.stepBody}>
              {selected?.url ? (
                <div className={styles.shotEntry}>
                  <div className={styles.shotNav}>
                    <button
                      type="button"
                      className={styles.shotNavBtn}
                      aria-label="前のショット"
                      disabled={prevIndex < 0}
                      onClick={() => setSelectedShotId(entries[prevIndex].shotId)}
                    >
                      ‹
                    </button>
                    <select
                      aria-label="ショットを選ぶ"
                      className={styles.shotSelect}
                      value={selected.shotId}
                      onChange={e => setSelectedShotId(e.target.value)}
                    >
                      {entries.map((entry, i) => (
                        <option key={entry.shotId} value={entry.shotId} disabled={!entry.url}>
                          {i + 1}. {shotMeta(entry)}｜{stripEmphasis(entry.text)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.shotNavBtn}
                      aria-label="次のショット"
                      disabled={nextIndex < 0}
                      onClick={() => setSelectedShotId(entries[nextIndex].shotId)}
                    >
                      ›
                    </button>
                  </div>
                  <p className={styles.shotEntryText}>
                    <span className={styles.shotCounter}>{selectedIndex + 1} / {entries.length}</span>
                    <span>{stripEmphasis(selected.text)}</span>
                  </p>
                  <ShotTrimmer
                    url={selected.url}
                    nextUrl={entries[selectedIndex + 1]?.url ?? null}
                    duration={selected.duration}
                    trimStart={selected.trimStart}
                    trimEnd={selected.trimEnd || selected.duration}
                    onDurationKnown={duration => setDurationOnce(selected.shotId, duration)}
                    onChange={(trimStart, trimEnd) =>
                      updateEntry(selected.shotId, { trimStart, trimEnd, trimEdited: true })
                    }
                    onResetToAuto={
                      selected.autoTrim && selected.trimEdited
                        ? () => updateEntry(selected.shotId, { ...autoTrimRange(selected), trimEdited: false })
                        : undefined
                    }
                  />
                  <label className={styles.pauseToggle}>
                    <input
                      type="checkbox"
                      checked={script.shots.find(shot => shot.id === selected.shotId)?.keepPause ?? false}
                      onChange={e => setKeepPause(selected, e.target.checked)}
                    />
                    このショットの後に間を残す
                  </label>
                </div>
              ) : (
                <p className={styles.missing}>保存された動画がありません</p>
              )}

              <button
                className={styles.finalizeBtn}
                onClick={handleCombine}
                disabled={!canCombine || combining}
              >
                {combineStatus.state === 'combining'
                  ? combineLabel(combineStatus.phase, combineStatus.progress)
                  : detectingCount > 0
                    ? `前後の無音を検出中... (残り${detectingCount})`
                    : '結合する'}
              </button>

              {combineStatus.state === 'combining' && (
                <CancelProcessing
                  progress={`${combineStatus.phase}:${combineStatus.progress}`}
                  onCancel={cancelCombine}
                />
              )}

              {combineStatus.state === 'cancelled' && <p className={styles.missing}>中断しました</p>}

              {combineStatus.state === 'error' && (
                <p className={styles.missing}>結合に失敗しました: {combineStatus.error}</p>
              )}

              {combineStatus.state === 'done' && combinedUrl && (
                <div className={styles.shotEntry}>
                  <p className={styles.shotEntryText}>結合結果</p>
                  <video className={styles.preview} src={combinedUrl} controls playsInline />
                  <button
                    className={styles.finalizeBtn}
                    onClick={() => markStepDone('trim', 'subtitle')}
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'subtitle' && combinedBlob && (
            <div className={styles.stepBody}>
              <SubtitleWorkflow
                key={combinedUrl}
                combinedBlob={combinedBlob}
                shotCueInputs={combined?.cueInputs ?? []}
                state={subtitleState}
                onStateChange={setSubtitleState}
                hookSettings={hookSettings}
                onHookSettingsChange={updateSettings}
                inboxKey={settings.inboxKey}
                scriptJapanese={script?.japanese}
                oneTake={oneTake}
                burn={(cues, position, onProgress, signal) => {
                  burnInputsRef.current = { hook, cues, position, durations: combinedClips.map(c => c.end - c.start) }
                  return burnSubtitlesByShot(
                    getEncodeCache(),
                    combinedClips,
                    combinedBlob,
                    cues,
                    position,
                    hook,
                    onProgress,
                    signal,
                    oneTake && cues.length > 0 ? cues[0].end : undefined,
                  )
                }}
                onBurned={burned => {
                  setBurnedBlob(burned)
                  setBurnInputs(burnInputsRef.current)
                  setBgmAutoPending(defaultTrack !== null)
                  markStepDone('subtitle', 'bgm')
                }}
                // The audio prepared on arrival here decodes and mixes the
                // whole soundtrack; on top of Whisper that is more memory
                // than an iPhone gives the page, which then reloads.
                transcribe={async (blob, onProgress, signal) => {
                  await preparedAudio.settled()
                  return transcribeSpeech(blob, onProgress, signal)
                }}
              />
            </div>
          )}

          {step === 'bgm' && (burnedBlob ?? combinedBlob) && (
            <div className={styles.stepBody}>
              <MusicMixer
                // Deliberately NOT `finalBlob`: MusicMixer must always mix onto
                // the video from before any BGM was ever added, otherwise a
                // track/volume change re-mixes onto its own previous mixed
                // output and BGM layers stack indefinitely.
                videoBlob={(burnedBlob ?? combinedBlob) as Blob}
                initialTrackId={defaultTrack?.id ?? null}
                initialVolume={bgmVolume}
                autoMix={bgmAutoPending}
                mix={(track, trackBlob, volume) => {
                  mixInputsRef.current = { trackId: track.id, title: track.title, volume }
                  return mixForExport(preparedAudio, combinedBlob as Blob, (burnedBlob ?? combinedBlob) as Blob, trackBlob, {
                    trackId: track.id,
                    volume,
                    normalize: normalizeAudio,
                    voice: voicePreset,
                    ending: bgmEnding(track.genre, bgmStopAt),
                  })
                }}
                onLeaveAuto={() => {
                  // The auto mix may be waiting on a prepared-audio job that
                  // never settles; the manual mix must not wait on it too.
                  preparedAudio.clear()
                  setBgmAutoPending(false)
                }}
                onMixed={mix => {
                  setMixed(mix)
                  setMixInputs(mix ? mixInputsRef.current : null)
                }}
                onNext={() => {
                  setBgmAutoPending(false)
                  markStepDone('bgm', 'export')
                }}
              />
            </div>
          )}

          {step === 'export' && loudnessState === 'normalizing' && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>音声を仕上げ中...</p>
            </div>
          )}

          {step === 'export' && exportBlob && finalUrl && (
            <div className={styles.stepBody}>
              <p className={styles.shotEntryText}>完成した動画</p>
              {!coverOpen && <video className={styles.preview} src={finalUrl} controls playsInline />}
              {loudnessState === 'failed' && (
                <p className={styles.missing}>音声の自動調整に失敗したため、元の音声のまま保存されます</p>
              )}
              {mixed && (
                <div className={styles.bgmRow}>
                  <span className={styles.bgmTitle}>BGM: {mixed.trackTitle}</span>
                  {/* Falls back to the pre-BGM video; the BGM step stays done,
                      since no BGM is a valid outcome of it. */}
                  <button className={styles.removeBgmBtn} onClick={() => setMixed(null)}>
                    BGMを外す
                  </button>
                </div>
              )}
              <button className={styles.finalizeBtn} onClick={handleSaveFinal}>
                保存する
              </button>
              {script.caption && (
                <button className={styles.copyCaptionBtn} onClick={handleCopyCaption}>
                  {captionCopy === 'copied'
                    ? 'コピーしました'
                    : captionCopy === 'failed'
                      ? 'コピーできませんでした'
                      : 'キャプションをコピー'}
                </button>
              )}
              {combinedUrl && (
                <button className={styles.copyCaptionBtn} onClick={() => setCoverOpen(open => !open)}>
                  {coverOpen ? 'カバー画像を閉じる' : 'カバー画像を作る'}
                </button>
              )}
              {coverOpen && combinedUrl && (
                <CoverMaker
                  videoUrl={combinedUrl}
                  initialWords={coverWordsOf(
                    script.shots.map(s => s.text),
                    subtitleCues.map(c => c.ja),
                  )}
                  filenameBase={script.title}
                  initialPosition={settings.coverTextPosition}
                  onPositionChange={coverTextPosition => updateSettings({ coverTextPosition })}
                  stickerPlacement={stickerPlacement}
                  initialStickerSpot={settings.coverStickerSpot}
                  onStickerSpotChange={coverStickerSpot => updateSettings({ coverStickerSpot })}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
