import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MusicTrack } from '../data/musicTracks'
import { useTrackPreview } from './useTrackPreview'

const A: MusicTrack = { id: 'a', title: 'A', genre: 'lofi', credit: '', file: 'music/a.mp3' }
const B: MusicTrack = { id: 'b', title: 'B', genre: 'pop', credit: '', file: 'music/b.mp3' }

class FakeAudio {
  static last: FakeAudio
  static playResult: () => Promise<void> = () => Promise.resolve()
  src = ''
  listeners: Record<string, () => void> = {}
  play = vi.fn(() => FakeAudio.playResult())
  pause = vi.fn()
  addEventListener = (type: string, fn: () => void) => {
    this.listeners[type] = fn
  }
  constructor() {
    FakeAudio.last = this
  }
}

beforeEach(() => {
  FakeAudio.playResult = () => Promise.resolve()
  vi.stubGlobal('Audio', FakeAudio)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTrackPreview', () => {
  it('starts playing the toggled track', () => {
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    expect(result.current.previewingId).toBe('a')
    expect(FakeAudio.last.src).toBe('/music/a.mp3')
    expect(FakeAudio.last.play).toHaveBeenCalledTimes(1)
  })

  it('stops when the same track is toggled again', () => {
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    act(() => result.current.toggle(A))
    expect(result.current.previewingId).toBeNull()
    expect(FakeAudio.last.pause).toHaveBeenCalled()
  })

  it('switches to another track', () => {
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    act(() => result.current.toggle(B))
    expect(result.current.previewingId).toBe('b')
    expect(FakeAudio.last.src).toBe('/music/b.mp3')
  })

  it('stop() pauses and clears', () => {
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    act(() => result.current.stop())
    expect(result.current.previewingId).toBeNull()
    expect(FakeAudio.last.pause).toHaveBeenCalled()
  })

  it('clears when playback ends', () => {
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    act(() => FakeAudio.last.listeners.ended())
    expect(result.current.previewingId).toBeNull()
  })

  it('clears when play() is rejected', async () => {
    FakeAudio.playResult = () => Promise.reject(new Error('NotAllowedError'))
    const { result } = renderHook(() => useTrackPreview())
    await act(async () => result.current.toggle(A))
    expect(result.current.previewingId).toBeNull()
  })

  it('ignores a stale rejection from a track that was replaced', async () => {
    let rejectFirst: (e: Error) => void = () => {}
    FakeAudio.playResult = () => new Promise<void>((_, reject) => (rejectFirst = reject))
    const { result } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    FakeAudio.playResult = () => Promise.resolve()
    act(() => result.current.toggle(B))
    await act(async () => rejectFirst(new Error('AbortError')))
    expect(result.current.previewingId).toBe('b')
  })

  it('pauses on unmount', () => {
    const { result, unmount } = renderHook(() => useTrackPreview())
    act(() => result.current.toggle(A))
    unmount()
    expect(FakeAudio.last.pause).toHaveBeenCalled()
  })
})
