import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MusicMixer from './MusicMixer'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'

vi.mock('../utils/mixMusic')

const VIDEO_BLOB = new Blob(['v'], { type: 'video/mp4' })

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['track'], { type: 'audio/mpeg' })),
  }) as unknown as typeof fetch
  vi.mocked(mixModule.mixMusic).mockResolvedValue(new Blob(['mixed'], { type: 'video/mp4' }))
})

function nextButton() {
  return screen.getByRole('button', { name: /次へ|BGMを合成中/ })
}

describe('MusicMixer', () => {
  it('previews a picked track and volume without mixing the video', async () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.6' } })
    await new Promise(resolve => setTimeout(resolve, 400))

    expect(mixModule.mixMusic).not.toHaveBeenCalled()
    expect(document.querySelectorAll('video')).toHaveLength(1)
  })

  it('holds 次へ until a track is picked', () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} />)
    expect(nextButton()).toBeDisabled()
    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    expect(nextButton()).not.toBeDisabled()
  })

  it('mixes once on 次へ, with the picked track and volume, then moves on', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    const mixed = new Blob(['mixed-once'], { type: 'video/mp4' })
    vi.mocked(mixModule.mixMusic).mockResolvedValueOnce(mixed)
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.4' } })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } })
    fireEvent.click(nextButton())

    await waitFor(() => expect(onNext).toHaveBeenCalled())
    expect(mixModule.mixMusic).toHaveBeenCalledTimes(1)
    const [video, , volume] = vi.mocked(mixModule.mixMusic).mock.calls[0]
    expect(video).toBe(VIDEO_BLOB)
    expect(volume).toBe(0.5)
    expect(onMixed).toHaveBeenCalledWith(mixed)
  })

  it('fetches a track once for both the preview and the mix', async () => {
    // One the other tests don't load, from the genre the picker opens on.
    const track = MUSIC_TRACKS.filter(t => t.genre === MUSIC_TRACKS[0].genre)[1]
    const onNext = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={onNext} />)

    fireEvent.click(screen.getByText(track.title))
    fireEvent.click(nextButton())
    await waitFor(() => expect(onNext).toHaveBeenCalled())

    const trackFetches = vi.mocked(global.fetch).mock.calls.filter(([url]) => url === `/${track.file}`)
    expect(trackFetches.length).toBeLessThanOrEqual(1)
  })

  it('stays on the step with the error when the mix fails', async () => {
    const onNext = vi.fn()
    vi.mocked(mixModule.mixMusic).mockRejectedValueOnce(new Error('boom'))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={onNext} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    fireEvent.click(nextButton())

    expect(await screen.findByText(/合成に失敗しました: boom/)).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
    expect(nextButton()).not.toBeDisabled()
  })

  it('skips BGM entirely and advances immediately via BGMなしで進む', () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText('BGMなしで進む'))
    expect(onMixed).toHaveBeenCalledWith(null)
    expect(onNext).toHaveBeenCalled()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('ignores a mix still running when the user skips, and never re-adds BGM', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    let resolveMix: (blob: Blob) => void = () => {}
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(resolve => (resolveMix = resolve)))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    fireEvent.click(nextButton())
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('BGMなしで進む'))
    resolveMix(new Blob(['late'], { type: 'video/mp4' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(onMixed).toHaveBeenCalledTimes(1)
    expect(onMixed).toHaveBeenCalledWith(null)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('ignores a mix still running when the component unmounts', async () => {
    const onMixed = vi.fn()
    let resolveMix: (blob: Blob) => void = () => {}
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(resolve => (resolveMix = resolve)))
    const { unmount } = render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} />)

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].title))
    fireEvent.click(nextButton())
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1))

    unmount()
    resolveMix(new Blob(['late'], { type: 'video/mp4' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(onMixed).not.toHaveBeenCalled()
  })
})
