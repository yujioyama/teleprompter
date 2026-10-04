import { mixMusic } from './mixMusic'
import { markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'

/** Everything the finished audio depends on besides the video's own sound. */
export interface FinalAudioKey {
  trackId: string
  volume: number
  normalize: boolean
}

function sameKey(a: FinalAudioKey, b: FinalAudioKey): boolean {
  return a.trackId === b.trackId && a.volume === b.volume && a.normalize === b.normalize
}

/**
 * The finished video's audio (BGM mixed in, loudness corrected), built from
 * the combined video while the subtitles are still being worked on:
 * subtitles only change the picture, so the audio needn't wait for the
 * burn. Holds one result at a time.
 */
export class PreparedAudio {
  private entry: { source: Blob; key: FinalAudioKey; audio: Promise<Blob> } | null = null

  prepare(source: Blob, key: FinalAudioKey, track: () => Promise<Blob>): void {
    if (this.entry && this.entry.source === source && sameKey(this.entry.key, key)) return
    const audio = track().then(blob => prepareFinalAudio(source, blob, key.volume, key.normalize))
    // Only means mixing the slow way later; never shown to the user.
    audio.catch(err => console.warn('[PreparedAudio] could not prepare the final audio:', err))
    this.entry = { source, key, audio }
  }

  get(source: Blob, key: FinalAudioKey): Promise<Blob> | null {
    if (!this.entry || this.entry.source !== source || !sameKey(this.entry.key, key)) return null
    return this.entry.audio
  }

  clear(): void {
    this.entry = null
  }
}

/**
 * Add the BGM to `video`, the burned version of `source`: by joining it with
 * audio prepared for exactly this source and choice when there is some,
 * otherwise by mixing as before. A joined video's loudness is already
 * corrected when `key.normalize`, so the export step won't redo it.
 */
export async function mixForExport(
  prepared: PreparedAudio,
  source: Blob,
  video: Blob,
  trackBlob: Blob,
  key: FinalAudioKey,
): Promise<Blob> {
  const audio = prepared.get(source, key)
  if (audio) {
    try {
      const joined = await joinVideoAndAudio(video, await audio)
      if (key.normalize) markLoudnessNormalized(joined)
      return joined
    } catch (err) {
      console.warn('[mixForExport] prepared audio unusable, mixing instead:', err)
    }
  }
  return mixMusic(video, trackBlob, key.volume)
}
