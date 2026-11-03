import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import OpeningLookCanvas from './OpeningLookCanvas'
import { drawCinemaLook } from '../utils/drawCinemaLook'
import { lookOpacity, openingEnd, type OpeningLook } from '../utils/openingLook'

vi.mock('../utils/drawCinemaLook', () => ({ drawCinemaLook: vi.fn() }))

const OPENING: OpeningLook = { kind: 'letterbox', at: 1.2, height: 0.22, grade: 'oldFilm' }

describe('OpeningLookCanvas', () => {
  const ctx = { drawImage: vi.fn(), clearRect: vi.fn() }
  let frame: (() => void) | null = null
  let video: HTMLVideoElement

  function setTime(t: number) {
    Object.defineProperty(video, 'currentTime', { value: t, configurable: true })
  }

  beforeEach(() => {
    vi.mocked(drawCinemaLook).mockClear()
    ctx.drawImage.mockClear()
    ctx.clearRect.mockClear()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    video = document.createElement('video')
    // The frame callback is run by hand, one frame at a time.
    video.requestVideoFrameCallback = cb => {
      frame = () => cb(0, {} as VideoFrameCallbackMetadata)
      return 1
    }
    video.cancelVideoFrameCallback = () => {
      frame = null
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('draws the video frame, then the look at the frame\'s time and opacity', () => {
    setTime(0.5)
    const { getByTestId } = render(<OpeningLookCanvas video={video} opening={OPENING} />)
    expect(getByTestId('opening-look')).toHaveAttribute('width', '540')
    expect(getByTestId('opening-look')).toHaveAttribute('height', '960')
    video.dispatchEvent(new Event('play'))
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 540, 960)
    expect(drawCinemaLook).toHaveBeenCalledWith(ctx, 'oldFilm', 0.5, 1, 540, 960)

    setTime(1.6)
    frame?.()
    expect(drawCinemaLook).toHaveBeenLastCalledWith(ctx, 'oldFilm', 1.6, lookOpacity(1.6, OPENING), 540, 960)
    expect(lookOpacity(1.6, OPENING)).toBeLessThan(1)
  })

  it('draws nothing, and hides itself, once the opening has ended', () => {
    setTime(0.5)
    const { getByTestId } = render(<OpeningLookCanvas video={video} opening={OPENING} />)
    video.dispatchEvent(new Event('play'))
    expect(getByTestId('opening-look').style.visibility).toBe('visible')
    vi.mocked(drawCinemaLook).mockClear()
    ctx.drawImage.mockClear()

    setTime(openingEnd(OPENING))
    frame?.()
    expect(drawCinemaLook).not.toHaveBeenCalled()
    expect(ctx.drawImage).not.toHaveBeenCalled()
    expect(ctx.clearRect).toHaveBeenCalled()
    expect(getByTestId('opening-look').style.visibility).toBe('hidden')
  })

  it('draws nothing without a film look picked', () => {
    setTime(0.5)
    render(<OpeningLookCanvas video={video} opening={{ ...OPENING, grade: null }} />)
    video.dispatchEvent(new Event('play'))
    expect(drawCinemaLook).not.toHaveBeenCalled()
  })
})
