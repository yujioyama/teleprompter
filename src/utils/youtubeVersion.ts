import type { MusicTrack } from '../data/musicTracks'
import { fetchTrack } from './fetchTrack'
import { finishAudio } from './normalizeLoudness'
import { PreparedAudio, mixForExport, type FinalAudioKey } from './preparedAudio'
import { canUseWebCodecs } from './webcodecs/support'

/** The normal version's BGM, for the YouTube version to swap. */
export interface YoutubeBgmSwap {
  /** The combined video the BGM step's audio is built from. */
  source: Blob
  /** The video the BGM went onto: `source` with the subtitles burned in. */
  video: Blob
  /** What the normal version's BGM was mixed with: its volume and how it ends. */
  key: FinalAudioKey
  /** The YouTube BGM, mixed in its place. */
  track: MusicTrack
  /** Audio already built for this swap, if any: the export then only joins it on. */
  ahead?: PreparedAudio
}

// Per video, per swap: returning to the export step, or changing the cover
// frames (which hold this up until they're in), doesn't mix again.
const results = new WeakMap<Blob, Map<string, Promise<Blob>>>()

function swapKey({ key, track }: YoutubeBgmSwap): string {
  return JSON.stringify({ ...key, trackId: track.id })
}

/**
 * The YouTube version's video: the normal version's mix done again with
 * `swap.track` in place of its BGM — same volume, same drop or duck before
 * the punchline — and its loudness finished the same way. YouTube Shorts
 * flags the usual Pixabay tracks; no cover frames go in either.
 */
export function mixYoutubeVersion(swap: YoutubeBgmSwap): Promise<Blob> {
  let bySwap = results.get(swap.video)
  if (!bySwap) {
    bySwap = new Map()
    results.set(swap.video, bySwap)
  }
  const id = swapKey(swap)
  const cached = bySwap.get(id)
  if (cached) return cached
  const run = mix(swap)
  bySwap.set(id, run)
  run.catch(() => bySwap.delete(id))
  return run
}

async function mix({ source, video, key, track, ahead }: YoutubeBgmSwap): Promise<Blob> {
  const trackBlob = await fetchTrack(track)
  const swapped: FinalAudioKey = { ...key, trackId: track.id }
  // The same two ways the BGM step mixes: audio built from `source` and
  // joined on (hardware path), or mixed into `video` as it is. Audio built
  // ahead for exactly this is used as it is.
  let prepared = ahead
  if (!prepared?.get(source, swapped)) {
    prepared = new PreparedAudio()
    if (await canUseWebCodecs()) prepared.prepare(source, swapped, async () => trackBlob)
  }
  const mixed = await mixForExport(prepared, source, video, trackBlob, swapped)
  // The voice preset went on in the mix, as on the normal version.
  return finishAudio(mixed, { voice: 'none', normalize: key.normalize })
}
