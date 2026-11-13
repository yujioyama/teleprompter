import { describe, it, expect, vi } from 'vitest'
import { coverLeadSeconds, slowMotionTimes, withCoverFrames, withCoverSilence, withSlowMotion } from './coverLead'

// Stand-ins holding what the real samples are made from and their timestamps.
vi.mock('mediabunny', () => {
  class VideoSample {
    constructor(public data: unknown, public init: { timestamp: number; duration: number }) {
      this.timestamp = init.timestamp
      this.duration = init.duration
    }
    timestamp: number
    duration: number
    setTimestamp(t: number) {
      this.timestamp = t
    }
    setDuration(d: number) {
      this.duration = d
    }
    clone() {
      return new VideoSample(this.data, { timestamp: this.timestamp, duration: this.duration })
    }
  }
  class AudioSample {
    constructor(public init: { data: Float32Array; numberOfChannels: number; sampleRate: number; timestamp: number }) {
      this.timestamp = init.timestamp
      this.numberOfChannels = init.numberOfChannels
      this.sampleRate = init.sampleRate
    }
    timestamp: number
    numberOfChannels: number
    sampleRate: number
    setTimestamp(t: number) {
      this.timestamp = t
    }
  }
  return { VideoSample, AudioSample }
})
vi.mock('./support', () => ({ OUTPUT_FRAME_RATE: 30 }))

const { VideoSample, AudioSample } = await import('mediabunny')
const FRAME = { cover: true } as unknown as CanvasImageSource

function videoAt(t: number) {
  return new VideoSample({ frame: t } as unknown as CanvasImageSource, { timestamp: t, duration: 1 / 30 })
}

describe('withCoverFrames', () => {
  it('puts the cover frames before the first frame, and every frame that much later', () => {
    const process = withCoverFrames(undefined, { frame: FRAME, count: 2 })
    const first = process(videoAt(0)) as InstanceType<typeof VideoSample>[]
    expect(first.map(s => [s.timestamp, (s as unknown as { data: unknown }).data])).toEqual([
      [0, FRAME],
      [1 / 30, FRAME],
      [2 / 30, { frame: 0 }],
    ])
    const second = process(videoAt(1 / 30)) as InstanceType<typeof VideoSample>
    expect(second.timestamp).toBeCloseTo(3 / 30)
  })

  it('draws the subtitles at the shot\'s own time, before moving the frame later', () => {
    const seen: number[] = []
    const canvas = { drawn: true } as unknown as OffscreenCanvas
    const process = withCoverFrames(sample => {
      seen.push(sample.timestamp)
      return canvas
    }, { frame: FRAME, count: 1 })
    process(videoAt(0))
    const later = process(videoAt(0.5)) as InstanceType<typeof VideoSample>
    expect(seen).toEqual([0, 0.5])
    expect((later as unknown as { data: unknown }).data).toBe(canvas)
    expect(later.timestamp).toBeCloseTo(0.5 + 1 / 30)
  })
})

describe('withCoverSilence', () => {
  it('puts the cover\'s length of silence before the first sample, and every sample that much later', () => {
    const lead = coverLeadSeconds(1)
    const process = withCoverSilence(sample => {
      sample.setTimestamp(sample.timestamp - 0.02)
      return sample
    }, lead)
    const first = process(new AudioSample({ data: new Float32Array(), format: 'f32-planar', numberOfChannels: 2, sampleRate: 48000, timestamp: 0 })) as InstanceType<typeof AudioSample>[]
    expect(first).toHaveLength(2)
    const [silence, sample] = first as unknown as { timestamp: number; init: { data: Float32Array } }[]
    expect(silence.timestamp).toBeCloseTo(-0.02)
    expect(silence.init.data).toHaveLength(1600 * 2)
    expect(silence.init.data.every(v => v === 0)).toBe(true)
    expect(sample.timestamp).toBeCloseTo(-0.02 + lead)
    const next = process(new AudioSample({ data: new Float32Array(), format: 'f32-planar', numberOfChannels: 2, sampleRate: 48000, timestamp: 1 })) as InstanceType<typeof AudioSample>
    expect(next.timestamp).toBeCloseTo(1 - 0.02 + lead)
  })
})

describe('withSlowMotion', () => {
  const step = 1 / 30
  const at = (i: number) => i * step

  it('holds each frame over the span it now covers, on the 30fps grid', async () => {
    const { VideoSample } = await import('mediabunny')
    const slow = withSlowMotion(undefined, 2.5)
    const frames = [0, 1, 2, 3].flatMap(i => slow(new VideoSample('f' + i as never, { timestamp: at(i), duration: step })))
    const times = frames.map(f => Math.round(f.timestamp * 30))
    // 4 frames at 2.5x make 10 frames, one after another with no gap or repeat.
    expect(times).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(frames.map(f => (f as unknown as { data: string }).data)).toEqual(['f0', 'f0', 'f0', 'f1', 'f1', 'f2', 'f2', 'f2', 'f3', 'f3'])
    expect(frames.every(f => Math.abs(f.duration - step) < 1e-9)).toBe(true)
  })
})

describe('slowMotionTimes', () => {
  it('keeps at least one frame for a source frame narrower than a step', () => {
    expect(slowMotionTimes(0.5, 0.51, 1 / 30)).toHaveLength(1)
  })
})
