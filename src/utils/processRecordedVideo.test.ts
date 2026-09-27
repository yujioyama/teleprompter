import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processRecordedVideo, isRemuxableContainer, inferMimeType } from './processRecordedVideo'
import { remuxMp4 } from './remuxMp4'

vi.mock('./remuxMp4', () => ({ remuxMp4: vi.fn() }))

const mockRemux = vi.mocked(remuxMp4)

function makeBlob(content = 'x') {
  return new Blob([content], { type: 'video/mp4' })
}

beforeEach(() => {
  mockRemux.mockReset()
})

describe('processRecordedVideo', () => {
  it('passes webm blobs through unchanged without remuxing', async () => {
    const raw = makeBlob()
    const result = await processRecordedVideo(raw, 'video/webm', { normalizeAudio: true })
    expect(result).toEqual({ blob: raw, ok: true, error: null })
    expect(mockRemux).not.toHaveBeenCalled()
  })

  it('remuxes the whole take without trimming it', async () => {
    const raw = makeBlob()
    const remuxed = makeBlob('remuxed')
    mockRemux.mockResolvedValue({ blob: remuxed, ok: true })

    const result = await processRecordedVideo(raw, 'video/mp4', { normalizeAudio: true })

    expect(mockRemux).toHaveBeenCalledWith(raw, { normalize: true })
    expect(result).toEqual({ blob: remuxed, ok: true, error: null })
  })

  it('remuxes .mov (quicktime) blobs', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: true })

    await processRecordedVideo(raw, 'video/quicktime', { normalizeAudio: false })

    expect(mockRemux).toHaveBeenCalledWith(raw, { normalize: false })
  })

  it('surfaces a remux failure as ok:false with the error message', async () => {
    const raw = makeBlob()
    mockRemux.mockResolvedValue({ blob: raw, ok: false, error: 'boom' })

    const result = await processRecordedVideo(raw, 'video/mp4', { normalizeAudio: false })

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
