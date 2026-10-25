import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const canEncodeVideo = vi.fn()
const outputStart = vi.fn()

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  AudioBufferSink: vi.fn(),
  AudioBufferSource: vi.fn(),
  BufferSource: vi.fn(),
  BufferTarget: vi.fn(),
  Input: vi.fn(),
  Mp4OutputFormat: vi.fn(),
  Output: vi.fn(function (this: { addAudioTrack: () => void; start: () => Promise<void> }) {
    this.addAudioTrack = () => undefined
    this.start = outputStart
  }),
  Quality: vi.fn(),
  canEncodeAudio: vi.fn(async () => true),
  canEncodeVideo,
}))

const never = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('VideoEncoder', class {})
  vi.stubGlobal('VideoDecoder', class {})
  vi.stubGlobal(
    'AudioBuffer',
    class {
      getChannelData() {
        return new Float32Array(1)
      }
    },
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  canEncodeVideo.mockReset().mockResolvedValue(true)
  outputStart.mockReset().mockImplementation(never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('canUseWebCodecs', () => {
  it('gives up on a support check that never finishes, and says why', async () => {
    canEncodeVideo.mockImplementation(never)
    const { canUseWebCodecs, webCodecsDisabledReason, SETUP_TIMEOUT_MS } = await import('./support')

    const check = canUseWebCodecs()
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
    await expect(check).resolves.toBe(false)
    expect(webCodecsDisabledReason()).toMatch(/support check[\s\S]*no progress/)
  })

  it('中断する drops a support check still running, so trying again checks afresh', async () => {
    canEncodeVideo.mockImplementationOnce(never)
    const { canUseWebCodecs } = await import('./support')
    const { forgetUnfinishedSetup } = await import('../cancellation')

    void canUseWebCodecs()
    forgetUnfinishedSetup()
    await expect(canUseWebCodecs()).resolves.toBe(true)
    expect(canEncodeVideo).toHaveBeenCalledTimes(2)
  })

  it('a dropped check giving up later does not turn off WebCodecs found working since', async () => {
    canEncodeVideo.mockImplementationOnce(never)
    const { canUseWebCodecs, webCodecsDisabledReason, SETUP_TIMEOUT_MS } = await import('./support')
    const { forgetUnfinishedSetup } = await import('../cancellation')

    void canUseWebCodecs()
    forgetUnfinishedSetup()
    await expect(canUseWebCodecs()).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
    expect(webCodecsDisabledReason()).toBeNull()
    await expect(canUseWebCodecs()).resolves.toBe(true)
  })
})

describe('aacEncoderDelay', () => {
  it('falls back to no delay when the measurement never finishes', async () => {
    const { aacEncoderDelay, SETUP_TIMEOUT_MS } = await import('./support')

    const delay = aacEncoderDelay()
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
    await expect(delay).resolves.toBe(0)
  })

  it('中断する drops a measurement still running, so trying again measures afresh', async () => {
    const { aacEncoderDelay } = await import('./support')
    const { forgetUnfinishedSetup } = await import('../cancellation')

    void aacEncoderDelay()
    await vi.advanceTimersByTimeAsync(0)
    forgetUnfinishedSetup()
    void aacEncoderDelay()
    await vi.advanceTimersByTimeAsync(0)
    expect(outputStart).toHaveBeenCalledTimes(2)
  })
})
