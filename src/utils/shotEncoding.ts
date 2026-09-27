import { blobId, type EncodeRequest, type ShotEncodeCache } from './shotEncodeCache'
import { trimAndNormalizeShot } from './trimAndNormalizeShot'
import { burnShotSubtitles, burnSubtitles } from './burnSubtitles'
import { cuesForShot, type SubtitleCue } from './subtitleCues'
import type { SubtitlePosition } from './subtitlePosition'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { concatClipsWebCodecs } from './webcodecs/concatClips'

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
    run: onProgress => trimAndNormalizeShot(clip.blob, clip.start, clip.end, onProgress),
  }
}

/**
 * The shot trimmed and normalized with `cues` (in the shot's own timeline)
 * burned in by the same encode. A shot with nothing to burn is just its
 * normalized clip, so it's shared with the combine step's cache entry.
 */
export function burnRequest(clip: ShotClip, cues: SubtitleCue[], position: SubtitlePosition): EncodeRequest {
  const translated = cues.filter(c => c.ja !== null)
  if (translated.length === 0) return normalizeRequest(clip)
  const look = JSON.stringify(translated.map(c => [c.start.toFixed(3), c.end.toFixed(3), c.en, c.ja]))
  return {
    slot: `burn:${clip.shotId}`,
    key: `burn|${clipKey(clip)}|${position}|${look}`,
    run: onProgress => burnShotSubtitles(clip.blob, clip.start, clip.end, translated, position, onProgress),
  }
}

/**
 * One burn request per shot, each given the cues that fall within it.
 * Shots start where the previous one ended — the same running offset
 * cuesFromShotEntries times the cues by.
 */
export function shotBurnRequests(
  clips: ShotClip[],
  cues: SubtitleCue[],
  position: SubtitlePosition,
): EncodeRequest[] {
  let offset = 0
  return clips.map(clip => {
    const duration = clip.end - clip.start
    const request = burnRequest(clip, cuesForShot(cues, offset, duration), position)
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
): Promise<Blob[]> {
  const ratios = new Map(requests.map(r => [r.key, 0]))
  const report = () => {
    let sum = 0
    ratios.forEach(r => (sum += r))
    onProgress?.(requests.length > 0 ? sum / requests.length : 1)
  }
  cache.onProgress = (key, ratio) => {
    if (!ratios.has(key)) return
    ratios.set(key, ratio)
    report()
  }
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
    cache.onProgress = null
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
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (!cues.some(c => c.ja !== null)) return combinedBlob
  if (clips.length > 0 && (await canUseWebCodecs())) {
    let burned: Blob[] | null = null
    try {
      burned = await encodeAll(cache, shotBurnRequests(clips, cues, position), onProgress)
    } catch (err) {
      disableWebCodecs(err)
    }
    if (burned) {
      try {
        return await concatClipsWebCodecs(burned)
      } catch (err) {
        console.warn('[burnSubtitlesByShot] joining burned shots failed, burning the joined video instead:', err)
      }
    }
    onProgress?.(0)
  }
  return burnSubtitles(combinedBlob, cues, position)
}
