import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { HeardPlan } from '../heardShot'
import { reduceNoise } from '../denoise'
import { heardZoomTo } from '../heardZoom'
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
 * `voiceSource`, when given, is where the line's voice is taken from in place
 * of the take: a recording made ahead in the camera app (see
 * makeHeardShotFromVoice), whose timeline `plan.voice` is in.
 *
 * The picture goes through normalizeShotWebCodecs and the audio through
 * muxWithAudio, the same two steps every other clip already takes, so the
 * result is an ordinary take as far as trimming, joining and subtitles go.
 */
export async function buildHeardShotWebCodecs(
  take: Blob,
  plan: HeardPlan,
  voice?: HeardVoice,
  voiceSource?: Blob,
): Promise<Blob> {
  const picture = await normalizeShotWebCodecs(take, plan.listen.start, plan.listen.end, undefined, [], undefined, {
    stretch: plan.stretch,
    slowZoom: heardZoomTo((plan.listen.end - plan.listen.start) * plan.stretch),
  })
  const source = new Input({ source: new BlobSource(voiceSource ?? take), formats: ALL_FORMATS })
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

/**
 * The line itself: `whole` between `start` and `end` seconds, its channels
 * mixed to one, with the room's hiss taken out (see reduceNoise). The hiss
 * is learned from the whole recording, which has more quiet in it than the
 * line's own padding.
 */
function lineOf(whole: AudioBuffer, start: number, end: number): { samples: Float32Array; sampleRate: number } {
  const mono = new Float32Array(whole.length)
  for (let channel = 0; channel < whole.numberOfChannels; channel++) {
    const data = whole.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / whole.numberOfChannels
  }
  const clean = reduceNoise(mono)
  const from = Math.max(0, Math.floor(start * whole.sampleRate))
  const to = Math.min(whole.length, Math.ceil(end * whole.sampleRate))
  return { samples: clean.slice(from, Math.max(from, to)), sampleRate: whole.sampleRate }
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

/** How long a recording lasts, in seconds. */
export async function mediaDurationWebCodecs(blob: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    return await input.computeDuration()
  } finally {
    input.dispose()
  }
}
