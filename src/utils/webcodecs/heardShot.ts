import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { HeardPlan } from '../heardShot'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'
import { normalizeShotWebCodecs } from './normalizeShot'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE } from './support'

/** Short ramps at both ends so the cut into the voice doesn't click. */
const EDGE_FADE_S = 0.01

/**
 * The clip of a 相手のセリフ shot (see planHeardShot): the listening stretch
 * of `take` encoded as any shot is, with the audio replaced by the part of
 * the take where the line is spoken.
 *
 * The picture goes through normalizeShotWebCodecs and the audio through
 * muxWithAudio, the same two steps every other clip already takes, so the
 * result is an ordinary take as far as trimming, joining and subtitles go.
 */
export async function buildHeardShotWebCodecs(take: Blob, plan: HeardPlan): Promise<Blob> {
  const picture = await normalizeShotWebCodecs(take, plan.listen.start, plan.listen.end)
  const source = new Input({ source: new BlobSource(take), formats: ALL_FORMATS })
  const listening = new Input({ source: new BlobSource(picture), formats: ALL_FORMATS })
  try {
    const audioTrack = await source.getPrimaryAudioTrack()
    const videoTrack = await listening.getPrimaryVideoTrack()
    if (!audioTrack || !videoTrack) throw new Error('take has no video or audio track')
    // Built to the picture's length, as prepareFinalAudio does, so the two end together.
    const seconds = await videoTrack.computeDuration()
    const voice = await renderVoice(await decodeAudioTrack(audioTrack), plan.voice.start, seconds)
    return await muxWithAudio(videoTrack, voice)
  } finally {
    source.dispose()
    listening.dispose()
  }
}

/** `seconds` of `whole` from `start`, at the output's rate and channel count. */
async function renderVoice(whole: AudioBuffer, start: number, seconds: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(seconds * OUTPUT_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(OUTPUT_CHANNELS, length, OUTPUT_SAMPLE_RATE)
  const node = ctx.createBufferSource()
  node.buffer = whole
  const gain = ctx.createGain()
  const fade = Math.min(EDGE_FADE_S, seconds / 4)
  gain.gain.setValueAtTime(0, 0)
  gain.gain.linearRampToValueAtTime(1, fade)
  gain.gain.setValueAtTime(1, Math.max(fade, seconds - fade))
  gain.gain.linearRampToValueAtTime(0, seconds)
  node.connect(gain).connect(ctx.destination)
  node.start(0, start, seconds)
  return ctx.startRendering()
}
