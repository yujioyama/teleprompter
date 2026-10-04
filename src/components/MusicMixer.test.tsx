import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MusicMixer from './MusicMixer'
import * as mixModule from '../utils/mixMusic'
import { MUSIC_TRACKS } from '../data/musicTracks'
import { BgmPreview } from '../utils/bgmPreview'

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

  it('opens with the usual BGM and volume already picked', () => {
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId="lofi-tokyo" initialVolume={0.45} />,
    )
    expect(screen.getByRole('combobox', { name: 'ジャンル' })).toHaveValue('lofi')
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(screen.getByRole('slider')).toHaveValue('0.45')
    expect(nextButton()).not.toBeDisabled()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('mixes the usual BGM on arrival when autoMix is on, then moves on', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    const mixed = new Blob(['auto-mixed'], { type: 'video/mp4' })
    vi.mocked(mixModule.mixMusic).mockResolvedValueOnce(mixed)
    render(
      <MusicMixer
        videoBlob={VIDEO_BLOB}
        onMixed={onMixed}
        onNext={onNext}
        initialTrackId="lofi-tokyo"
        initialVolume={0.45}
        autoMix
      />,
    )

    expect(screen.getByText('いつものBGM（Tokyo Lofi）を合成中…')).toBeInTheDocument()
    expect(screen.queryByText('BGMなしで進む')).not.toBeInTheDocument()
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
    const [video, , volume] = vi.mocked(mixModule.mixMusic).mock.calls[0]
    expect(video).toBe(VIDEO_BLOB)
    expect(volume).toBe(0.45)
    expect(onMixed).toHaveBeenCalledWith(mixed)
  })

  it('drops the auto mix and shows the picker on 別のBGMを選ぶ', async () => {
    const onMixed = vi.fn()
    const onNext = vi.fn()
    let resolveMix: (blob: Blob) => void = () => {}
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(resolve => (resolveMix = resolve)))
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={onNext} initialTrackId="lofi-tokyo" autoMix />,
    )
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('別のBGMを選ぶ'))
    resolveMix(new Blob(['late'], { type: 'video/mp4' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(screen.getByText('Tokyo Lofi').closest('div')?.className).toMatch(/trackRowSelected/)
    expect(onMixed).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows the picker with the error when the auto mix fails', async () => {
    const onNext = vi.fn()
    vi.mocked(mixModule.mixMusic).mockRejectedValueOnce(new Error('boom'))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={onNext} initialTrackId="lofi-tokyo" autoMix />)

    expect(await screen.findByText(/「Tokyo Lofi」の合成に失敗しました: boom/)).toBeInTheDocument()
    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('does nothing automatically when autoMix has no usual BGM', () => {
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId={null} autoMix />)
    expect(screen.getByText('BGMなしで進む')).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('mixes through the given mix function when there is one', async () => {
    const onMixed = vi.fn()
    const joined = new Blob(['joined'], { type: 'video/mp4' })
    const mix = vi.fn(async () => joined)
    render(
      <MusicMixer videoBlob={VIDEO_BLOB} onMixed={onMixed} onNext={vi.fn()} initialTrackId="lofi-tokyo" mix={mix} />,
    )
    fireEvent.click(nextButton())

    await waitFor(() => expect(onMixed).toHaveBeenCalledWith(joined))
    const [track, trackBlob, volume] = mix.mock.calls[0] as unknown as [{ id: string }, Blob, number]
    expect(track.id).toBe('lofi-tokyo')
    expect(trackBlob).toBeInstanceOf(Blob)
    expect(volume).toBe(0.3)
    expect(mixModule.mixMusic).not.toHaveBeenCalled()
  })

  it('unlocks the preview audio on any tap in the step, e.g. the video controls', () => {
    const unlock = vi.spyOn(BgmPreview.prototype, 'unlock')
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId="lofi-tokyo" />)

    fireEvent.pointerDown(document.querySelector('video')!)
    expect(unlock).toHaveBeenCalled()
  })

  it('unlocks the preview audio on 別のBGMを選ぶ', async () => {
    const unlock = vi.spyOn(BgmPreview.prototype, 'unlock')
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(() => {}))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId="lofi-tokyo" autoMix />)

    fireEvent.click(screen.getByText('別のBGMを選ぶ'))
    expect(unlock).toHaveBeenCalled()
  })

  it('loads the preview track only once the picker shows, not while auto-mixing', async () => {
    const setTrack = vi.spyOn(BgmPreview.prototype, 'setTrack')
    vi.mocked(mixModule.mixMusic).mockImplementationOnce(() => new Promise<Blob>(() => {}))
    render(<MusicMixer videoBlob={VIDEO_BLOB} onMixed={vi.fn()} onNext={vi.fn()} initialTrackId="lofi-tokyo" autoMix />)
    await waitFor(() => expect(mixModule.mixMusic).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(setTrack.mock.calls.filter(([arg]) => arg instanceof Blob)).toHaveLength(0)

    fireEvent.click(screen.getByText('別のBGMを選ぶ'))
    await waitFor(() => expect(setTrack.mock.calls.some(([arg]) => arg instanceof Blob)).toBe(true))
  })
})
