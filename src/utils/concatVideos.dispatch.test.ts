import { describe, it, expect, vi, beforeEach } from 'vitest'
import { concatVideos } from './concatVideos'
import { concatClipsWebCodecs } from './webcodecs/concatClips'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { execFFmpeg } from './execFFmpeg'
import { CancelledError } from './cancellation'

vi.mock('./webcodecs/concatClips', () => ({
  concatClipsWebCodecs: vi.fn(),
}))
vi.mock('./ffmpegClient', () => ({
  getFFmpeg: vi.fn(),
  releaseFFmpeg: vi.fn(),
}))
vi.mock('./execFFmpeg', () => ({
  execFFmpeg: vi.fn(async () => undefined),
}))

const fakeFFmpeg = {
  on: vi.fn(),
  off: vi.fn(),
  writeFile: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array(5000)),
  deleteFile: vi.fn(async () => true),
}

const clips = [new Blob(['a']), new Blob(['b'])]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
})

describe('concatVideos', () => {
  it('falls back to ffmpeg when the packet-copy join fails', async () => {
    vi.mocked(concatClipsWebCodecs).mockRejectedValue(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await concatVideos(clips)
    warn.mockRestore()

    expect(getFFmpeg).toHaveBeenCalled()
  })

  it('does not fall back to ffmpeg when cancelled during the packet-copy join (issue #34)', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new CancelledError()
    })

    await expect(concatVideos(clips, controller.signal)).rejects.toBeInstanceOf(CancelledError)
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('passes the signal on to the packet-copy join', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockResolvedValue(new Blob(['joined']))

    await concatVideos(clips, controller.signal)

    expect(concatClipsWebCodecs).toHaveBeenCalledWith(clips, controller.signal)
  })

  it('terminates ffmpeg when cancelled during the ffmpeg join', async () => {
    const controller = new AbortController()
    vi.mocked(concatClipsWebCodecs).mockRejectedValue(new Error('different parameters'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(execFFmpeg).mockImplementationOnce(async () => {
      controller.abort()
      throw 'called FFmpeg.terminate()'
    })

    await expect(concatVideos(clips, controller.signal)).rejects.toBeInstanceOf(CancelledError)
    warn.mockRestore()
    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })
})
