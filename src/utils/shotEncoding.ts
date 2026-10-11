import { blobId, type EncodeRequest, type ShotEncodeCache } from './shotEncodeCache'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { burnShotSubtitles, burnSubtitles, type SubtitleLook } from './burnSubtitles'
import { cuesForShot, type SubtitleCue } from './subtitleCues'
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

/** How long the joined video's first shot is, or null with no shots. */
function firstShotDurationOf(clips: ShotClip[]): number | null {
  return clips.length > 0 ? clips[0].end - clips[0].start : null
}

/**
 * The shot trimmed and normalized with `cues` (styled, in the shot's own
 * timeline) burned in by the same encode, plus the zoom in
 * when it's the first shot. A shot with nothing of that is just its
 * normalized clip, so it's shared with the combine step's cache entry. The
 * key holds everything that changes the pixels, so a hook change re-encodes
 * only the shots it shows up in.
 */
export function burnRequest(clip: ShotClip, cues: StyledCue[], look: SubtitleLook): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  const extras = hasFirstShotExtras(look.hook, look.firstShotDuration)
  if (translated.length === 0 && !extras) return normalizeRequest(clip)
  const hasNormalCue = translated.some(c => c.variant === 'normal')
  const hasHookCue = translated.some(c => c.variant === 'hook')
  const placement = JSON.stringify([
    hasNormalCue ? look.position : null,
    hasHookCue ? look.hook.position : null,
    hasHookCue ? (look.hook.sticker ?? null) : null,
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
 */
export function shotBurnRequests(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
  hook: HookOptions,
): EncodeRequest[] {
  const styled = styleCues(cues, firstShotDurationOf(clips), hook.style)
  let offset = 0
  return clips.map((clip, i) => {
    const duration = clip.end - clip.start
    const look: SubtitleLook = { position, hook, firstShotDuration: i === 0 ? duration : null }
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
): Promise<Blob> {
  if (!cues.some(c => c.ja !== null) && !hasFirstShotExtras(hook, firstShotDurationOf(clips))) return combinedBlob
  if (clips.length > 0 && (await canUseWebCodecs())) {
    let burned: Blob[] | null = null
    try {
      burned = await encodeAll(cache, shotBurnRequests(clips, cues, position, hook), onProgress, signal)
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
  return burnSubtitles(combinedBlob, cues, { position, hook, firstShotDuration: firstShotDurationOf(clips) }, onProgress, signal)
}
