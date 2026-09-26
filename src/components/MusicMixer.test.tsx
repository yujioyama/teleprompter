import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MusicMixer from './MusicMixer'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/mixMusic')

const VIDEO_BLOB = new Blob(['v'], { type: 'video/mp4' })

// Real timers throughout (not vi.useFakeTimers): the component's debounce is
// a real setTimeout racing against testing-library's own waitFor polling,
// which also relies on real timers — mixing fake timers in here would
// require manually driving both clocks in lockstep. 300ms of real wall-clock
// wait per assertion below is cheap enough to just let happen.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
})

describe('MusicMixer auto-mix', () => {
  it('mixes automatically (debounced) once a track is selected, and reports the result', async () => {
    const onMixed = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })
    await waitFor(() => expect(onMixed).toHaveBeenCalledWith(expect.any(Blob)))
  })

  it('only mixes once after several rapid volume changes (debounce)', async () => {
    const onMixed = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.change(slider, { target: { value: '0.5' } })
    fireEvent.change(slider, { target: { value: '0.6' } })
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(2), { timeout: 1000 })
  })

  it('skips BGM entirely and advances immediately via BGMなしで進む', () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText('BGMなしで進む'))
    expect(onMixed).toHaveBeenCalledWith(null)
    expect(onNext).toHaveBeenCalled()
  })

  it('does not render a 合成する or 保存する button', () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} />)
    expect(screen.queryByText('BGMを合成する')).not.toBeInTheDocument()
    expect(screen.queryByText('保存する')).not.toBeInTheDocument()
  })

  it('applies only the newer result when a second mix is triggered before the first resolves', async () => {
    // Other tests in this file leave call history on the shared mock (there's
    // no vi.clearAllMocks() in beforeEach, by design — see the file-level
    // comment), so start this test's call-count assertions from zero.
    vi.mocked(mixModule.mixMusic).mockClear()
    const onMixed = vi.fn()
    let resolveFirst: (blob: Blob) => void = () => {}
    const firstPromise = new Promise<Blob>(resolve => {
      resolveFirst = resolve
    })
    const firstResultBlob = new Blob(['first'], { type: 'video/mp4' })
    const secondResultBlob = new Blob(['second'], { type: 'video/mp4' })
    vi.mocked(mixModule.mixMusic)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => Promise.resolve(secondResultBlob))

    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })

    // Trigger a second mix (volume change) before the first has resolved.
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.7' } })
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(2), { timeout: 1000 })

    // The second (newer) mix resolves immediately.
    await waitFor(() => expect(onMixed).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(onMixed).toHaveBeenCalledWith(secondResultBlob)

    // Now let the stale first mix resolve — its result must be discarded,
    // not applied on top of (or instead of) the newer one.
    resolveFirst(firstResultBlob)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(onMixed).toHaveBeenCalledTimes(1)
  })

  it('ignores an in-flight mix result after skipping, and never re-adds BGM once skipped', async () => {
    vi.mocked(mixModule.mixMusic).mockClear()
    const onMixed = vi.fn()
    const onNext = vi.fn()
    let resolveMix: (blob: Blob) => void = () => {}
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(
      () =>
        new Promise<Blob>(resolve => {
          resolveMix = resolve
        })
    )

    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1), { timeout: 1000 })

    fireEvent.click(screen.getByText('BGMなしで進む'))
    expect(onMixed).toHaveBeenCalledWith(null)
    expect(onNext).toHaveBeenCalled()

    // The mix that was in flight during skip resolves afterward.
    resolveMix(new Blob(['late'], { type: 'video/mp4' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    // onMixed must never have been called with an actual mix result — only
    // ever with null, from the skip itself.
    expect(onMixed).toHaveBeenCalledTimes(1)
    expect(onMixed).toHaveBeenCalledWith(null)
  })
})
