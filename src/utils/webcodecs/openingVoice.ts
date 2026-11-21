import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { detectSpeech } from '../detectSpeechBounds'
import { lineEndOf, lineOf, VOICE_PADDING_S } from '../heardShot'
import { levelVoice } from '../voiceEffects'
import { getOpeningVoice } from '../cardVoiceStore'
import type { OpeningVoiceTiming, OpeningWord } from '../openingCard'
import { decodeAudioTrack } from './audioTrack'
import { spokenPart } from './heardShot'

/**
 * 冒頭カードの声: the user's own recording of the opening sentence, as it
 * plays on the card — cut to the words (with the breath a line keeps around
 * it), the room's hiss taken out, as loud as our own lines, and no other
 * effect: it's the user's own voice. With it come the times of its words,
 * which the camera app's on-device recognition wrote into the file's comment
 * (see parseWordTimes), moved to where the cut voice starts.
 */
export interface PreparedOpeningVoice {
  /** Which recording this is, for the cache and the burn's key. */
  key: string
  samples: Float32Array
  sampleRate: number
  timing: OpeningVoiceTiming
}

/**
 * The word times in the camera app's comment: `{"words":[{"w":"My","s":0.31,"e":0.52},…]}`,
 * seconds into the recording. Anything else (no comment, an older camera
 * app, a comment of something else): none.
 */
export function parseWordTimes(comment: string | undefined): OpeningWord[] {
  if (!comment) return []
  try {
    const data = JSON.parse(comment) as { words?: unknown }
    if (!Array.isArray(data.words)) return []
    return data.words.flatMap(entry => {
      const w = entry as Record<string, unknown>
      return typeof w.w === 'string' && typeof w.s === 'number' && typeof w.e === 'number' && Number.isFinite(w.s) && Number.isFinite(w.e)
        ? [{ word: w.w, start: w.s, end: Math.max(w.s, w.e) }]
        : []
    })
  } catch {
    return []
  }
}

/** The words moved to a voice cut from `cutStart` to `cutEnd`, the ones outside it dropped. */
export function wordsInCut(words: OpeningWord[], cutStart: number, cutEnd: number): OpeningWord[] {
  return words
    .filter(w => w.end > cutStart && w.start < cutEnd)
    .map(w => ({ word: w.word, start: Math.max(0, w.start - cutStart), end: Math.min(cutEnd, w.end) - cutStart }))
}

/** The voice prepared, or null when there are no words in it. */
export async function prepareOpeningVoice(blob: Blob, key: string): Promise<PreparedOpeningVoice | null> {
  const region = await detectSpeech(blob)
  if (!region) return null
  // The whole sentence: from where speech starts to where it ends, not just
  // its loudest stretch, which can leave a quiet word out.
  const loud = lineOf(region)
  const from = Math.min(loud.start, Math.max(region.floor, region.speechStart))
  const to = Math.max(loud.end, lineEndOf(region))
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const tags = await input.getMetadataTags().catch(() => ({}) as { comment?: string })
    const start = Math.max(0, from - VOICE_PADDING_S)
    const end = Math.min(region.duration, to + VOICE_PADDING_S)
    const spoken = spokenPart(await decodeAudioTrack(track), start, end)
    const samples = levelVoice(spoken.samples, spoken.sampleRate)
    const seconds = samples.length / spoken.sampleRate
    if (seconds <= 0) return null
    const words = wordsInCut(parseWordTimes(tags.comment), start, end)
    return { key, samples, sampleRate: spoken.sampleRate, timing: { seconds, ...(words.length ? { words } : {}) } }
  } finally {
    input.dispose()
  }
}

// One preparation per recording: the timing, the burn and the finished audio all ask for it.
const prepared = new Map<string, Promise<PreparedOpeningVoice | null>>()

const keyOf = (scriptId: string, savedAt: string) => `opening:${scriptId}@${savedAt}`

/**
 * The script's opening voice, prepared once per recording; null when none is
 * recorded or there are no words in it. Rejects when it can't be read (not
 * kept, so the next call tries again).
 */
export function openingVoiceOf(scriptId: string): Promise<PreparedOpeningVoice | null> {
  return getOpeningVoice(scriptId).then(stored => {
    if (!stored) return null
    const key = keyOf(scriptId, stored.savedAt)
    let made = prepared.get(key)
    if (!made) {
      made = prepareOpeningVoice(stored.blob, key)
      prepared.set(key, made)
      made.catch(() => prepared.delete(key))
    }
    return made
  })
}

/** The voice a plan names by its key: the one prepared for it, or prepared again from the store. */
export async function openingVoiceByKey(key: string): Promise<PreparedOpeningVoice | null> {
  const made = prepared.get(key)
  if (made) return made
  const scriptId = /^opening:(.+)@[^@]+$/.exec(key)?.[1]
  if (!scriptId) return null
  const voice = await openingVoiceOf(scriptId)
  // A newer recording came in since the plan was made: that isn't the one it timed.
  return voice?.key === key ? voice : null
}
