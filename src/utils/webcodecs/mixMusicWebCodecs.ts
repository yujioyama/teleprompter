import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { decodeAudioTrack, muxWithAudio } from './audioTrack'

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
 * through WebCodecs.
 */
export async function mixMusicWebCodecs(videoBlob: Blob, trackBlob: Blob, volume: number): Promise<Blob> {
  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('video has no video or audio track')

    const duration = await input.computeDuration()
    const original = await decodeAudioTrack(audioTrack)
    const mixed = await renderMix(original, trackBlob, volume, duration)
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
export async function renderMix(
  original: AudioBuffer,
  trackBlob: Blob,
  volume: number,
  duration: number,
  length = original.length,
): Promise<AudioBuffer> {
  // `amix duration=first`: the output is as long as the original audio.
  const ctx = new OfflineAudioContext(original.numberOfChannels, length, original.sampleRate)

  const bgm = await ctx.decodeAudioData(await trackBlob.arrayBuffer())

  const originalNode = ctx.createBufferSource()
  originalNode.buffer = original
  const originalGain = ctx.createGain()
  originalGain.gain.value = AMIX_SCALE
  originalNode.connect(originalGain).connect(ctx.destination)

  // Fade in/out are separate stages so that, like chained `afade`s, they
  // multiply where they overlap on a clip shorter than two seconds.
  const bgmNode = ctx.createBufferSource()
  bgmNode.buffer = bgm
  bgmNode.loop = true
  const fadeIn = ctx.createGain()
  fadeIn.gain.setValueAtTime(0, 0)
  fadeIn.gain.linearRampToValueAtTime(1, FADE_SECONDS)
  const fadeOutStart = Math.max(0, duration - FADE_SECONDS)
  const fadeOut = ctx.createGain()
  fadeOut.gain.setValueAtTime(1, fadeOutStart)
  fadeOut.gain.linearRampToValueAtTime(0, fadeOutStart + FADE_SECONDS)
  const bgmGain = ctx.createGain()
  bgmGain.gain.value = volume * AMIX_SCALE
  bgmNode.connect(fadeIn).connect(fadeOut).connect(bgmGain).connect(ctx.destination)

  originalNode.start(0)
  bgmNode.start(0)
  return ctx.startRendering()
}
