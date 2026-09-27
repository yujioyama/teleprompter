import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mixMusic } from './mixMusic'
import { canUseWebCodecs } from './webcodecs/support'
import { mixMusicWebCodecs } from './webcodecs/mixMusicWebCodecs'
import { getFFmpeg } from './ffmpegClient'

vi.mock('./webcodecs/support', () => ({ canUseWebCodecs: vi.fn() }))
vi.mock('./webcodecs/mixMusicWebCodecs', () => ({ mixMusicWebCodecs: vi.fn() }))
vi.mock('./ffmpegClient', () => ({ getFFmpeg: vi.fn() }))
vi.mock('./execFFmpeg', () => ({ execFFmpeg: vi.fn(async () => undefined) }))

const fakeFFmpeg = {
  on: vi.fn((_: string, handler: (arg: { message: string }) => void) => handler({ message: 'Duration: 00:00:05.00' })),
  off: vi.fn(),
  exec: vi.fn(async () => 0),
  writeFile: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  deleteFile: vi.fn(async () => true),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFFmpeg).mockResolvedValue(fakeFFmpeg as never)
})

describe('mixMusic backend selection', () => {
  const video = new Blob(['v'], { type: 'video/mp4' })
  const track = new Blob(['t'], { type: 'audio/mpeg' })

  it('uses the WebCodecs mix when available, without loading ffmpeg', async () => {
    const out = new Blob(['wc'], { type: 'video/mp4' })
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(mixMusicWebCodecs).mockResolvedValue(out)

    await expect(mixMusic(video, track, 0.3)).resolves.toBe(out)
    expect(mixMusicWebCodecs).toHaveBeenCalledWith(video, track, 0.3)
    expect(getFFmpeg).not.toHaveBeenCalled()
  })

  it('falls back to ffmpeg when the WebCodecs mix fails', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(true)
    vi.mocked(mixMusicWebCodecs).mockRejectedValue(new Error('decodeAudioData failed'))

    const out = await mixMusic(video, track, 0.3)
    expect(getFFmpeg).toHaveBeenCalled()
    expect(out.type).toBe('video/mp4')
  })

  it('goes straight to ffmpeg when WebCodecs is unsupported', async () => {
    vi.mocked(canUseWebCodecs).mockResolvedValue(false)

    await mixMusic(video, track, 0.3)
    expect(mixMusicWebCodecs).not.toHaveBeenCalled()
    expect(getFFmpeg).toHaveBeenCalled()
  })
})
