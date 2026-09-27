import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  InputAudioTrack,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'
import { aacEncoderDelay } from './support'

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
    const videoCodec = videoTrack.codec
    const videoConfig = await videoTrack.getDecoderConfig()
    if (!videoCodec || !videoConfig) throw new Error('unsupported video track')

    const duration = await input.computeDuration()
    const mixed = await renderMix(audioTrack, trackBlob, volume, duration)

    const videoSource = new EncodedVideoPacketSource(videoCodec)
    // Fed early by the encoder's priming delay so the audible start lands
    // at 0 and the priming is trimmed by an edit list (see aacEncoderDelay).
    const audioSource = new AudioBufferSource(
      { codec: 'aac', quality: new Quality('high') },
      { startTimestamp: -(await aacEncoderDelay()) },
    )
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    })
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() })
    output.addAudioTrack(audioSource)
    await output.start()
    try {
      await Promise.all([
        (async () => {
          let first = true
          for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
            await videoSource.add(packet, first ? { decoderConfig: videoConfig } : undefined)
            first = false
          }
          videoSource.close()
        })(),
        (async () => {
          await audioSource.add(mixed)
          audioSource.close()
        })(),
      ])
      await output.finalize()
    } catch (err) {
      await output.cancel().catch(() => undefined)
      throw err
    }
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error(`suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}

async function renderMix(
  audioTrack: InputAudioTrack,
  trackBlob: Blob,
  volume: number,
  duration: number,
): Promise<AudioBuffer> {
  const sampleRate = audioTrack.sampleRate
  const channels = Math.max(1, audioTrack.numberOfChannels)

  // Decode the original audio into one contiguous buffer, each chunk at its
  // own timestamp. Anything before 0 (AAC priming) is not part of the output.
  const chunks: { buffer: AudioBuffer; timestamp: number }[] = []
  let end = 0
  for await (const { buffer, timestamp } of new AudioBufferSink(audioTrack).buffers()) {
    chunks.push({ buffer, timestamp })
    end = Math.max(end, timestamp + buffer.duration)
  }
  // `amix duration=first`: the output is as long as the original audio.
  const length = Math.ceil(end * sampleRate)
  if (length <= 0) throw new Error('video has no decodable audio')

  const ctx = new OfflineAudioContext(channels, length, sampleRate)
  const original = ctx.createBuffer(channels, length, sampleRate)
  for (const { buffer, timestamp } of chunks) {
    let offset = Math.round(timestamp * sampleRate)
    let skip = 0
    if (offset < 0) {
      skip = -offset
      offset = 0
    }
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1))
      const slice = data.subarray(skip, Math.min(data.length, skip + length - offset))
      if (slice.length > 0) original.copyToChannel(slice, c, offset)
    }
  }
  chunks.length = 0

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
