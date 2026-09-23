import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { shareOrDownload } from './shareOrDownload'

function makeBlob(type = 'video/mp4') {
  return new Blob(['fake-video-data'], { type })
}

describe('shareOrDownload', () => {
  let createObjectURLSpy: MockInstance<(obj: Blob | MediaSource) => string>

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error test-only cleanup of a property we stub per test
    delete navigator.canShare
    // @ts-expect-error test-only cleanup of a property we stub per test
    delete navigator.share
  })

  it('shares the file with a .mp4 extension when canShare/share succeed', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true })

    const result = await shareOrDownload(makeBlob('video/mp4'), 'my-shot')

    expect(result).toBe(true)
    expect(shareMock).toHaveBeenCalledTimes(1)
    const [{ files, title }] = shareMock.mock.calls[0]
    expect(title).toBe('my-shot.mp4')
    expect(files[0].name).toBe('my-shot.mp4')
  })

  it('returns false without downloading when the user cancels the share sheet', async () => {
    const abortError = new DOMException('cancelled', 'AbortError')
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(abortError),
      configurable: true,
    })

    const result = await shareOrDownload(makeBlob(), 'my-shot')

    expect(result).toBe(false)
    expect(createObjectURLSpy).not.toHaveBeenCalled()
  })

  it('falls back to a download link with a .webm extension when canShare is unavailable', async () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await shareOrDownload(makeBlob('video/webm'), 'my-shot')

    expect(result).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy).toHaveBeenCalledWith(expect.any(Blob))
  })
})
