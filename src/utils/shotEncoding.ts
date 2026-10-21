import { blobId, type EncodeRequest, type ShotEncodeCache } from './shotEncodeCache'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { burnShotSubtitles, burnSubtitles, type SubtitleLook } from './burnSubtitles'
import { cuesForShot, type SubtitleCue } from './subtitleCues'
import { fairiesForShot, fairiesFromSubtitles, type FairyAppearance } from './fairyPlan'
import { midZoomForShot, planMidZoom, type MidZoomSegment } from './midZoom'
import { hasFirstShotExtras, styleCues, type HookOptions, type StyledCue } from './subtitleHook'
import type { SubtitlePosition } from './subtitlePosition'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { onAbort, throwIfCancelled } from './cancellation'

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

/** The shot trimmed and normalized to the output profile. */
export function normalizeRequest(clip: ShotClip): EncodeRequest {
  return {
    slot: `normalize:${clip.shotId}`,
    key: `normalize|${clipKey(clip)}`,
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
 * shots it shows up in.
 */
export function burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  const extras = hasFirstShotExtras(look.hook, look.firstShotDuration)
  const fairies = look.fairies ?? []
  const midZoom = look.midZoom ?? []
  if (translated.length === 0 && !extras && fairies.length === 0 && midZoom.length === 0) return normalizeRequest(clip)
  const hasNormalCue = translated.some(c => c.variant === 'normal')
  const hasHookCue = translated.some(c => c.variant === 'hook')
  const placement = JSON.stringify([
    hasNormalCue ? look.position : null,
    hasHookCue ? look.hook.position : null,
    hasHookCue ? (look.hook.sticker ?? null) : null,
    hasHookCue ? (look.hook.stickerMotion ?? null) : null,
    hasHookCue ? (look.hook.stickerRoute ?? 0) : null,
    // The sticker's size and sparkles changed the pixels; old cached burns are stale.
    'sparkles-v1',
    fairies.map(f => f.key),
    midZoom.map(z => [z.kind, z.start.toFixed(3), z.end.toFixed(3)]),
  ])
  const firstShot = JSON.stringify(extras ? look.hook.punchIn : null)
  const text = JSON.stringify(translated.map(c => [c.start.toFixed(3), c.end.toFixed(3), c.en, c.ja, c.variant]))
  return {
    slot: `burn:${clip.shotId}`,
    key: `burn|${clipKey(clip)}|${placement}|${firstShot}|${text}`,
    run: (onProgress, signal) =>
      burnShotSubtitles(clip.blob, clip.start, clip.end, translated, look, onProgress, signal),
  }
}

/**
 * One burn request per shot, each given the cues that fall within it.
 * Shots start where the previous one ended — the same running offset
 * cuesFromShotEntries times the cues by. Cues are styled on the joined
 * timeline first, so one running on past the first shot stays a hook cue.
 * The fairies are planned once over the joined timeline from the cues'
 * emoji and each shot gets the ones inside it.
 */
export function shotBurnRequests(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
  hookEnd?: number,
): EncodeRequest[] {
  const hookSpan = firstShotDurationOf(clips, hookEnd)
  const styled = styleCues(cues, hookSpan, hook.style)
  const plan = fairyPlanOf(clips, cues, hook, position)
  const zoomPlan = midZoomPlanOf(clips, cues, hook)
  let offset = 0
  return clips.map((clip, i) => {
    const duration = clip.end - clip.start
    const look: SubtitleLook = {
      position,
      hook,
      firstShotDuration: i === 0 ? hookSpan : null,
      fairies: fairiesForShot(plan, offset, duration),
      midZoom: midZoomForShot(zoomPlan, offset, duration),
    }
    const request = burnRequest(clip, cuesForShot(styled, offset, duration), look)
    offset += duration
    return request
  })
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
): Promise<Blob[]> {
  throwIfCancelled(signal)
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
): Promise<Blob> {
  const plan = fairyPlanOf(clips, cues, hook, position)
  const zoomPlan = midZoomPlanOf(clips, cues, hook)
  const hookSpan = firstShotDurationOf(clips, hookEnd)
  if (!cues.some(c => c.ja !== null) && !hasFirstShotExtras(hook, hookSpan) && plan.length === 0 && zoomPlan.length === 0) {
    return combinedBlob
  }
  if (clips.length > 0 && (await canUseWebCodecs())) {
    let burned: Blob[] | null = null
    try {
      burned = await encodeAll(cache, shotBurnRequests(clips, cues, position, hook, hookEnd), onProgress, signal)
    } catch (err) {
      // A cancel isn't WebCodecs breaking down: don't fall back or turn it off.
      throwIfCancelled(signal)
      disableWebCodecs(err)
    }
    if (burned) {
      try {
        return await concatClipsWebCodecs(burned, signal)
      } catch (err) {
        throwIfCancelled(signal)
        console.warn('[burnSubtitlesByShot] joining burned shots failed, burning the joined video instead:', err)
      }
    }
    onProgress?.(0)
  }
  return burnSubtitles(
    combinedBlob,
    cues,
    { position, hook, firstShotDuration: hookSpan, fairies: plan, midZoom: zoomPlan },
    onProgress,
    signal,
  )
}
