import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCoverFrames, type CoverChange } from './useCoverFrames'

const VIDEO = new Blob(['video'], { type: 'video/mp4' })
const COVERED = new Blob(['covered'], { type: 'video/mp4' })

function changeOf(run: CoverChange['run'] = vi.fn(async () => COVERED)): CoverChange {
  return { run }
}

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

function render(video: Blob | null, change: CoverChange | null) {
  return renderHook(({ video, change }) => useCoverFrames(video, change), { initialProps: { video, change } })
}

describe('useCoverFrames', () => {
  it('has nothing without a video', () => {
    const { result } = render(null, changeOf())
    expect(result.current).toEqual({ blob: null, url: null, state: 'idle', progress: null })
  })

  it('hands the very same video on with no change to make', () => {
    const { result } = render(VIDEO, null)
    expect(result.current.blob).toBe(VIDEO)
  })

  it('puts the frames in, with nothing to save meanwhile', async () => {
    let done!: (blob: Blob) => void
    const run = vi.fn(() => new Promise<Blob>(r => (done = r)))
    const { result } = render(VIDEO, changeOf(run))
    expect(result.current).toEqual({ blob: null, url: null, state: 'inserting', progress: null })
    await waitFor(() => expect(run).toHaveBeenCalledWith(VIDEO, expect.any(Function)))

    await act(async () => done(COVERED))
    expect(result.current).toEqual({ blob: COVERED, url: 'blob:1', state: 'idle', progress: null })
  })

  it('passes on how far a slow insert is, and why it is slow', async () => {
    let done!: (blob: Blob) => void
    const run: CoverChange['run'] = async (_video, onProgress) => {
      onProgress({ ratio: 0.4, why: 'clip 1 was encoded with different parameters than clip 0' })
      return new Promise(r => (done = r))
    }
    const { result } = render(VIDEO, changeOf(run))
    await waitFor(() =>
      expect(result.current.progress).toEqual({ ratio: 0.4, why: 'clip 1 was encoded with different parameters than clip 0' }),
    )
    expect(result.current.blob).toBeNull()

    await act(async () => done(COVERED))
    expect(result.current).toMatchObject({ blob: COVERED, state: 'idle', progress: null })
  })

  it('still lets the video be saved when the frames cannot go in', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = render(VIDEO, changeOf(async () => Promise.reject(new Error('encode failed'))))
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.blob).toBe(VIDEO)
  })

  it('drops a result the settings have since moved on from', async () => {
    let first!: (blob: Blob) => void
    const run = vi.fn(() => new Promise<Blob>(r => (first = r)))
    const { result, rerender } = render(VIDEO, changeOf(run))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))

    rerender({ video: VIDEO, change: null })
    expect(result.current.blob).toBe(VIDEO)
    await act(async () => first(COVERED))
    expect(result.current.blob).toBe(VIDEO)
  })
})
