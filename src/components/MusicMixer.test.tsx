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
})
