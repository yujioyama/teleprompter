import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadLineImage, ensureLineImages, receiveInboxImages } from './lineImageDownload'
import { listLineImageIds, pruneLineImages, saveLineImage } from './lineImageStore'

vi.mock('./lineImageStore', () => ({
  listLineImageIds: vi.fn(async () => new Set<string>()),
  pruneLineImages: vi.fn(async () => {}),
  saveLineImage: vi.fn(async () => {}),
}))

const URL_A = 'https://x.test/a.jpg'
const URL_B = 'https://x.test/b.jpg'
const image = () => new Response('img', { headers: { 'content-type': 'image/jpeg' } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadLineImage', () => {
  it('takes the image straight from a site that allows it, and keeps it under its URL', async () => {
    const fetchMock = vi.fn(async () => image())
    vi.stubGlobal('fetch', fetchMock)
    await downloadLineImage(URL_A, 'key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(saveLineImage).toHaveBeenCalledWith(expect.objectContaining({ id: URL_A, width: 800, height: 600 }))
  })

  it('goes through our own endpoint, with the key, when the site blocks it', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(image())
    vi.stubGlobal('fetch', fetchMock)
    await downloadLineImage(URL_A, 'key')
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/image?url=${encodeURIComponent(URL_A)}`, { headers: { Authorization: 'Bearer key' } })
    expect(saveLineImage).toHaveBeenCalled()
  })

  it('fails without a key when the site blocks it, saving nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')))
    await expect(downloadLineImage(URL_A, undefined)).rejects.toThrow()
    expect(saveLineImage).not.toHaveBeenCalled()
  })

  it('fails when our endpoint refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(new Response(null, { status: 413 })))
    await expect(downloadLineImage(URL_A, 'key')).rejects.toThrow('413')
  })
})

describe('ensureLineImages', () => {
  it('gets only what this device lacks, and reports what failed without throwing', async () => {
    vi.mocked(listLineImageIds).mockResolvedValueOnce(new Set([URL_A]))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const failed = await ensureLineImages(
      [{ imageId: URL_A, url: URL_A }, { imageId: URL_B, url: URL_B }, { imageId: 'chosen-here' }],
      'key',
    )
    expect(failed).toEqual([URL_B])
    expect(fetch).not.toHaveBeenCalledWith(URL_A, expect.anything())
  })
})

describe('receiveInboxImages', () => {
  it('keeps what scripts and the inbox refer to, and downloads what waits in the inbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => image()))
    await receiveInboxImages(
      [{ images: [{ line: 1, url: URL_B }] }, {}],
      [{ lineImages: [{ en: 'a', imageId: URL_A }] }, {}],
      'key',
    )
    expect(pruneLineImages).toHaveBeenCalledWith(new Set([URL_A, URL_B]))
    expect(saveLineImage).toHaveBeenCalledWith(expect.objectContaining({ id: URL_B }))
  })
})
