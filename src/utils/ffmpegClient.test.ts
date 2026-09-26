import { describe, it, expect, vi, beforeEach } from 'vitest'

const instances: { load: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = []

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: vi.fn(function (this: (typeof instances)[number]) {
    this.load = vi.fn(async () => true)
    this.terminate = vi.fn()
    instances.push(this)
  }),
}))

beforeEach(() => {
  instances.length = 0
  vi.resetModules()
})

describe('ffmpegClient', () => {
  it('reuses one loaded instance across calls', async () => {
    const { getFFmpeg } = await import('./ffmpegClient')
    const a = await getFFmpeg()
    const b = await getFFmpeg()
    expect(a).toBe(b)
    expect(instances).toHaveLength(1)
  })

  it('releaseFFmpeg terminates the instance so its WASM heap is freed, and the next call starts fresh', async () => {
    const { getFFmpeg, releaseFFmpeg } = await import('./ffmpegClient')
    const first = await getFFmpeg()
    releaseFFmpeg()
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)

    const second = await getFFmpeg()
    expect(second).not.toBe(first)
    expect(instances[1].load).toHaveBeenCalledTimes(1)
  })

  it('releaseFFmpeg is a no-op when nothing was loaded', async () => {
    const { releaseFFmpeg } = await import('./ffmpegClient')
    expect(() => releaseFFmpeg()).not.toThrow()
    expect(instances).toHaveLength(0)
  })
})
