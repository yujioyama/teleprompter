import { detectSpeech, type SpeechRegion } from './detectSpeechBounds'
import { voiceSpeed, type HeardVoice } from './voiceEffects'
import { canUseWebCodecs } from './webcodecs/support'
import { buildHeardShotWebCodecs } from './webcodecs/heardShot'

/** Breath kept around the voice, like a shot's own trim padding. */
export const VOICE_PADDING_S = 0.15
/** After the last word, until the face has settled into listening. */
export const SETTLE_S = 0.4
/** Left off the end of the take: the reach for the stop button. */
export const TAIL_MARGIN_S = 0.3

export interface HeardPlan {
  /** Where the line is spoken in the take. */
  voice: { start: number; end: number }
  /** The stretch of quiet listening that is shown while it plays. */
  listen: { start: number; end: number }
}

/** The take stops too soon after the line to show a whole listening face. */
export class NotEnoughListeningError extends Error {
  constructor(readonly missingSeconds: number) {
    super(`not enough listening after the line (${missingSeconds.toFixed(1)}s short)`)
    this.name = 'NotEnoughListeningError'
  }
}

/**
 * 相手のセリフ: the take is the other person's line said aloud, then the
 * same length again spent quietly listening. The line's sound goes over the
 * listening picture, so the video shows a face hearing a voice from off
 * screen. Pure: which parts of the take those are. `speed` is how many
 * times quicker the line's voice will play.
 */
export function planHeardShot(region: SpeechRegion, speed = 1): HeardPlan {
  const voiceStart = Math.max(0, region.floor, region.speechStart - VOICE_PADDING_S)
  const voiceEnd = Math.min(region.duration, region.ceiling, region.speechEnd + VOICE_PADDING_S)
  // A voice played quicker or slower (see voiceSpeed) is listened to for as long as it then lasts.
  const length = (voiceEnd - voiceStart) / speed
  const listenStart = region.speechEnd + SETTLE_S
  const listenEnd = listenStart + length
  const available = Math.min(region.duration, region.ceiling) - TAIL_MARGIN_S
  if (listenEnd > available) throw new NotEnoughListeningError(listenEnd - available)
  return { voice: { start: voiceStart, end: voiceEnd }, listen: { start: listenStart, end: listenEnd } }
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
    return `セリフのあと、あと約${Math.ceil(err.missingSeconds * 10) / 10}秒長く黙って撮ってください`
  }
  return 'セリフの声を見つけられないか、この端末では作れませんでした'
}
