import { blobId, type EncodeRequest, type ShotEncodeCache } from './shotEncodeCache'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { burnShotSubtitles, burnSubtitles, type SubtitleLook } from './burnSubtitles'
import { cuesForShot, type SubtitleCue } from './subtitleCues'
import { fairiesForShot, fairiesFromSubtitles, type FairyAppearance } from './fairyPlan'
import { midZoomForShot, planMidZoom, type MidZoomSegment } from './midZoom'
import { hasFirstShotExtras, openingPlan, styleCues, type HookOptions, type StyledCue } from './subtitleHook'
import type { SubtitlePosition } from './subtitlePosition'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { onAbort, throwIfCancelled } from './cancellation'
import { clampCoverFrameCount, renderCoverFrame } from './coverFrames'
import { isCardClip } from './insertCard'
import { timeStep } from './finalizeTimings'
import type { OpeningCardPlan } from './openingCard'
import { firstFrameOf, rawOpeningClipWebCodecs } from './webcodecs/openingClip'
import { openingVoiceByKey } from './webcodecs/openingVoice'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'

/** One shot as it goes into the joined video: its source and trim range. */
export interface ShotClip {
  shotId: string
  blob: Blob
  start: number
  end: number
}

function clipKey(clip: ShotClip): string {
  return `${clip.shotId}|${blobId(clip.blob)}|${clip.start.toFixed(3)}|${clip.end.toFixed(3)}`
}

/**
 * The cover image to put in as frames of its own before the first shot, in
 * that shot's encode (see withCoverFrames).
 */
export interface BurnCover {
  image: Blob
  count: number
}

/** The burned video, and whether `cover` (and the 冒頭カード) went in: not when the whole video had to be burned at once. */
export interface BurnedVideo {
  blob: Blob
  cover: boolean
  opening?: boolean
}

/** The shot trimmed and normalized to the output profile. */
export function normalizeRequest(clip: ShotClip): EncodeRequest {
  return {
    slot: `normalize:${clip.shotId}`,
    key: `normalize|${clipKey(clip)}`,
    seconds: clip.end - clip.start,
    run: (onProgress, signal) => trimAndNormalizeShot(clip.blob, clip.start, clip.end, onProgress, signal),
  }
}

/**
 * How long the hook lasts at the start of the joined video: its first shot,
 * or null with no shots. `hookEnd` ends it sooner — a 一発撮り take is one
 * shot, and its hook is just its first line.
 */
function firstShotDurationOf(clips: ShotClip[], hookEnd?: number): number | null {
  if (clips.length === 0) return null
  const first = clips[0].end - clips[0].start
  return hookEnd !== undefined ? Math.min(first, hookEnd) : first
}

/** The peaks' and the punchline's zoom over the joined timeline, read from the subtitles. */
function midZoomPlanOf(clips: ShotClip[], cues: SubtitleCue[], hook: HookOptions): MidZoomSegment[] {
  return planMidZoom(cues, clips.map(c => c.end - c.start), hook)
}

/** The fairies over the joined timeline, read from the subtitles. */
function fairyPlanOf(clips: ShotClip[], cues: SubtitleCue[], hook: HookOptions, position: SubtitlePosition): FairyAppearance[] {
  return fairiesFromSubtitles(cues, clips.map(c => c.end - c.start), hook, position)
}

/**
 * The shot trimmed and normalized with `cues` (styled, in the shot's own
 * timeline) burned in by the same encode, plus the zoom in when it's the
 * first shot and the `look`'s fairies (also in the shot's own timeline). A
 * shot with nothing of that is just its normalized clip, so it's shared with
 * the combine step's cache entry. The key holds everything that changes the
 * pixels (the fairies by their keys), so a hook change re-encodes only the
 * shots it shows up in. With `cover`, its frames go in ahead of the shot;
 * that clip has a slot of its own, so the shot without them (the YouTube
 * version's) is kept alongside it.
 */
export function burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook, cover?: BurnCover): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  const extras = hasFirstShotExtras(look.hook, look.firstShotDuration)
  const fairies = look.fairies ?? []
  const midZoom = look.midZoom ?? []
  if (!cover && translated.length === 0 && !extras && fairies.length === 0 && midZoom.length === 0) return normalizeRequest(clip)
  const hasNormalCue = translated.some(c => c.variant === 'normal')
  const hasHookCue = translated.some(c => c.variant === 'hook')
  const images = (look.hook.lineImages ?? []).filter(i => translated.some(c => c.id === i.cueId))
  const speakers = (look.hook.speakers ?? []).filter(s => translated.some(c => c.id === s.cueId))
  const scene = look.hook.scene && translated.some(c => c.id === look.hook.scene!.cueId) ? look.hook.scene.text : null
  const placement = JSON.stringify([
    hasNormalCue ? look.position : null,
    hasHookCue ? look.hook.position : null,
    hasHookCue ? (look.hook.sticker ?? null) : null,
    hasHookCue ? (look.hook.stickerMotion ?? null) : null,
    hasHookCue ? (look.hook.stickerRoute ?? 0) : null,
    // The sticker's size and sparkles changed the pixels; old cached burns are stale.
    'sparkles-v1',
    // So did the sticker waiting for the bars and the softer looks (2026-11-03).
    'after-bars-v1',
    fairies.map(f => f.key),
    midZoom.map(z => [z.kind, z.start.toFixed(3), z.end.toFixed(3)]),
    // Only a shot with one gets this entry, so the others keep their cached burns.
    // The subtitle moved down and the image above the head (2026-11-06); old burns with an image are stale.
    ...(images.length > 0 ? ['image-above-v1', images.map(i => [i.cueId, i.imageId, blobId(i.blob), i.credit ?? null])] : []),
    // Likewise only a 相手のセリフ shot: its subtitle is tinted, with the icon beside it.
    // And only the shot with line 1 carries the 状況のラベル.
    ...(scene ? ['scene-v1', scene] : []),
    // Only a 心の声 shot: its subtitle goes in a cloud.
    ...((look.hook.thoughts ?? []).some(id => translated.some(c => c.id === id)) ? ['thought-v1'] : []),
    ...(speakers.length > 0 ? ['speaker-v1', speakers.map(s => [s.cueId, s.icon, ...(s.phone ? ['phone'] : []), ...(s.name ? [s.name] : [])])] : []),
  ])
  const opening = openingPlan(look.hook, look.firstShotDuration)
  const firstShot = JSON.stringify(extras ? (opening ? [look.hook.punchIn, opening] : look.hook.punchIn) : null)
  const text = JSON.stringify(translated.map(c => [c.start.toFixed(3), c.end.toFixed(3), c.en, c.ja, c.variant]))
  if (!cover) {
    return {
      slot: `burn:${clip.shotId}`,
      key: `burn|${clipKey(clip)}|${placement}|${firstShot}|${text}`,
      seconds: clip.end - clip.start,
      run: (onProgress, signal) =>
        burnShotSubtitles(clip.blob, clip.start, clip.end, translated, look, onProgress, signal),
    }
  }
  const count = clampCoverFrameCount(cover.count)
  return {
    slot: `burn-cover:${clip.shotId}`,
    key: `burn-cover|${clipKey(clip)}|${placement}|${firstShot}|${text}|${blobId(cover.image)}x${count}`,
    seconds: clip.end - clip.start,
    run: async (onProgress, signal) => {
      const frame = await renderCoverFrame(cover.image)
      try {
        return await burnShotSubtitles(clip.blob, clip.start, clip.end, translated, look, onProgress, signal, { frame, count })
      } finally {
        frame.width = 0
        frame.height = 0
      }
    },
  }
}

/**
 * One burn request per shot, each given the cues that fall within it.
 * Shots start where the previous one ended — the same running offset
 * cuesFromShotEntries times the cues by. Cues are styled on the joined
 * timeline first, so one running on past the first shot stays a hook cue.
 * The fairies are planned once over the joined timeline from the cues'
 * emoji and each shot gets the ones inside it. `cover` goes in ahead of the
 * first shot.
 */
export function shotBurnRequests(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
  hookEnd?: number,
  cover?: BurnCover,
): EncodeRequest[] {
  const hookSpan = firstShotDurationOf(clips, hookEnd)
  const styled = styleCues(cues, hookSpan, hook.style)
  const plan = fairyPlanOf(clips, cues, hook, position)
  const zoomPlan = midZoomPlanOf(clips, cues, hook)
  let offset = 0
  return clips.map((clip, i) => {
    const duration = clip.end - clip.start
    // A 挿入カード has nothing burned on it: no subtitle, no fairy passing, no zoom.
    if (isCardClip(clip)) {
      offset += duration
      return normalizeRequest(clip)
    }
    const look: SubtitleLook = {
      position,
      hook,
      firstShotDuration: i === 0 ? hookSpan : null,
      firstClipDuration: i === 0 ? duration : null,
      fairies: fairiesForShot(plan, offset, duration),
      midZoom: midZoomForShot(zoomPlan, offset, duration),
    }
    // With a 冒頭カード, the cover goes in ahead of the card instead (see openingBurnRequest).
    const request = burnRequest(clip, cuesForShot(styled, offset, duration), look, i === 0 && !hook.openingCard ? cover : undefined)
    offset += duration
    return request
  })
}

/**
 * 冒頭カード: its clip, drawn over the first shot's first frame and
 * normalized as a shot is, with `cover`'s frames ahead of it. It goes in
 * front of the first shot's (see burnRequestsWithOpening). The key holds
 * what it looks and sounds like, and the first shot's take and trim (its
 * first frame is the card's picture).
 */
export function openingBurnRequest(first: ShotClip, plan: OpeningCardPlan, cover?: BurnCover): EncodeRequest {
  const count = cover ? clampCoverFrameCount(cover.count) : 0
  const look = JSON.stringify(plan)
  return {
    slot: cover ? 'opening-cover' : 'opening',
    key: `opening|${clipKey(first)}|${look}${cover ? `|${blobId(cover.image)}x${count}` : ''}`,
    seconds: plan.timing.seconds,
    run: async (onProgress, signal) => {
      const voice = plan.voiceKey ? await openingVoiceByKey(plan.voiceKey) : null
      if (plan.voiceKey && !voice) console.warn('[openingBurnRequest] the opening voice is gone, drawing the card without it')
      const background = await firstFrameOf(first.blob, first.start)
      let raw: Blob
      try {
        raw = await rawOpeningClipWebCodecs(plan, background, voice)
      } finally {
        background.width = 0
        background.height = 0
      }
      throwIfCancelled(signal)
      const frame = cover ? await renderCoverFrame(cover.image) : null
      try {
        return await normalizeShotWebCodecs(raw, 0, plan.timing.seconds, onProgress, [], signal, frame ? { cover: { frame, count } } : {})
      } finally {
        if (frame) {
          frame.width = 0
          frame.height = 0
        }
      }
    },
  }
}

/**
 * The burn's requests in the order they're joined: the 冒頭カード first when
 * the hook has one (with the cover), then one per shot (shotBurnRequests).
 */
export function burnRequestsWithOpening(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
  hookEnd?: number,
  cover?: BurnCover,
): EncodeRequest[] {
  const shots = shotBurnRequests(clips, cues, position, hook, hookEnd, cover)
  return hook.openingCard && clips.length > 0 ? [openingBurnRequest(clips[0], hook.openingCard, cover), ...shots] : shots
}

/**
 * Wait for every request's clip, in order, reporting overall progress as
 * the average of each clip's (clips already in the cache count as done).
 */
export async function encodeAll(
  cache: ShotEncodeCache,
  requests: EncodeRequest[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
  /** Records how long this was waited on under that name (see finalizeTimings). */
  label?: string,
): Promise<Blob[]> {
  throwIfCancelled(signal)
  if (label) {
    const ready = new Set(requests.filter(r => cache.isDone(r.key)).map(r => r.key)).size
    const total = new Set(requests.map(r => r.key)).size
    return timeStep(label, () => encodeAll(cache, requests, onProgress, signal), `${total}本中${ready}本は先回り済み`)
  }
  const ratios = new Map(requests.map(r => [r.key, 0]))
  // Once this settles (e.g. rejected by one clip's failure), clips still
  // finishing must not report into a caller that has moved on.
  let settled = false
  const report = () => {
    if (settled) return
    let sum = 0
    ratios.forEach(r => (sum += r))
    onProgress?.(requests.length > 0 ? sum / requests.length : 1)
  }
  cache.onProgress = (key, ratio) => {
    if (!ratios.has(key)) return
    ratios.set(key, ratio)
    report()
  }
  // Cancelling stops the cache's running encode and drops the queued ones.
  const unregister = onAbort(signal, () => cache.cancel())
  try {
    return await Promise.all(
      requests.map(r =>
        cache.get(r).then(blob => {
          ratios.set(r.key, 1)
          report()
          return blob
        }),
      ),
    )
  } finally {
    settled = true
    cache.onProgress = null
    unregister()
  }
}

/**
 * Burn subtitles into the joined video one shot at a time: each shot is
 * re-encoded from its source with its cue composited in (one encode per
 * shot, reusing any already done in the background), then the clips are
 * joined by packet copy.
 *
 * Falls back to re-encoding the whole joined video (burnSubtitles) when
 * that can't work: WebCodecs unavailable or failing (then ffmpeg.wasm
 * does it), or clips whose encoder headers don't match for packet copy.
 * `cover` goes in ahead of the first shot only shot by shot; the result
 * says whether it did.
 */
export async function burnSubtitlesByShot(
  cache: ShotEncodeCache,
  clips: ShotClip[],
  combinedBlob: Blob,
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
  hookEnd?: number,
  cover?: BurnCover,
): Promise<BurnedVideo> {
  const plan = fairyPlanOf(clips, cues, hook, position)
  const zoomPlan = midZoomPlanOf(clips, cues, hook)
  const hookSpan = firstShotDurationOf(clips, hookEnd)
  if (!cover && !hook.openingCard && !cues.some(c => c.ja !== null) && !hasFirstShotExtras(hook, hookSpan) && plan.length === 0 && zoomPlan.length === 0) {
    return { blob: combinedBlob, cover: false }
  }
  if (clips.length > 0 && (await canUseWebCodecs())) {
    let burned: Blob[] | null = null
    try {
      burned = await encodeAll(cache, burnRequestsWithOpening(clips, cues, position, hook, hookEnd, cover), onProgress, signal, '焼き込み: エンコード待ち')
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
    }
    if (burned) {
      try {
        const clips = burned
        const joined = await timeStep('焼き込み: つなぐ', () => concatClipsWebCodecs(clips, signal))
        return { blob: joined, cover: cover !== undefined, ...(hook.openingCard ? { opening: true } : {}) }
      } catch (err) {
        throwIfCancelled(signal)
        console.warn('[burnSubtitlesByShot] joining burned shots failed, burning the joined video instead:', err)
      }
    }
    onProgress?.(0)
  }
  // The 冒頭カード needs the per-shot burn; burned as one video, it's left out.
  if (hook.openingCard) console.warn('[burnSubtitlesByShot] burning the whole video at once: the opening card is left out')
  const blob = await timeStep('焼き込み: 全体を再エンコード(フォールバック)', () => burnSubtitles(
    combinedBlob,
    cues,
    { position, hook, firstShotDuration: hookSpan, firstClipDuration: firstShotDurationOf(clips), fairies: plan, midZoom: zoomPlan },
    onProgress,
    signal,
  ))
  return { blob, cover: false }
}
