import { AudioBufferSource, Quality, VideoSample, VideoSampleSource } from 'mediabunny'
import { createMp4Output, runOutput } from './audioTrack'
import { concatClipsWebCodecs } from './concatClips'
import { normalizeShotWebCodecs } from './normalizeShot'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_SAMPLE_RATE } from './support'

/**
 * `video` with `count` frames of `frame` joined on at its start or its end,
 * silent under them. The cover becomes a clip of its own, encoded by
 * normalizeShotWebCodecs as every shot is, so it joins the finished video
 * by packet copy (concatClipsWebCodecs): nothing in `video` is re-encoded,
 * and its picture, subtitles included, and its audio move together. Throws
 * when the two encodes don't match (e.g. a video the ffmpeg fallback made).
 */
export async function insertCoverFramesWebCodecs(
  video: Blob,
  frame: CanvasImageSource,
  placement: 'first' | 'last',
  count: number,
): Promise<Blob> {
  const clip = await normalizeShotWebCodecs(await rawCoverClip(frame, count), 0, count / OUTPUT_FRAME_RATE)
  return concatClipsWebCodecs(placement === 'first' ? [clip, video] : [video, clip])
}

/**
 * `count` frames of `frame` over silence, for normalizeShotWebCodecs to
 * encode as it does a recorded take. The silence runs a little past the
 * frames, so the trim never finds the audio short.
 */
async function rawCoverClip(frame: CanvasImageSource, count: number): Promise<Blob> {
  const frameDuration = 1 / OUTPUT_FRAME_RATE
  const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('very-high') })
  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') })
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
  output.addAudioTrack(audioSource)
  const buffer = await runOutput(output, async () => {
    for (let i = 0; i < count; i++) {
      const sample = new VideoSample(frame, { timestamp: i * frameDuration, duration: frameDuration })
      try {
        await videoSource.add(sample)
      } finally {
        sample.close()
      }
    }
    videoSource.close()
    const length = Math.ceil((count * frameDuration + 0.1) * OUTPUT_SAMPLE_RATE)
    await audioSource.add(new AudioBuffer({ numberOfChannels: OUTPUT_CHANNELS, length, sampleRate: OUTPUT_SAMPLE_RATE }))
    audioSource.close()
  })
  if (!buffer) throw new Error('could not encode the cover frames')
  return new Blob([buffer], { type: 'video/mp4' })
}
