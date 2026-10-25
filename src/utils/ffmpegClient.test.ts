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

  it('drops a failed load so the next call tries again instead of failing forever', async () => {
    const { getFFmpeg } = await import('./ffmpegClient')
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    vi.mocked(FFmpeg).mockImplementationOnce(function (this: (typeof instances)[number]) {
      this.load = vi.fn(async () => {
        throw new Error('Aborted(CompileError)')
      })
      this.terminate = vi.fn()
      instances.push(this)
    } as never)

    await expect(getFFmpeg()).rejects.toThrow('Aborted(CompileError)')
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)

    await expect(getFFmpeg()).resolves.toBe(instances[1])
  })

  it('gives up on a load that never finishes, so the next call starts a fresh one', async () => {
    vi.useFakeTimers()
    try {
      const { getFFmpeg, FFMPEG_LOAD_TIMEOUT_MS } = await import('./ffmpegClient')
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      vi.mocked(FFmpeg).mockImplementationOnce(function (this: (typeof instances)[number]) {
        this.load = vi.fn(() => new Promise(() => {}))
        this.terminate = vi.fn()
        instances.push(this)
      } as never)

      const hung = expect(getFFmpeg()).rejects.toThrow(/no progress/)
      await vi.advanceTimersByTimeAsync(FFMPEG_LOAD_TIMEOUT_MS)
      await hung
      expect(instances[0].terminate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }

    const { getFFmpeg } = await import('./ffmpegClient')
    await expect(getFFmpeg()).resolves.toBe(instances[1])
  })

  it('中断する drops a load still running, so trying again does not wait on it', async () => {
    const { getFFmpeg } = await import('./ffmpegClient')
    const { forgetUnfinishedSetup } = await import('./cancellation')
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    vi.mocked(FFmpeg).mockImplementationOnce(function (this: (typeof instances)[number]) {
      this.load = vi.fn(() => new Promise(() => {}))
      this.terminate = vi.fn()
      instances.push(this)
    } as never)

    void getFFmpeg()
    await Promise.resolve()
    forgetUnfinishedSetup()
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)

    await expect(getFFmpeg()).resolves.toBe(instances[1])
  })

  it('says why WebCodecs was given up when the fallback cannot load either', async () => {
    const { getFFmpeg } = await import('./ffmpegClient')
    const { disableWebCodecs } = await import('./webcodecs/support')
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    vi.mocked(FFmpeg).mockImplementationOnce(function (this: (typeof instances)[number]) {
      this.load = vi.fn(async () => {
        throw new Error('Aborted(CompileError)')
      })
      this.terminate = vi.fn()
      instances.push(this)
    } as never)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    disableWebCodecs(new Error('EncodingError: encoder reclaimed'))

    await expect(getFFmpeg()).rejects.toThrow(/Aborted\(CompileError\)[\s\S]*EncodingError: encoder reclaimed/)
  })
})
