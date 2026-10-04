import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  InputAudioTrack,
  InputTrack,
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
 * Copy every packet of `track` into `source` as-is, then close it. The
 * decoder config rides on the first packet, as the muxer expects.
 */
export async function copyPackets<C>(
  track: InputTrack,
  source: { add(packet: EncodedPacket, meta?: { decoderConfig: C }): Promise<void>; close(): void },
  decoderConfig: C,
): Promise<void> {
  let first = true
  for await (const packet of new EncodedPacketSink(track).packets()) {
    await source.add(packet, first ? { decoderConfig } : undefined)
    first = false
  }
  source.close()
}

/** An AAC encoder source whose audible start lands at 0 in the output. */
export async function createPrimedAacSource(): Promise<AudioBufferSource> {
  // Fed early by the encoder's priming delay so the audible start lands
  // at 0 and the priming is trimmed by an edit list (see aacEncoderDelay).
  return new AudioBufferSource(
    { codec: 'aac', quality: new Quality('high') },
    { startTimestamp: -(await aacEncoderDelay()) },
  )
}

export function createMp4Output(): Output<Mp4OutputFormat, BufferTarget> {
  return new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
}

/**
 * Start `output`, run `feed` to fill its sources, and finalize; the output is
 * cancelled if anything fails so no half-written file is left behind.
 * Returns the written bytes, or null if the target got none.
 */
export async function runOutput(
  output: Output<Mp4OutputFormat, BufferTarget>,
  feed: () => Promise<unknown>,
): Promise<ArrayBuffer | null> {
  await output.start()
  try {
    await feed()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
  return output.target.buffer
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
  const audioSource = await createPrimedAacSource()
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() })
  output.addAudioTrack(audioSource)
  const buffer = await runOutput(output, () =>
    Promise.all([
      copyPackets(videoTrack, videoSource, videoConfig),
      (async () => {
        await audioSource.add(audio)
        audioSource.close()
      })(),
    ]),
  )
  if (!buffer || buffer.byteLength < 1000) {
    throw new Error(`suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
  }
  return new Blob([buffer], { type: 'video/mp4' })
}
