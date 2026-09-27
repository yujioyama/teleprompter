import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  InputAudioTrack,
  InputVideoTrack,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'
import { aacEncoderDelay } from './support'

/**
 * Decode a whole audio track into one contiguous AudioBuffer at the track's
 * own rate and channel count, each decoded chunk placed at its timestamp.
 * Anything before 0 (AAC priming) is not part of the audio.
 */
export async function decodeAudioTrack(audioTrack: InputAudioTrack): Promise<AudioBuffer> {
  const sampleRate = audioTrack.sampleRate
  const channels = Math.max(1, audioTrack.numberOfChannels)

  const chunks: { buffer: AudioBuffer; timestamp: number }[] = []
  let end = 0
  for await (const { buffer, timestamp } of new AudioBufferSink(audioTrack).buffers()) {
    chunks.push({ buffer, timestamp })
    end = Math.max(end, timestamp + buffer.duration)
  }
  const length = Math.ceil(end * sampleRate)
  if (length <= 0) throw new Error('video has no decodable audio')

  const out = new AudioBuffer({ numberOfChannels: channels, length, sampleRate })
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
      if (slice.length > 0) out.copyToChannel(slice, c, offset)
    }
  }
  return out
}

/**
 * Write a new MP4 with `videoTrack`'s packets copied as-is and `audio`
 * encoded to AAC as its only audio track.
 */
export async function muxWithAudio(videoTrack: InputVideoTrack, audio: AudioBuffer): Promise<Blob> {
  const videoCodec = videoTrack.codec
  const videoConfig = await videoTrack.getDecoderConfig()
  if (!videoCodec || !videoConfig) throw new Error('unsupported video track')

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
        await audioSource.add(audio)
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
}
