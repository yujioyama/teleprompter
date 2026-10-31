import { AudioSample, VideoSample } from 'mediabunny'
import { OUTPUT_FRAME_RATE } from './support'

/**
 * The cover image put in as frames before a shot's own, by the same encode
 * as the shot: one encoder session, so the cover can't come out tagged
 * differently from the rest and refuse to join by packet copy (as a cover
 * clip encoded on its own can on an iPhone).
 */
export interface CoverLead {
  /** The cover at the output size. */
  frame: CanvasImageSource
  count: number
}

/** How long `count` cover frames last, in seconds: what everything after them moves by. */
export function coverLeadSeconds(count: number): number {
  return count / OUTPUT_FRAME_RATE
}

type VideoProcess = (sample: VideoSample) => VideoSample | OffscreenCanvas

/**
 * A Mediabunny `video.process` putting `cover.count` frames of the cover
 * before the first frame, and every frame (as `process` made it, in the
 * shot's own timeline) that much later.
 */
export function withCoverFrames(process: VideoProcess | undefined, cover: CoverLead) {
  const lead = coverLeadSeconds(cover.count)
  let first = true
  return (sample: VideoSample): VideoSample | VideoSample[] => {
    const start = sample.timestamp
    const made = process ? process(sample) : sample
    const later =
      made instanceof VideoSample
        ? made
        : new VideoSample(made, { timestamp: start, duration: sample.duration })
    later.setTimestamp(start + lead)
    if (!first) return later
    first = false
    const covers = Array.from(
      { length: cover.count },
      (_, i) => new VideoSample(cover.frame, { timestamp: start + i / OUTPUT_FRAME_RATE, duration: 1 / OUTPUT_FRAME_RATE }),
    )
    return [...covers, later]
  }
}

/**
 * A Mediabunny `audio.process` putting `lead` seconds of silence before the
 * first sample, and every sample (as `process` made it) that much later.
 */
export function withCoverSilence(process: (sample: AudioSample) => AudioSample, lead: number) {
  let first = true
  return (sample: AudioSample): AudioSample | AudioSample[] => {
    const made = process(sample)
    const start = made.timestamp
    made.setTimestamp(start + lead)
    if (!first) return made
    first = false
    const frames = Math.round(lead * made.sampleRate)
    const silence = new AudioSample({
      data: new Float32Array(frames * made.numberOfChannels),
      format: 'f32-planar',
      numberOfChannels: made.numberOfChannels,
      sampleRate: made.sampleRate,
      timestamp: start,
    })
    return [silence, made]
  }
}
