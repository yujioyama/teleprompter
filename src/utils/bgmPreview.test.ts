import { describe, it, expect, vi, afterEach } from 'vitest'
import { BgmPreview, bgmFadeGains } from './bgmPreview'

describe('bgmFadeGains', () => {
  it('fades in over the first second and out over the last, like the real mix', () => {
    expect(bgmFadeGains(0, 10)).toEqual({ fadeIn: 0, fadeOut: 1 })
    expect(bgmFadeGains(0.5, 10)).toEqual({ fadeIn: 0.5, fadeOut: 1 })
    expect(bgmFadeGains(5, 10)).toEqual({ fadeIn: 1, fadeOut: 1 })
    expect(bgmFadeGains(9.25, 10)).toEqual({ fadeIn: 1, fadeOut: 0.75 })
    expect(bgmFadeGains(10, 10)).toEqual({ fadeIn: 1, fadeOut: 0 })
  })

  it('never fades out before the video\'s length is known', () => {
    expect(bgmFadeGains(3, NaN).fadeOut).toBe(1)
  })
})

class FakeParam {
  value = 1
  setValueAtTime = vi.fn((value: number) => {
    this.value = value
  })
  linearRampToValueAtTime = vi.fn()
  cancelScheduledValues = vi.fn()
}

class FakeGain {
  gain = new FakeParam()
  connect<T>(next: T): T {
    return next
  }
}

class FakeSource {
  buffer: unknown = null
  loop = false
  start = vi.fn()
  stop = vi.fn()
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeAudioContext {
  static last: FakeAudioContext
  state = 'running'
  currentTime = 10
  destination = {}
  sources: FakeSource[] = []
  constructor() {
    FakeAudioContext.last = this
  }
  createGain() {
    return new FakeGain()
  }
  createBufferSource() {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  decodeAudioData = vi.fn(async () => ({ duration: 2, length: 96000, sampleRate: 48000, numberOfChannels: 2 }))
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

const TRACK = { arrayBuffer: async () => new ArrayBuffer(8) } as Blob

function playingVideo(currentTime: number): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'paused', { value: false, configurable: true })
  Object.defineProperty(video, 'currentTime', { value: currentTime, configurable: true, writable: true })
  return video
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BgmPreview', () => {
  it('starts the track in step with a video that is already playing, looping it', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const preview = new BgmPreview(playingVideo(2.5))
    await preview.setTrack(TRACK)

    const [source] = FakeAudioContext.last.sources
    expect(source.loop).toBe(true)
    // 2.5s into the video is 0.5s into the second pass of a 2s track.
    expect(source.start).toHaveBeenCalledWith(10, 0.5)
  })

  it('stops with the video and starts again from where it resumes', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const video = playingVideo(1)
    const preview = new BgmPreview(video)
    await preview.setTrack(TRACK)
    const [first] = FakeAudioContext.last.sources

    video.dispatchEvent(new Event('pause'))
    expect(first.stop).toHaveBeenCalled()

    video.currentTime = 1.5
    video.dispatchEvent(new Event('playing'))
    expect(FakeAudioContext.last.sources[1].start).toHaveBeenCalledWith(10, 1.5)
    preview.dispose()
  })

  it('changes the volume without restarting the track', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const preview = new BgmPreview(playingVideo(0))
    await preview.setTrack(TRACK)
    preview.setVolume(0.7)

    expect(FakeAudioContext.last.sources).toHaveLength(1)
  })

  it('stays silent, without throwing, where Web Audio is missing', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const preview = new BgmPreview(playingVideo(0))
    preview.unlock()
    await expect(preview.setTrack(TRACK)).resolves.toBeUndefined()
    preview.dispose()
  })
})
