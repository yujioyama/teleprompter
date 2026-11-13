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

/**
 * A Mediabunny `video.process` playing the picture `stretch` times slower:
 * each frame (as `process` made it) is held over the stretched span it now
 * covers, as frames at the output rate. For the 相手のセリフ clip, a still
 * listening face, where a held frame isn't seen as one.
 */
export function withSlowMotion(process: VideoProcess | undefined, stretch: number) {
  const step = 1 / OUTPUT_FRAME_RATE
  return (sample: VideoSample): VideoSample[] => {
    const from = sample.timestamp * stretch
    const to = (sample.timestamp + sample.duration) * stretch
    const made = process ? process(sample) : sample
    const frame =
      made instanceof VideoSample ? made : new VideoSample(made, { timestamp: from, duration: step })
    const times = slowMotionTimes(from, to, step)
    return times.map((at, i) => {
      const copy = i === 0 ? frame : frame.clone()
      copy.setTimestamp(at)
      copy.setDuration(step)
      return copy
    })
  }
}

/**
 * The output frame times in [from, to), on the output rate's grid, so the
 * frames of neighbouring source frames neither overlap nor leave gaps; at
 * least one, at `from`.
 */
export function slowMotionTimes(from: number, to: number, step: number): number[] {
  // "+ 0" turns a -0 (from 0) into 0.
  const first = Math.ceil(from / step - 1e-6) + 0
  const last = Math.ceil(to / step - 1e-6)
  const times: number[] = []
  for (let i = first; i < last; i++) times.push(i * step)
  return times.length > 0 ? times : [from]
}
