import { delayEnding, type BgmEnding } from './bgmStop'
import { mixMusic } from './mixMusic'
import { markLoudnessNormalized } from './normalizeLoudness'
import { joinVideoAndAudio, prepareFinalAudio } from './webcodecs/finalAudio'
import type { VoicePreset } from './voicePreset'

/** Everything the finished audio depends on besides the video's own sound. */
export interface FinalAudioKey {
  trackId: string
  volume: number
  normalize: boolean
  voice: VoicePreset
  /** Where the punchline starts and how the BGM ends there (see bgmStop). */
  ending: BgmEnding
  /**
   * Seconds of silence the video starts with before the source's audio:
   * the cover frames the burn put in ahead of the first shot, or 0.
   */
  lead: number
}

function sameKey(a: FinalAudioKey, b: FinalAudioKey): boolean {
  return a.trackId === b.trackId && a.volume === b.volume && a.normalize === b.normalize && a.voice === b.voice && a.ending.stopAt === b.ending.stopAt && a.ending.soft === b.ending.soft && a.lead === b.lead
}

/**
 * The finished video's audio (voice preset applied, BGM mixed in, loudness
 * corrected), built from the combined video while the subtitles are still
 * being worked on: subtitles only change the picture, so the audio needn't
 * wait for the burn. Holds one result at a time.
 */
export class PreparedAudio {
  private entry: { source: Blob; key: FinalAudioKey; audio: Promise<Blob> } | null = null

  prepare(source: Blob, key: FinalAudioKey, track: () => Promise<Blob>): void {
    if (this.entry && this.entry.source === source && sameKey(this.entry.key, key)) return
    const audio = track().then(blob => prepareFinalAudio(source, blob, key.volume, key.normalize, key.voice, key.ending, key.lead))
    // Only means mixing the slow way later; never shown to the user.
    audio.catch(err => console.warn('[PreparedAudio] could not prepare the final audio:', err))
    this.entry = { source, key, audio }
  }

  get(source: Blob, key: FinalAudioKey): Promise<Blob> | null {
    if (!this.entry || this.entry.source !== source || !sameKey(this.entry.key, key)) return null
    return this.entry.audio
  }

  /**
   * Resolves once the audio being prepared is done (or has failed), right
   * away when there is none. For heavy work that shouldn't run alongside it
   * on a phone, such as transcription.
   */
  async settled(): Promise<void> {
    await this.entry?.audio.catch(() => undefined)
  }

  clear(): void {
    this.entry = null
  }
}

/**
 * Add the BGM to `video`, the burned version of `source`: by joining it with
 * audio prepared for exactly this source and choice when there is some,
 * otherwise by mixing as before. A joined video's loudness is already
 * corrected when `key.normalize`, so the export step won't redo it. Mixed
 * into `video` as it is, the BGM stops where the punchline is in `video`:
 * `key.lead` after where it is in `source`.
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
      const start = performance.now()
      const joined = await joinVideoAndAudio(video, await audio)
      if (key.normalize) markLoudnessNormalized(joined)
      // Seen in the console when testing on a device: a silent fallback
      // would otherwise look the same as the fast path, only slower.
      console.info(`[mixForExport] joined prepared audio in ${Math.round(performance.now() - start)} ms`)
      return joined
    } catch (err) {
      console.warn('[mixForExport] prepared audio unusable, mixing instead:', err)
    }
  } else {
    console.info('[mixForExport] no prepared audio for this choice, mixing instead')
  }
  return mixMusic(video, trackBlob, key.volume, key.voice, delayEnding(key.ending, key.lead))
}
