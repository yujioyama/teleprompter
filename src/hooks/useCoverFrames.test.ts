import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCoverFrames } from './useCoverFrames'
import { insertCoverFrames, type CoverFramePlacement } from '../utils/coverFrames'

vi.mock('../utils/coverFrames', () => ({ insertCoverFrames: vi.fn() }))

const VIDEO = new Blob(['video'], { type: 'video/mp4' })
const COVERED = new Blob(['covered'], { type: 'video/mp4' })
const IMAGE = new Blob(['png'], { type: 'image/png' })

beforeEach(() => {
  vi.mocked(insertCoverFrames).mockReset().mockResolvedValue(COVERED)
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

function render(video: Blob | null, image: Blob | null, placement: CoverFramePlacement, count = 1) {
  return renderHook(
    ({ video, image, placement, count }) => useCoverFrames(video, image, placement, count),
    { initialProps: { video, image, placement, count } },
  )
}

describe('useCoverFrames', () => {
  it('has nothing without a video', () => {
    const { result } = render(null, IMAGE, 'first')
    expect(result.current).toEqual({ blob: null, url: null, state: 'idle', progress: null })
  })

  it('hands the very same video on for なし, even with an image picked', () => {
    const { result } = render(VIDEO, IMAGE, 'none')
    expect(result.current.blob).toBe(VIDEO)
    expect(insertCoverFrames).not.toHaveBeenCalled()
  })

  it('hands the video on until an image is picked', () => {
    const { result } = render(VIDEO, null, 'first')
    expect(result.current.blob).toBe(VIDEO)
    expect(insertCoverFrames).not.toHaveBeenCalled()
  })

  it('puts the frames in, with nothing to save meanwhile', async () => {
    let done!: (blob: Blob) => void
    vi.mocked(insertCoverFrames).mockReturnValueOnce(new Promise(r => (done = r)))
    const { result } = render(VIDEO, IMAGE, 'last', 3)
    expect(result.current).toEqual({ blob: null, url: null, state: 'inserting', progress: null })
    await waitFor(() => expect(insertCoverFrames).toHaveBeenCalledWith(VIDEO, IMAGE, 'last', 3, expect.any(Function)))

    await act(async () => done(COVERED))
    expect(result.current).toEqual({ blob: COVERED, url: 'blob:1', state: 'idle', progress: null })
  })

  it('passes on how far a slow insert is, and why it is slow', async () => {
    let done!: (blob: Blob) => void
    vi.mocked(insertCoverFrames).mockImplementationOnce(async (_v, _i, _p, _c, onProgress) => {
      onProgress?.({ ratio: 0.4, why: 'clip 1 was encoded with different parameters than clip 0' })
      return new Promise(r => (done = r))
    })
    const { result } = render(VIDEO, IMAGE, 'first')
    await waitFor(() =>
      expect(result.current.progress).toEqual({ ratio: 0.4, why: 'clip 1 was encoded with different parameters than clip 0' }),
    )
    expect(result.current.blob).toBeNull()

    await act(async () => done(COVERED))
    expect(result.current).toMatchObject({ blob: COVERED, state: 'idle', progress: null })
  })

  it('still lets the video be saved when the frames cannot go in', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(insertCoverFrames).mockRejectedValueOnce(new Error('encode failed'))
    const { result } = render(VIDEO, IMAGE, 'first')
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.blob).toBe(VIDEO)
  })

  it('drops a result the settings have since moved on from', async () => {
    let first!: (blob: Blob) => void
    vi.mocked(insertCoverFrames).mockReturnValueOnce(new Promise(r => (first = r)))
    const { result, rerender } = render(VIDEO, IMAGE, 'first')
    await waitFor(() => expect(insertCoverFrames).toHaveBeenCalledTimes(1))

    rerender({ video: VIDEO, image: IMAGE, placement: 'none', count: 1 })
    expect(result.current.blob).toBe(VIDEO)
    await act(async () => first(COVERED))
    expect(result.current.blob).toBe(VIDEO)
  })
})
