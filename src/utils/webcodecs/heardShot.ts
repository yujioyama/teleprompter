import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { HeardPlan } from '../heardShot'
import { levelVoice, shapeVoice, type HeardVoice } from '../voiceEffects'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'
import { normalizeShotWebCodecs } from './normalizeShot'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE } from './support'

/** Short ramps at both ends so the cut into the voice doesn't click. */
const EDGE_FADE_S = 0.01

/**
 * The clip of a 相手のセリフ shot (see planHeardShot): the listening stretch
 * of `take` encoded as any shot is, with the audio replaced by the part of
 * the take where the line is spoken, in `voice` (see shapeVoice).
 *
 * The picture goes through normalizeShotWebCodecs and the audio through
 * muxWithAudio, the same two steps every other clip already takes, so the
 * result is an ordinary take as far as trimming, joining and subtitles go.
 */
export async function buildHeardShotWebCodecs(take: Blob, plan: HeardPlan, voice?: HeardVoice): Promise<Blob> {
  const picture = await normalizeShotWebCodecs(take, plan.listen.start, plan.listen.end, undefined, [], undefined, { stretch: plan.stretch })
  const source = new Input({ source: new BlobSource(take), formats: ALL_FORMATS })
  const listening = new Input({ source: new BlobSource(picture), formats: ALL_FORMATS })
  try {
    const audioTrack = await source.getPrimaryAudioTrack()
    const videoTrack = await listening.getPrimaryVideoTrack()
    if (!audioTrack || !videoTrack) throw new Error('take has no video or audio track')
    // Built to the picture's length, as prepareFinalAudio does, so the two end together.
    const seconds = await videoTrack.computeDuration()
    const spoken = lineOf(await decodeAudioTrack(audioTrack), plan.voice.start, plan.voice.end)
    // Whatever the effect did to its level, and however softly it was said, as loud as our own lines.
    const shaped = levelVoice(Float32Array.from(shapeVoice(spoken.samples, spoken.sampleRate, voice)), spoken.sampleRate)
    return await muxWithAudio(videoTrack, await renderVoice(shaped, spoken.sampleRate, seconds))
  } finally {
    source.dispose()
    listening.dispose()
  }
}

/** The line itself: `whole` between `start` and `end` seconds, its channels mixed to one. */
function lineOf(whole: AudioBuffer, start: number, end: number): { samples: Float32Array; sampleRate: number } {
  const from = Math.max(0, Math.floor(start * whole.sampleRate))
  const to = Math.min(whole.length, Math.ceil(end * whole.sampleRate))
  const samples = new Float32Array(Math.max(0, to - from))
  for (let channel = 0; channel < whole.numberOfChannels; channel++) {
    const data = whole.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) samples[i] += data[from + i] / whole.numberOfChannels
  }
  return { samples, sampleRate: whole.sampleRate }
}

/** The voice as `seconds` of audio at the output's rate and channel count. */
async function renderVoice(samples: Float32Array, sampleRate: number, seconds: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(seconds * OUTPUT_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(OUTPUT_CHANNELS, length, OUTPUT_SAMPLE_RATE)
  const line = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate)
  line.getChannelData(0).set(samples)
  const node = ctx.createBufferSource()
  node.buffer = line
  const gain = ctx.createGain()
  const fade = Math.min(EDGE_FADE_S, seconds / 4)
  gain.gain.setValueAtTime(0, 0)
  gain.gain.linearRampToValueAtTime(1, fade)
  gain.gain.setValueAtTime(1, Math.max(fade, seconds - fade))
  gain.gain.linearRampToValueAtTime(0, seconds)
  node.connect(gain).connect(ctx.destination)
  node.start(0)
  return ctx.startRendering()
}
