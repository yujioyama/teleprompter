import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'
import { decodeAudioTrack } from './audioTrack'
import { renderMix } from './mixMusicWebCodecs'
import { applyTargetLoudness } from './normalizeLoudnessWebCodecs'
import { aacEncoderDelay } from './support'

/**
 * How far prepared audio may run from the video it's joined to. Two encodes
 * of the same trims differ by a frame at most; anything more means the
 * audio was built for another cut.
 */
export const MAX_DURATION_MISMATCH = 0.05

export function durationsMatch(audio: number, video: number): boolean {
  return Math.abs(audio - video) <= MAX_DURATION_MISMATCH
}

/**
 * The finished video's audio, built from `source` (the combined video,
 * before subtitles): the BGM mixed in as mixMusicWebCodecs does, then, if
 * `normalize`, brought to the export loudness as normalizeLoudnessWebCodecs
 * does. Returned encoded, as an audio-only M4A: the float buffer is ~23 MB a
 * minute, which iOS can't spare while burning subtitles (issue #12).
 */
export async function prepareFinalAudio(
  source: Blob,
  track: Blob,
  volume: number,
  normalize: boolean,
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS })
  let audio: AudioBuffer
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) throw new Error('video has no audio track')
    const duration = await input.computeDuration()
    audio = await renderMix(await decodeAudioTrack(audioTrack), track, volume, duration)
  } finally {
    input.dispose()
  }
  if (normalize) applyTargetLoudness(audio)
  return encodeAudioOnly(audio)
}

async function encodeAudioOnly(audio: AudioBuffer): Promise<Blob> {
  // Fed early by the encoder's priming delay, as muxWithAudio does, so the
  // audible start lands at 0 once the packets are copied next to the video.
  const source = new AudioBufferSource(
    { codec: 'aac', quality: new Quality('high') },
    { startTimestamp: -(await aacEncoderDelay()) },
  )
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  output.addAudioTrack(source)
  await output.start()
  try {
    await source.add(audio)
    source.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
  const buffer = output.target.buffer
  if (!buffer) throw new Error('prepared audio: no output')
  return new Blob([buffer], { type: 'audio/mp4' })
}

/**
 * An MP4 with `video`'s video packets and `audio`'s audio packets, both
 * copied as they are — no decoding or encoding. Throws when the two differ
 * in length by more than MAX_DURATION_MISMATCH, so the caller can mix the
 * slow way instead.
 */
export async function joinVideoAndAudio(video: Blob, audio: Blob): Promise<Blob> {
  const videoInput = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  const audioInput = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS })
  try {
    const videoTrack = await videoInput.getPrimaryVideoTrack()
    const audioTrack = await audioInput.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('join: missing the video or the prepared audio')

    const videoDuration = await videoTrack.computeDuration()
    const audioDuration = await audioTrack.computeDuration()
    if (!durationsMatch(audioDuration, videoDuration)) {
      throw new Error(`join: prepared audio is ${audioDuration.toFixed(3)}s, video is ${videoDuration.toFixed(3)}s`)
    }

    const videoCodec = videoTrack.codec
    const audioCodec = audioTrack.codec
    const videoConfig = await videoTrack.getDecoderConfig()
    const audioConfig = await audioTrack.getDecoderConfig()
    if (!videoCodec || !audioCodec || !videoConfig || !audioConfig) throw new Error('join: unsupported track')

    const videoSource = new EncodedVideoPacketSource(videoCodec)
    const audioSource = new EncodedAudioPacketSource(audioCodec)
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
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
          let first = true
          for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
            await audioSource.add(packet, first ? { decoderConfig: audioConfig } : undefined)
            first = false
          }
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
      throw new Error(`join: suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    videoInput.dispose()
    audioInput.dispose()
  }
}
