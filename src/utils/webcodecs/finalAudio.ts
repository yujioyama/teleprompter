import { ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedVideoPacketSource, Input } from 'mediabunny'
import { copyPackets, createMp4Output, createPrimedAacSource, decodeAudioTrack, runOutput } from './audioTrack'
import { renderMix } from './mixMusicWebCodecs'
import { applyTargetLoudness } from './normalizeLoudnessWebCodecs'

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
  // Its return value only says whether anything changed; the buffer is
  // encoded either way.
  if (normalize) applyTargetLoudness(audio)
  return encodeAudioOnly(audio)
}

async function encodeAudioOnly(audio: AudioBuffer): Promise<Blob> {
  // Primed as muxWithAudio's is, so the audible start lands at 0 once the
  // packets are copied next to the video.
  const source = await createPrimedAacSource()
  const output = createMp4Output()
  output.addAudioTrack(source)
  const buffer = await runOutput(output, async () => {
    await source.add(audio)
    source.close()
  })
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
    const output = createMp4Output()
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() })
    output.addAudioTrack(audioSource)
    const buffer = await runOutput(output, () =>
      Promise.all([
        copyPackets(videoTrack, videoSource, videoConfig),
        copyPackets(audioTrack, audioSource, audioConfig),
      ]),
    )
    if (!buffer || buffer.byteLength < 1000) {
      throw new Error(`join: suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    videoInput.dispose()
    audioInput.dispose()
  }
}
