import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processRecordedVideo, isRemuxableContainer, inferMimeType } from './processRecordedVideo'
import { detectSpeechBounds } from './detectSpeechBounds'
import { remuxMp4 } from './remuxMp4'

vi.mock('./detectSpeechBounds', () => ({ detectSpeechBounds: vi.fn() }))
vi.mock('./remuxMp4', () => ({ remuxMp4: vi.fn() }))

const mockDetect = vi.mocked(detectSpeechBounds)
const mockRemux = vi.mocked(remuxMp4)

function makeBlob(content = 'x') {
  return new Blob([content], { type: 'video/mp4' })
}

beforeEach(() => {
  mockDetect.mockReset()
  mockRemux.mockReset()
})

describe('processRecordedVideo', () => {
  it('passes webm blobs through unchanged without calling detect/remux', async () => {
    const raw = makeBlob()
    const result = await processRecordedVideo(raw, 'video/webm', {
      trimEnabled: true,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: true,
    })
    expect(result).toEqual({ blob: raw, ok: true, error: null })
    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockRemux).not.toHaveBeenCalled()
  })

  it('detects speech bounds and remuxes when trimming is enabled for a remuxable container', async () => {
    const raw = makeBlob()
    const remuxed = makeBlob('remuxed')
    mockDetect.mockResolvedValue({ start: 1, end: 4 })
    mockRemux.mockResolvedValue({ blob: remuxed, ok: true })

    const result = await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: true,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: true,
    })

    expect(mockDetect).toHaveBeenCalledWith(raw, 0.5, 0.8)
    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: { start: 1, end: 4 }, normalize: true })
    expect(result).toEqual({ blob: remuxed, ok: true, error: null })
  })

  it('skips speech detection when trimming is disabled, remuxing without a trim', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: true })

    await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: false,
      trimPaddingStart: 0.5,
      trimPaddingEnd: 0.8,
      normalizeAudio: false,
    })

    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: undefined, normalize: false })
  })

  it('remuxes .mov (quicktime) blobs, falling back to no trim when speech bounds are null', async () => {
    const raw = makeBlob()
    mockDetect.mockResolvedValue(null)
    mockRemux.mockResolvedValue({ blob: raw, ok: true })

    await processRecordedVideo(raw, 'video/quicktime', {
      trimEnabled: true,
      trimPaddingStart: 0.2,
      trimPaddingEnd: 0.2,
      normalizeAudio: true,
    })

    expect(mockRemux).toHaveBeenCalledWith(raw, { trim: undefined, normalize: true })
  })

  it('surfaces a remux failure as ok:false with the error message', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: false, error: 'boom' })

    const result = await processRecordedVideo(raw, 'video/mp4', {
      trimEnabled: false,
      trimPaddingStart: 0,
      trimPaddingEnd: 0,
      normalizeAudio: false,
    })

    expect(result).toEqual({ blob: raw, ok: false, error: 'boom' })
  })
})

describe('isRemuxableContainer', () => {
  it('treats mp4 and quicktime mime types as remuxable', () => {
    expect(isRemuxableContainer('video/mp4')).toBe(true)
    expect(isRemuxableContainer('video/quicktime')).toBe(true)
  })

  it('treats webm as not remuxable', () => {
    expect(isRemuxableContainer('video/webm')).toBe(false)
  })
})

describe('inferMimeType', () => {
  it('uses the File.type when present', () => {
    const file = new File(['x'], 'clip.mov', { type: 'video/quicktime' })
    expect(inferMimeType(file)).toBe('video/quicktime')
  })

  it('falls back to extension sniffing for .mov files with no type', () => {
    const file = new File(['x'], 'clip.mov', { type: '' })
    expect(inferMimeType(file)).toBe('video/quicktime')
  })

  it('falls back to extension sniffing for .mp4 files with no type', () => {
    const file = new File(['x'], 'clip.mp4', { type: '' })
    expect(inferMimeType(file)).toBe('video/mp4')
  })

  it('defaults to webm when neither type nor extension is known', () => {
    const file = new File(['x'], 'clip.xyz', { type: '' })
    expect(inferMimeType(file)).toBe('video/webm')
  })
})
