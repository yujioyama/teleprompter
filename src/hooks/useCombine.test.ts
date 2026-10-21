import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { combineReducer, useCombine, type CombineStatus } from './useCombine'
import { encodeAll } from '../utils/shotEncoding'
import { unifyNormalizeBackends } from '../utils/trimAndNormalizeShot'
import { concatVideos } from '../utils/concatVideos'
import type { ShotEncodeCache } from '../utils/shotEncodeCache'
import type { ShotClip } from '../utils/shotEncoding'

vi.mock('../utils/shotEncoding', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/shotEncoding')>()),
  encodeAll: vi.fn(),
}))
vi.mock('../utils/trimAndNormalizeShot', () => ({ unifyNormalizeBackends: vi.fn() }))
vi.mock('../utils/concatVideos', () => ({ concatVideos: vi.fn() }))

const CACHE = {} as ShotEncodeCache
const CLIPS: ShotClip[] = [{ shotId: 's1', blob: new Blob(['a']), start: 0, end: 2 }]
const JOINED = new Blob(['joined'], { type: 'video/mp4' })

beforeEach(() => {
  vi.mocked(encodeAll).mockResolvedValue([new Blob(['e'])])
  vi.mocked(unifyNormalizeBackends).mockImplementation(async (_clips, encoded) => encoded)
  vi.mocked(concatVideos).mockResolvedValue(JOINED)
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
  URL.revokeObjectURL = vi.fn()
})

describe('combineReducer', () => {
  const combining: CombineStatus = { state: 'combining', phase: 'encoding', progress: 0.4 }

  it('keeps the progress when only the phase moves on', () => {
    expect(combineReducer(combining, { type: 'progress', phase: 'joining' })).toEqual({
      state: 'combining',
      phase: 'joining',
      progress: 0.4,
    })
  })

  it('ignores progress once the run is over', () => {
    const failed: CombineStatus = { state: 'error', error: 'boom' }
    expect(combineReducer(failed, { type: 'progress', phase: 'encoding', progress: 0.9 })).toBe(failed)
  })

  it('starts every run from the beginning', () => {
    expect(combineReducer({ state: 'cancelled' }, { type: 'start' })).toEqual({
      state: 'combining',
      phase: 'encoding',
      progress: 0,
    })
  })
})

describe('useCombine', () => {
  it('reports each phase while it runs and resolves with the joined video', async () => {
    let finishEncode!: (blobs: Blob[]) => void
    vi.mocked(encodeAll).mockImplementationOnce((_cache, _requests, onProgress) => {
      onProgress?.(0.5)
      return new Promise(r => (finishEncode = r))
    })
    const { result } = renderHook(() => useCombine())

    let joined: Promise<Blob | null>
    act(() => {
      joined = result.current.combine(CACHE, CLIPS)
    })
    expect(result.current.status).toEqual({ state: 'combining', phase: 'encoding', progress: 0.5 })

    await act(async () => {
      finishEncode([new Blob(['e'])])
      expect(await joined).toBe(JOINED)
    })
    // Not done until the page shows it.
    expect(result.current.status).toEqual({ state: 'combining', phase: 'joining', progress: 0.5 })
  })

  it('shows a result with its own URL, revoking the one before', () => {
    const { result } = renderHook(() => useCombine())
    act(() => result.current.show({ blob: JOINED, clips: CLIPS, cueInputs: [], trim: null }))
    expect(result.current.status).toEqual({ state: 'done' })
    expect(result.current.combined?.url).toBe('blob:1')

    act(() => result.current.show({ blob: JOINED, clips: CLIPS, cueInputs: [], trim: null }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    expect(result.current.combined?.url).toBe('blob:2')
  })

  it('says why a run failed, and keeps the previous result', async () => {
    vi.mocked(concatVideos).mockRejectedValueOnce(new Error('out of memory'))
    const { result } = renderHook(() => useCombine())
    act(() => result.current.show({ blob: JOINED, clips: CLIPS, cueInputs: [], trim: null }))

    await act(async () => {
      expect(await result.current.combine(CACHE, CLIPS)).toBeNull()
    })
    expect(result.current.status).toEqual({ state: 'error', error: 'out of memory' })
    expect(result.current.combined?.blob).toBe(JOINED)
  })

  it('is cancelled even while an encode never settles', async () => {
    vi.mocked(encodeAll).mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => useCombine())

    let joined: Promise<Blob | null>
    act(() => {
      joined = result.current.combine(CACHE, CLIPS)
    })
    await act(async () => {
      result.current.cancel()
      expect(await joined).toBeNull()
    })
    expect(result.current.status).toEqual({ state: 'cancelled' })
  })

  it('stops a run and frees its URL when the page goes away', () => {
    let signal: AbortSignal | undefined
    vi.mocked(encodeAll).mockImplementationOnce((_cache, _requests, _onProgress, s) => {
      signal = s
      return new Promise(() => {})
    })
    const { result, unmount } = renderHook(() => useCombine())
    act(() => result.current.show({ blob: JOINED, clips: CLIPS, cueInputs: [], trim: null }))
    act(() => {
      void result.current.combine(CACHE, CLIPS)
    })

    unmount()
    expect(signal?.aborted).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
  })
})
