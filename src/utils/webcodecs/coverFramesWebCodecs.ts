import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  Input,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny'
import { createMp4Output, createPrimedAacSource, decodeAudioTrack, runOutput } from './audioTrack'
import { concatClipsWebCodecs } from './concatClips'
import { normalizeShotWebCodecs } from './normalizeShot'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_SAMPLE_RATE } from './support'

/** How long each cover frame shows, in seconds. */
function frameDuration(): number {
  return 1 / OUTPUT_FRAME_RATE
}

/**
 * `video` with `count` frames of `frame` joined on at its start or its end,
 * silent under them. The cover becomes a clip of its own, encoded by
 * normalizeShotWebCodecs as every shot is, so it joins the finished video
 * by packet copy (concatClipsWebCodecs): nothing in `video` is re-encoded,
 * and its picture, subtitles included, and its audio move together. Throws
 * when the two encodes don't match (e.g. a video the ffmpeg fallback made,
 * or one whose frames the device's encoder tagged differently).
 */
export async function insertCoverFramesWebCodecs(
  video: Blob,
  frame: CanvasImageSource,
  placement: 'first' | 'last',
  count: number,
): Promise<Blob> {
  const clip = await normalizeShotWebCodecs(await rawCoverClip(frame, count), 0, count * frameDuration())
  return concatClipsWebCodecs(placement === 'first' ? [clip, video] : [video, clip])
}

/**
 * `count` frames of `frame` over silence, for normalizeShotWebCodecs to
 * encode as it does a recorded take. The silence runs a little past the
 * frames, so the trim never finds the audio short.
 */
async function rawCoverClip(frame: CanvasImageSource, count: number): Promise<Blob> {
  const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('very-high') })
  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') })
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
  output.addAudioTrack(audioSource)
  const buffer = await runOutput(output, async () => {
    await addCoverSamples(videoSource, frame, count, 0)
    videoSource.close()
    const length = Math.ceil((count * frameDuration() + 0.1) * OUTPUT_SAMPLE_RATE)
    await audioSource.add(new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length, sampleRate: OUTPUT_SAMPLE_RATE }))
    audioSource.close()
  })
  if (!buffer) throw new Error('could not encode the cover frames')
  return new Blob([buffer], { type: 'video/mp4' })
}

async function addCoverSamples(source: VideoSampleSource, frame: CanvasImageSource, count: number, start: number) {
  for (let i = 0; i < count; i++) {
    const sample = new VideoSample(frame, { timestamp: start + i * frameDuration(), duration: frameDuration() })
    try {
      await source.add(sample)
    } finally {
      sample.close()
    }
  }
}

/**
 * insertCoverFramesWebCodecs' result made the slow way, for when the cover
 * clip can't join by packet copy: every frame of `video` decoded and
 * encoded again with the cover's, on the hardware encoder. The audio is
 * decoded and laid into silence exactly the cover's length longer, from the
 * cover's end when it comes first, and encoded once more. `onProgress` is
 * 0-1 through the video's frames.
 */
export async function reencodeWithCoverFrames(
  video: Blob,
  frame: CanvasImageSource,
  placement: 'first' | 'last',
  count: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('the video is missing its picture or its audio')
    const duration = await videoTrack.computeDuration()
    const offset = placement === 'first' ? count * frameDuration() : 0
    const audio = await audioWithSilence(audioTrack, duration, count * frameDuration(), offset)

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('high') })
    const audioSource = await createPrimedAacSource()
    const output = createMp4Output()
    output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
    output.addAudioTrack(audioSource)
    const buffer = await runOutput(output, () =>
      Promise.all([
        (async () => {
          if (placement === 'first') await addCoverSamples(videoSource, frame, count, 0)
          let end = 0
          for await (const sample of new VideoSampleSink(videoTrack).samples()) {
            try {
              end = Math.max(end, sample.timestamp + sample.duration)
              sample.setTimestamp(sample.timestamp + offset)
              await videoSource.add(sample)
            } finally {
              sample.close()
            }
            if (duration > 0) onProgress?.(Math.min(end / duration, 1))
          }
          if (placement === 'last') await addCoverSamples(videoSource, frame, count, end)
          videoSource.close()
        })(),
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
  } finally {
    input.dispose()
  }
}

/**
 * The track's audio, cut where the picture ends (`duration`), placed at
 * `offset` into silence `extra` seconds longer than the picture.
 */
async function audioWithSilence(
  track: Parameters<typeof decodeAudioTrack>[0],
  duration: number,
  extra: number,
  offset: number,
): Promise<AudioBuffer> {
  const decoded = await decodeAudioTrack(track)
  const rate = decoded.sampleRate
  const out = new AudioBuffer({
    numberOfChannels: decoded.numberOfChannels,
    length: Math.round((duration + extra) * rate),
    sampleRate: rate,
  })
  const keep = Math.min(decoded.length, Math.round(duration * rate))
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    out.copyToChannel(decoded.getChannelData(c).subarray(0, keep), c, Math.round(offset * rate))
  }
  return out
}
