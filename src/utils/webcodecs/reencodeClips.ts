import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, VideoSampleSource } from 'mediabunny'
import { createMp4Output, createPrimedAacSource, decodeAudioTrack, runOutput } from './audioTrack'
import { OUTPUT_CHANNELS, OUTPUT_FRAME_RATE, OUTPUT_SAMPLE_RATE, VIDEO_QUALITY } from './support'
import { throwIfCancelled } from '../cancellation'

/**
 * Join clips by decoding every frame and encoding them again as one video,
 * for when they won't join by packet copy (concatClipsWebCodecs: e.g. the
 * device's encoder gave one clip a different header). Slower, but what's in
 * each clip (the 冒頭カード, the cover, the subtitles) all comes through.
 *
 * Each clip's picture goes at the end of the previous one's, and its audio
 * with it, cut where its picture ends. `onProgress` is 0-1 through the clips.
 */
export async function reencodeClipsWebCodecs(
  blobs: Blob[],
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfCancelled(signal)
  if (blobs.length === 0) throw new Error('reencodeClipsWebCodecs: no clips')

  const videoSource = new VideoSampleSource({ codec: 'avc', quality: VIDEO_QUALITY })
  const audioSource = await createPrimedAacSource()
  const output = createMp4Output()
  output.addVideoTrack(videoSource, { frameRate: OUTPUT_FRAME_RATE })
  output.addAudioTrack(audioSource)

  const buffer = await runOutput(output, async () => {
    const audio: { buffer: AudioBuffer; at: number; length: number }[] = []
    let offset = 0
    for (let i = 0; i < blobs.length; i++) {
      throwIfCancelled(signal)
      const input = new Input({ source: new BlobSource(blobs[i]), formats: ALL_FORMATS })
      try {
        const videoTrack = await input.getPrimaryVideoTrack()
        const audioTrack = await input.getPrimaryAudioTrack()
        if (!videoTrack || !audioTrack) throw new Error(`clip ${i} is missing a video or audio track`)
        const start = await videoTrack.getFirstTimestamp()
        const duration = (await videoTrack.computeDuration()) - start
        let end = offset
        for await (const sample of new VideoSampleSink(videoTrack).samples()) {
          try {
            throwIfCancelled(signal)
            const timestamp = sample.timestamp - start + offset
            end = Math.max(end, timestamp + sample.duration)
            sample.setTimestamp(timestamp)
            await videoSource.add(sample)
          } finally {
            sample.close()
          }
          if (duration > 0) onProgress?.(Math.min((i + (end - offset) / duration) / blobs.length, 1))
        }
        audio.push({ buffer: await decodeAudioTrack(audioTrack), at: offset - start, length: end - offset + start })
        offset = end
      } finally {
        input.dispose()
      }
    }
    videoSource.close()

    const out = new AudioBuffer({
      numberOfChannels: OUTPUT_CHANNELS,
      length: Math.max(1, Math.round(offset * OUTPUT_SAMPLE_RATE)),
      sampleRate: OUTPUT_SAMPLE_RATE,
    })
    for (const { buffer, at, length } of audio) {
      if (buffer.sampleRate !== OUTPUT_SAMPLE_RATE) throw new Error(`a clip's audio is ${buffer.sampleRate}Hz, expected ${OUTPUT_SAMPLE_RATE}Hz`)
      const into = Math.max(0, Math.round(at * OUTPUT_SAMPLE_RATE))
      const skip = Math.max(0, -Math.round(at * OUTPUT_SAMPLE_RATE))
      const keep = Math.min(buffer.length - skip, Math.round(length * OUTPUT_SAMPLE_RATE), out.length - into)
      if (keep <= 0) continue
      for (let c = 0; c < OUTPUT_CHANNELS; c++) {
        out.copyToChannel(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(skip, skip + keep), c, into)
      }
    }
    await audioSource.add(out)
    audioSource.close()
  })
  if (!buffer || buffer.byteLength < 1000) {
    throw new Error(`suspiciously small output (${buffer?.byteLength ?? 0} bytes)`)
  }
  return new Blob([buffer], { type: 'video/mp4' })
}
