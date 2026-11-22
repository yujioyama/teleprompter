import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { applyVoicePreset, type VoicePreset } from '../voicePreset'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'
import { channelsOf } from './normalizeLoudnessWebCodecs'
import { bgmEnvelope, cardLevelOf, CARD_MUFFLE_HZ, CARD_RAMP_SECONDS, OPEN_HZ, PLAYS_TO_END, type BgmEnding } from '../bgmStop'

/**
 * ffmpeg's `amix` (normalize=1, the default) scales every input by
 * 1/<active inputs>. Both inputs stay active for the whole mix (the BGM is
 * looped to the full length), so the ffmpeg path always halved each one;
 * apply the same factor so both paths sound identical.
 */
const AMIX_SCALE = 0.5
const FADE_SECONDS = 1

/**
 * WebCodecs counterpart of the ffmpeg BGM mix: the video packets are copied
 * as-is, and only the audio is decoded, mixed and re-encoded to AAC.
 *
 * The mix itself runs in an OfflineAudioContext, reproducing the ffmpeg
 * filtergraph: the BGM is looped to the video's length, faded in over the
 * first second and out over the last, scaled by `volume`, then summed with
 * the original audio (both scaled as `amix` does). The BGM mp3 is decoded
 * with decodeAudioData, which every browser supports for mp3, rather than
 * through WebCodecs. `voice` (声の加工) is applied to the original audio
 * before the BGM goes under it. `ending` drops the BGM out just before the
 * punchline, or lowers it there for a soft genre (see bgmStop).
 */
export async function mixMusicWebCodecs(
  videoBlob: Blob,
  trackBlob: Blob,
  volume: number,
  voice: VoicePreset = 'none',
  ending: BgmEnding = PLAYS_TO_END,
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('video has no video or audio track')

    const duration = await input.computeDuration()
    const original = await decodeAudioTrack(audioTrack)
    applyVoicePreset(channelsOf(original), original.sampleRate, voice)
    const mixed = await renderMix(original, trackBlob, volume, duration, original.length, ending)
    return await muxWithAudio(videoTrack, mixed)
  } finally {
    input.dispose()
  }
}

/**
 * The BGM mixed under `original`, as the ffmpeg filtergraph would (see above).
 * `length` (samples) is the output's, default that of `original`; the
 * offline context cuts or pads `original` to it, so a caller needing another
 * length needn't copy the whole buffer first.
 */
/**
 * 冒頭カード ahead of the original audio: `seconds` long, with its voice
 * (mono, any rate) from `voice.at` seconds in.
 */
export interface OpeningAudio {
  seconds: number
  voice?: { samples: Float32Array; sampleRate: number; at: number }
}

export async function renderMix(
  original: AudioBuffer,
  trackBlob: Blob,
  volume: number,
  duration: number,
  length = original.length,
  ending: BgmEnding = PLAYS_TO_END,
  opening?: OpeningAudio,
): Promise<AudioBuffer> {
  // `amix duration=first`: the output is as long as the original audio.
  // 冒頭カード: the original starts after the card, whose voice plays on it;
  // the BGM plays from the very start, under the card too.
  const ctx = new OfflineAudioContext(original.numberOfChannels, length, original.sampleRate)

  const bgm = await ctx.decodeAudioData(await trackBlob.arrayBuffer())

  const originalNode = ctx.createBufferSource()
  originalNode.buffer = original
  const originalGain = ctx.createGain()
  originalGain.gain.value = AMIX_SCALE
  originalNode.connect(originalGain).connect(ctx.destination)

  // Fade in, duck and fade out are separate stages so that, like the
  // chained filters, they multiply where they overlap (on a clip shorter
  // than two seconds, or a soft BGM fading out from its lowered level).
  const bgmNode = ctx.createBufferSource()
  bgmNode.buffer = bgm
  bgmNode.loop = true
  const fadeIn = ctx.createGain()
  fadeIn.gain.setValueAtTime(0, 0)
  fadeIn.gain.linearRampToValueAtTime(1, FADE_SECONDS)
  const { duck: duckAt, fadeOut: fade } = bgmEnvelope(duration, ending)
  const duck = ctx.createGain()
  if (duckAt) {
    duck.gain.setValueAtTime(1, duckAt.start)
    // Held at `level` after the ramp, then faded out from there.
    duck.gain.linearRampToValueAtTime(duckAt.level, duckAt.start + duckAt.length)
  }
  const fadeOut = ctx.createGain()
  fadeOut.gain.setValueAtTime(1, fade.start)
  // Stays at 0 after the ramp, as `afade=t=out` does.
  fadeOut.gain.linearRampToValueAtTime(0, fade.start + fade.length)
  const bgmGain = ctx.createGain()
  bgmGain.gain.value = volume * AMIX_SCALE
  // 挿入カード: the same music, softer and muffled while each card is up (silent through a spooky one).
  const cardGain = ctx.createGain()
  const muffle = ctx.createBiquadFilter()
  muffle.type = 'lowpass'
  muffle.Q.value = Math.SQRT1_2
  muffle.frequency.value = OPEN_HZ
  for (const card of ending.cards ?? []) {
    const { start, end } = card
    const level = cardLevelOf(card)
    cardGain.gain.setValueAtTime(1, start)
    cardGain.gain.linearRampToValueAtTime(level, start + CARD_RAMP_SECONDS)
    cardGain.gain.setValueAtTime(level, end)
    cardGain.gain.linearRampToValueAtTime(1, end + CARD_RAMP_SECONDS)
    muffle.frequency.setValueAtTime(OPEN_HZ, start)
    muffle.frequency.exponentialRampToValueAtTime(CARD_MUFFLE_HZ, start + CARD_RAMP_SECONDS)
    muffle.frequency.setValueAtTime(CARD_MUFFLE_HZ, end)
    muffle.frequency.exponentialRampToValueAtTime(OPEN_HZ, end + CARD_RAMP_SECONDS)
  }
  bgmNode.connect(fadeIn).connect(duck).connect(fadeOut).connect(cardGain).connect(muffle).connect(bgmGain).connect(ctx.destination)

  originalNode.start(opening?.seconds ?? 0)
  if (opening?.voice && opening.voice.samples.length > 0) {
    const line = ctx.createBuffer(1, opening.voice.samples.length, opening.voice.sampleRate)
    line.getChannelData(0).set(opening.voice.samples)
    const voiceNode = ctx.createBufferSource()
    voiceNode.buffer = line
    const voiceGain = ctx.createGain()
    voiceGain.gain.value = AMIX_SCALE
    voiceNode.connect(voiceGain).connect(ctx.destination)
    voiceNode.start(opening.voice.at)
  }
  bgmNode.start(0)
  return ctx.startRendering()
}
