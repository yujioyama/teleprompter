import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CueCheckPlayer from './CueCheckPlayer'

function setTime(video: HTMLVideoElement, t: number) {
  Object.defineProperty(video, 'currentTime', { value: t, configurable: true, writable: true })
}

describe('CueCheckPlayer', () => {
  let play: ReturnType<typeof vi.spyOn>
  let pause: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  })

  afterEach(() => {
    play.mockRestore()
    pause.mockRestore()
  })

  const renderPlayer = (at: number, replay = 1) =>
    render(
      <CueCheckPlayer
        src="blob:video"
        at={at}
        replay={replay}
        label="2行目の切り替わり"
        renderOverlay={t => <span>overlay at {t.toFixed(1)}</span>}
      />,
    )

  it('plays from 1.5s before the switch once the video can seek there', () => {
    renderPlayer(3)
    const video = screen.getByLabelText('2行目の切り替わり') as HTMLVideoElement
    expect(play).toHaveBeenCalledTimes(1)

    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBeCloseTo(1.5)
  })

  it('starts at the beginning for a switch in the first 1.5s', () => {
    renderPlayer(1)
    const video = screen.getByLabelText('2行目の切り替わり') as HTMLVideoElement
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(0)
  })

  it('stops 1s after the switch', () => {
    renderPlayer(3)
    const video = screen.getByLabelText('2行目の切り替わり') as HTMLVideoElement
    fireEvent.loadedMetadata(video)
    pause.mockClear()

    setTime(video, 3.5)
    fireEvent.timeUpdate(video)
    expect(pause).not.toHaveBeenCalled()

    setTime(video, 4.05)
    fireEvent.timeUpdate(video)
    expect(pause).toHaveBeenCalled()
  })

  it('plays the switch again, from its new place, on each replay', () => {
    const { rerender } = renderPlayer(3)
    const video = screen.getByLabelText('2行目の切り替わり') as HTMLVideoElement
    fireEvent.loadedMetadata(video)
    Object.defineProperty(video, 'readyState', { value: 1, configurable: true })

    rerender(
      <CueCheckPlayer src="blob:video" at={3.1} replay={2} label="2行目の切り替わり" renderOverlay={() => null} />,
    )
    expect(play).toHaveBeenCalledTimes(2)
    expect(video.currentTime).toBeCloseTo(1.6)
  })

  it('draws the subtitles at the time being played', () => {
    renderPlayer(3)
    const video = screen.getByLabelText('2行目の切り替わり') as HTMLVideoElement
    setTime(video, 2.4)
    fireEvent.timeUpdate(video)
    expect(screen.getByText('overlay at 2.4')).toBeInTheDocument()
  })
})
