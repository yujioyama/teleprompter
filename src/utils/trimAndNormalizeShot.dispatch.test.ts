import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizedBackendOf, trimAndNormalizeShot } from './trimAndNormalizeShot'
import { canUseWebCodecs, disableWebCodecs } from './webcodecs/support'
import { normalizeShotWebCodecs } from './webcodecs/normalizeShot'
import { getFFmpeg } from './ffmpegClient'

vi.mock('./webcodecs/support', () => ({
  canUseWebCodecs: vi.fn(),
  disableWebCodecs: vi.fn(),
}))
vi.mock('./webcodecs/normalizeShot', () => ({
  normalizeShotWebCodecs: vi.fn(),
}))
vi.mock('./ffmpegClient', () => ({
  getFFmpeg: vi.fn(),
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
})
