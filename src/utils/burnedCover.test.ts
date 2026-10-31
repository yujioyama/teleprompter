import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sameBytes, swapBurnedCover } from './burnedCover'
import { insertCoverFrames } from './coverFrames'
import { joinVideoAndAudio, reLeadAudio } from './webcodecs/finalAudio'

vi.mock('./coverFrames', () => ({
  clampCoverFrameCount: (count: number) => Math.min(5, Math.max(1, Math.round(count))),
  insertCoverFrames: vi.fn(),
}))
vi.mock('./webcodecs/finalAudio', () => ({ joinVideoAndAudio: vi.fn(), reLeadAudio: vi.fn() }))
vi.mock('./webcodecs/support', () => ({ OUTPUT_FRAME_RATE: 30 }))

const FINISHED = new Blob(['finished'], { type: 'video/mp4' })
const WAS = { image: new Blob(['cover-a']), count: 1 }
const REBURNED = new Blob(['reburned'], { type: 'video/mp4' })
const JOINED = new Blob(['joined'], { type: 'video/mp4' })
const RELEADED = new Blob(['re-leaded'], { type: 'audio/mp4' })
const LAST = new Blob(['with the last frames'], { type: 'video/mp4' })

let reburn: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  reburn = vi.fn(async (cover?: unknown) => ({ blob: REBURNED, cover: cover !== undefined }))
  vi.mocked(joinVideoAndAudio).mockResolvedValue(JOINED)
  vi.mocked(reLeadAudio).mockResolvedValue(RELEADED)
  vi.mocked(insertCoverFrames).mockResolvedValue(LAST)
})

describe('sameBytes', () => {
  it('compares what the blobs hold', async () => {
    expect(await sameBytes(new Blob(['abc']), new Blob(['abc']))).toBe(true)
    expect(await sameBytes(new Blob(['abc']), new Blob(['abd']))).toBe(false)
    expect(await sameBytes(new Blob(['abc']), new Blob(['ab']))).toBe(false)
  })
})

describe('swapBurnedCover', () => {
  it('is the finished video when the cover drawn again is the same one', async () => {
    const out = await swapBurnedCover(FINISHED, WAS, { image: new Blob(['cover-a']), placement: 'first', count: 1 }, reburn)
    expect(out).toBe(FINISHED)
    expect(reburn).not.toHaveBeenCalled()
  })

  it('burns the first shot again with a changed cover and joins the finished audio back on as it is', async () => {
    const image = new Blob(['cover-b'])
    const out = await swapBurnedCover(FINISHED, WAS, { image, placement: 'first', count: 1 }, reburn)
    expect(reburn).toHaveBeenCalledWith({ image, count: 1 })
    expect(reLeadAudio).not.toHaveBeenCalled()
    expect(joinVideoAndAudio).toHaveBeenCalledWith(REBURNED, FINISHED)
    expect(out).toBe(JOINED)
  })

  it('changes the silence ahead of the audio when the frames change in number', async () => {
    await swapBurnedCover(FINISHED, WAS, { image: WAS.image, placement: 'first', count: 3 }, reburn)
    expect(reLeadAudio).toHaveBeenCalledWith(FINISHED, 1 / 30, 3 / 30)
    expect(joinVideoAndAudio).toHaveBeenCalledWith(REBURNED, RELEADED)
  })

  it('takes the cover out for なし', async () => {
    const out = await swapBurnedCover(FINISHED, WAS, { image: WAS.image, placement: 'none', count: 1 }, reburn)
    expect(reburn).toHaveBeenCalledWith(undefined)
    expect(reLeadAudio).toHaveBeenCalledWith(FINISHED, 1 / 30, 0)
    expect(out).toBe(JOINED)
  })

  it('takes it out of the start and puts it in at the end for 最後', async () => {
    const out = await swapBurnedCover(FINISHED, WAS, { image: WAS.image, placement: 'last', count: 2 }, reburn)
    expect(reburn).toHaveBeenCalledWith(undefined)
    expect(insertCoverFrames).toHaveBeenCalledWith(JOINED, WAS.image, 'last', 2, undefined)
    expect(out).toBe(LAST)
  })

  it('fails rather than leave the video without the cover when the burn could not put it in', async () => {
    reburn.mockResolvedValueOnce({ blob: REBURNED, cover: false })
    await expect(
      swapBurnedCover(FINISHED, WAS, { image: new Blob(['cover-b']), placement: 'first', count: 1 }, reburn),
    ).rejects.toThrow()
  })
})
