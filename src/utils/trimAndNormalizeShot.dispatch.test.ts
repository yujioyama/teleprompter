import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizedBackendOf, trimAndNormalizeShot, unifyNormalizeBackends } from './trimAndNormalizeShot'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'
import { getFFmpeg, releaseFFmpeg } from './ffmpegClient'
import { execFFmpeg } from './execFFmpeg'
import { CancelledError } from './cancellation'

vi.mock('./webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/normalizeShot', () => ({
  normalizeShotWebCodecs: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
})

describe('trimAndNormalizeShot backend selection', () => {
  const src = new Blob(['src'], { type: 'video/mp4' })

  it('uses WebCodecs when available and tags the result', async () => {
    const out = new Blob(['wc'], { type: 'video/mp4' })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeShotWebCodecs).mockResolvedValue(out)

    const result = await trimAndNormalizeShot(src, 0, 2)

    expect(result).toBe(out)
    expect(normalizedBackendOf(result)).toBe('webcodecs')
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('falls back to ffmpeg and disables WebCodecs when a WebCodecs encode fails', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    const failure = new Error('encoder closed')
    vi.mocked(normalizeShotWebCodecs).mockRejectedValue(failure)

    const result = await trimAndNormalizeShot(src, 0, 2)

    expect(disableWebCodecs).toHaveBeenCalledWith(failure)
    expect(getFFmpeg).toHaveBeenCalled()
    expect(normalizedBackendOf(result)).toBe('ffmpeg')
  })

  it('goes straight to ffmpeg when WebCodecs is unsupported', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)

    const result = await trimAndNormalizeShot(src, 0, 2)

    expect(normalizeShotWebCodecs).not.toHaveBeenCalled()
    expect(normalizedBackendOf(result)).toBe('ffmpeg')
  })

  it('neither falls back to ffmpeg nor disables WebCodecs when cancelled mid-encode (issue #34)', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeShotWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new Error('conversion canceled')
    })

    await expect(trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)).rejects.toBeInstanceOf(CancelledError)

    expect(disableWebCodecs).not.toHaveBeenCalled()
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('passes the signal on to the hardware encode', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(normalizeShotWebCodecs).mockResolvedValue(new Blob(['wc'], { type: 'video/mp4' }))

    await trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)

    expect(vi.mocked(normalizeShotWebCodecs).mock.calls[0][5]).toBe(controller.signal)
  })

  it('does not call releaseFFmpeg when cancelled while ffmpeg was still loading (issue #34)', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    vi.mocked(getFFmpeg).mockImplementation(async () => {
      controller.abort()
      return fakeFFmpeg as never
    })

    await expect(trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)).rejects.toBeInstanceOf(CancelledError)

    expect(releaseFFmpeg).not.toHaveBeenCalled()
  })

  it('terminates ffmpeg when cancelled during an ffmpeg encode', async () => {
    const controller = new AbortController()
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)
    vi.mocked(execFFmpeg).mockImplementationOnce(async () => {
      controller.abort()
      throw 'called FFmpeg.terminate()'
    })

    await expect(trimAndNormalizeShot(src, 0, 2, undefined, controller.signal)).rejects.toBeInstanceOf(CancelledError)

    expect(releaseFFmpeg).toHaveBeenCalledTimes(1)
  })
})

describe('unifyNormalizeBackends', () => {
  const clips = [0, 1, 2].map(i => ({ blob: new Blob([`src${i}`], { type: 'video/mp4' }), start: 0, end: 2 }))

  async function webcodecsClip(): Promise<Blob> {
    vi.mocked(canUseWebCodecs).mockResolvedValueOnce(true)
    vi.mocked(normalizeShotWebCodecs).mockResolvedValueOnce(new Blob(['wc'], { type: 'video/mp4' }))
    return trimAndNormalizeShot(clips[0].blob, 0, 2)
  }

  async function ffmpegClip(): Promise<Blob> {
    vi.mocked(canUseWebCodecs).mockResolvedValueOnce(false)
    return trimAndNormalizeShot(clips[0].blob, 0, 2)
  }

  it('leaves clips from a single backend alone', async () => {
    const normalized = [await webcodecsClip(), await webcodecsClip(), await webcodecsClip()]
    vi.clearAllMocks()

    const result = await unifyNormalizeBackends(clips, normalized)

    expect(result).toEqual(normalized)
    expect(normalizeShotWebCodecs).not.toHaveBeenCalled()
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('re-encodes only the ffmpeg-made clips on the hardware encoder, with progress', async () => {
    const normalized = [await webcodecsClip(), await ffmpegClip(), await ffmpegClip()]
    vi.clearAllMocks()
    vi.mocked(normalizeShotWebCodecs).mockImplementation(async (_blob, _s, _e, onProgress) => {
      onProgress?.(0.5)
      return new Blob(['wc-retry'], { type: 'video/mp4' })
    })
    const progress: number[] = []

    const result = await unifyNormalizeBackends(clips, normalized, r => progress.push(r))

    expect(normalizeShotWebCodecs).toHaveBeenCalledTimes(2)
    expect(vi.mocked(normalizeShotWebCodecs).mock.calls.map(c => c[0])).toEqual([clips[1].blob, clips[2].blob])
    expect(result[0]).toBe(normalized[0])
    expect(result.map(normalizedBackendOf)).toEqual(['webcodecs', 'webcodecs', 'webcodecs'])
    expect(getFFmpeg).not.toHaveBeenCalled()
    expect(progress).toEqual([0.25, 0.5, 0.75, 1])
  })

  it('falls back to re-encoding the hardware clips with ffmpeg when the hardware retry fails', async () => {
    const normalized = [await webcodecsClip(), await ffmpegClip(), await webcodecsClip()]
    vi.clearAllMocks()
    vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
    vi.mocked(normalizeShotWebCodecs).mockRejectedValue(new Error('encoder stalled'))
    const progress: number[] = []

    const result = await unifyNormalizeBackends(clips, normalized, r => progress.push(r))

    expect(result[1]).toBe(normalized[1])
    expect(result.map(normalizedBackendOf)).toEqual(['ffmpeg', 'ffmpeg', 'ffmpeg'])
    expect(vi.mocked(fakeFFmpeg.writeFile).mock.calls.length).toBe(2)
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(1)
  })

  it('does not fall back to ffmpeg when cancelled during the hardware re-encode (issue #34)', async () => {
    const normalized = [await webcodecsClip(), await ffmpegClip(), await webcodecsClip()]
    vi.clearAllMocks()
    const controller = new AbortController()
    vi.mocked(normalizeShotWebCodecs).mockImplementation(async () => {
      controller.abort()
      throw new Error('conversion canceled')
    })

    await expect(unifyNormalizeBackends(clips, normalized, undefined, controller.signal)).rejects.toBeInstanceOf(
      CancelledError,
    )
    expect(getFFmpeg).not.toHaveBeenCalled()
  })
})
