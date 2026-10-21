import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useExport } from './useExport'
import { finishAudio } from '../utils/normalizeLoudness'
import type { AudioFinish } from '../utils/audioFinish'

vi.mock('../utils/normalizeLoudness', () => ({ finishAudio: vi.fn() }))

const FINAL = new Blob(['final'], { type: 'video/mp4' })
const FINISHED = new Blob(['finished'], { type: 'video/mp4' })
const LOUDNESS: AudioFinish = { voice: 'none', normalize: true }
const NO_FINISH: AudioFinish = { voice: 'none', normalize: false }

beforeEach(() => {
  vi.mocked(finishAudio).mockReset().mockResolvedValue(FINISHED)
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

function render(blob: Blob | null, finish: AudioFinish) {
  return renderHook(({ blob, finish }) => useExport(blob, finish), { initialProps: { blob, finish } })
}

describe('useExport', () => {
  it('has nothing to export off the export step', () => {
    const { result } = render(null, LOUDNESS)
    expect(result.current).toEqual({ blob: null, url: null, loudness: 'idle' })
    expect(finishAudio).not.toHaveBeenCalled()
  })

  it('exports the final video as it is when there is nothing to finish', () => {
    const { result } = render(FINAL, NO_FINISH)
    expect(result.current).toEqual({ blob: FINAL, url: 'blob:1', loudness: 'idle' })
    expect(finishAudio).not.toHaveBeenCalled()
  })

  it('finishes the audio first, with nothing to save meanwhile', async () => {
    let done!: (blob: Blob) => void
    vi.mocked(finishAudio).mockReturnValueOnce(new Promise(r => (done = r)))
    const { result } = render(FINAL, LOUDNESS)
    expect(result.current).toEqual({ blob: null, url: null, loudness: 'normalizing' })
    expect(finishAudio).toHaveBeenCalledWith(FINAL, LOUDNESS)

    await act(async () => done(FINISHED))
    expect(result.current).toEqual({ blob: FINISHED, url: 'blob:1', loudness: 'idle' })
  })

  it('still lets the video be saved when finishing the audio fails', async () => {
    vi.mocked(finishAudio).mockRejectedValueOnce(new Error('decode failed'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = render(FINAL, LOUDNESS)
    await waitFor(() => expect(result.current.loudness).toBe('failed'))
    expect(result.current.blob).toBe(FINAL)
  })

  it('drops a finish that was overtaken by a newer one', async () => {
    let first!: (blob: Blob) => void
    vi.mocked(finishAudio).mockReturnValueOnce(new Promise(r => (first = r)))
    const { result, rerender } = render(FINAL, LOUDNESS)
    rerender({ blob: FINAL, finish: NO_FINISH })
    await act(async () => first(FINISHED))
    expect(result.current.blob).toBe(FINAL)
  })

  it('does not finish again for an equal finish passed as a new object', () => {
    const { rerender } = render(FINAL, LOUDNESS)
    rerender({ blob: FINAL, finish: { ...LOUDNESS } })
    expect(finishAudio).toHaveBeenCalledTimes(1)
  })

  it('frees the preview URL once the step is left', async () => {
    const { result, rerender } = render(FINAL, NO_FINISH)
    expect(result.current.url).toBe('blob:1')
    rerender({ blob: null, finish: NO_FINISH })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    expect(result.current.url).toBeNull()
  })
})
