import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useYoutubeExport } from './useYoutubeExport'
import { mixYoutubeVersion, type YoutubeBgmSwap } from '../utils/youtubeVersion'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/youtubeVersion', () => ({ mixYoutubeVersion: vi.fn() }))

const FINISHED = new Blob(['finished'], { type: 'video/mp4' })
const SWAPPED = new Blob(['swapped'], { type: 'video/mp4' })
const SWAP: YoutubeBgmSwap = {
  source: new Blob(['combined'], { type: 'video/mp4' }),
  video: new Blob(['burned'], { type: 'video/mp4' }),
  key: { trackId: 'lofi-tokyo', volume: 0.3, normalize: true, voice: 'natural', ending: { stopAt: null, soft: false }, lead: 0 },
  track: MUSIC_TRACKS[0],
}

beforeEach(() => {
  vi.mocked(mixYoutubeVersion).mockReset().mockResolvedValue(SWAPPED)
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

function render(finished: Blob | null, swap: YoutubeBgmSwap | null) {
  return renderHook(({ finished, swap }) => useYoutubeExport(finished, swap), { initialProps: { finished, swap } })
}

describe('useYoutubeExport', () => {
  it('has nothing while switched off or the normal version is not ready', () => {
    const { result } = render(null, SWAP)
    expect(result.current).toEqual({ blob: null, url: null, state: 'idle' })
    expect(mixYoutubeVersion).not.toHaveBeenCalled()
  })

  it('is the normal version before its cover frames when there is no BGM to swap', () => {
    const { result } = render(FINISHED, null)
    expect(result.current.blob).toBe(FINISHED)
    expect(mixYoutubeVersion).not.toHaveBeenCalled()
  })

  it('swaps the BGM, with nothing to save meanwhile', async () => {
    let done!: (blob: Blob) => void
    vi.mocked(mixYoutubeVersion).mockReturnValueOnce(new Promise(r => (done = r)))
    const { result } = render(FINISHED, SWAP)
    expect(result.current).toEqual({ blob: null, url: null, state: 'making' })
    expect(mixYoutubeVersion).toHaveBeenCalledWith(SWAP)

    await act(async () => done(SWAPPED))
    expect(result.current).toEqual({ blob: SWAPPED, url: 'blob:1', state: 'idle' })
  })

  it('says so, with nothing to save, when the swap fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(mixYoutubeVersion).mockRejectedValueOnce(new Error('mix failed'))
    const { result } = render(FINISHED, SWAP)
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.blob).toBeNull()
  })

  it('drops a result once switched off', async () => {
    let done!: (blob: Blob) => void
    vi.mocked(mixYoutubeVersion).mockReturnValueOnce(new Promise(r => (done = r)))
    const { result, rerender } = render(FINISHED, SWAP)
    rerender({ finished: null, swap: SWAP })
    await act(async () => done(SWAPPED))
    expect(result.current.blob).toBeNull()
  })
})
