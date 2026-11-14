import { detectSpeech, type SpeechRegion } from './detectSpeechBounds'
import { CONVERSATION_PADDING } from './shotTrim'
import { voiceSpeed, type HeardVoice } from './voiceEffects'
import { canUseWebCodecs } from './webcodecs/support'
import { buildHeardShotWebCodecs } from './webcodecs/heardShot'

/**
 * Silence kept around the voice, as much as a conversation keeps around
 * every line (CONVERSATION_PADDING): the clip's own edges are as far as
 * trimming can reach, so this is the breath before and after their line.
 */
export const VOICE_PADDING_S = CONVERSATION_PADDING
/** After the last word, until the face has settled into listening. */
export const SETTLE_S = 0.25
/** Left off the end of the take: the reach for the stop button. */
export const TAIL_MARGIN_S = 0.2

/**
 * A silence at least this long ends the line: one short line has no pause
 * this long inside it, and whatever is heard after it (a breath, a rustle,
 * the chair) is part of the listening, not of the line.
 */
export const LINE_END_GAP_S = 0.6

/** The least listening kept after the line, however short the line. */
export const MIN_LISTEN_S = 0.4
/** The listening is slowed down at most this much to last as long as the line. */
export const MAX_STRETCH = 6

export interface HeardPlan {
  /** Where the line is spoken in the take. */
  voice: { start: number; end: number }
  /** The stretch of quiet listening that is shown while it plays. */
  listen: { start: number; end: number }
  /**
   * How many times slower the listening plays (1 or more), so a short
   * silence after the line still lasts as long as the voice.
   */
  stretch: number
}

/** The take stops too soon after the line to show a listening face at all. */
export class NotEnoughListeningError extends Error {
  constructor(readonly missingSeconds: number) {
    super(`not enough listening after the line (${missingSeconds.toFixed(1)}s short)`)
    this.name = 'NotEnoughListeningError'
  }
}

/**
 * 相手のセリフ: the take is the other person's line said aloud, then a moment
 * of quiet listening. The line's sound goes over the listening picture, so
 * the video shows a face hearing a voice from off screen. The listening
 * after the line is used as it is when it's at least as long as the voice,
 * and played slower (up to MAX_STRETCH times) to last as long when it's
 * shorter. Pure: which parts of the take those are. `speed` is how many
 * times quicker the line's voice will play.
 */
export function planHeardShot(region: SpeechRegion, speed = 1): HeardPlan {
  const lineEnd = lineEndOf(region)
  const voiceStart = Math.max(0, region.floor, region.speechStart - VOICE_PADDING_S)
  const voiceEnd = Math.min(region.duration, lineEnd + VOICE_PADDING_S)
  // A voice played quicker or slower (see voiceSpeed) is listened to for as long as it then lasts.
  const voiceLength = (voiceEnd - voiceStart) / speed
  const listenStart = lineEnd + SETTLE_S
  // Small sounds while listening don't matter to the picture: only the end of the take does.
  const available = region.duration - TAIL_MARGIN_S - listenStart
  const needed = Math.max(MIN_LISTEN_S, voiceLength / MAX_STRETCH)
  if (available < needed) throw new NotEnoughListeningError(needed - Math.max(0, available))
  const listenLength = Math.min(available, voiceLength)
  return {
    voice: { start: voiceStart, end: voiceEnd },
    listen: { start: listenStart, end: listenStart + listenLength },
    stretch: Math.max(1, voiceLength / listenLength),
  }
}

/**
 * Where the line ends: at the first long silence after it starts (see
 * LINE_END_GAP_S), else where the speech ends. Speech detection runs on to
 * the last sound it can join, which in a quiet listening take can be a
 * breath or a rustle seconds after the line.
 */
export function lineEndOf(region: SpeechRegion): number {
  const gap = region.pauses?.find(p => p.start > region.speechStart && p.end - p.start >= LINE_END_GAP_S)
  return gap ? gap.start : region.speechEnd
}

/**
 * Turn a take of a 相手のセリフ shot into the clip the finalize step joins:
 * the listening picture with the line's voice. Rejects when there is no
 * speech, not enough listening after it, or no WebCodecs to build it with;
 * the caller keeps the take as it was.
 */
export async function makeHeardShot(take: Blob, voice?: HeardVoice): Promise<Blob> {
  if (!(await canUseWebCodecs())) throw new Error('WebCodecs is not available')
  const region = await detectSpeech(take)
  if (!region) throw new Error('no speech in the take')
  return buildHeardShotWebCodecs(take, planHeardShot(region, voiceSpeed(voice)), voice)
}

/** What to tell the person when a 相手のセリフ take couldn't be made. */
export function heardShotFailureText(err: unknown): string {
  if (err instanceof NotEnoughListeningError) {
    return `セリフのあと、あと約${Math.ceil(err.missingSeconds * 10) / 10}秒長く黙って聞く顔をしてから止めてください`
  }
  return 'セリフの声を見つけられないか、この端末では作れませんでした'
}
