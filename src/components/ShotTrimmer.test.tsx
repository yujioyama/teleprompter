import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShotTrimmer from './ShotTrimmer'

function trimmer(url: string, trimStart = 0, nextUrl: string | null = null) {
  return (
    <ShotTrimmer
      url={url}
      nextUrl={nextUrl}
      duration={5}
      trimStart={trimStart}
      trimEnd={5}
      onChange={() => {}}
      onDurationKnown={() => {}}
    />
  )
}

function failWith(video: HTMLVideoElement, code: number, message: string) {
  Object.defineProperty(video, 'error', { value: { code, message }, configurable: true })
  fireEvent.error(video)
}

let loadSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load')
})

afterEach(() => {
  loadSpy.mockRestore()
})

describe('ShotTrimmer', () => {
  it('does not keep a hidden player for the next shot until the transition preview is requested', () => {
    const { container } = render(trimmer('blob:shot', 0, 'blob:next'))
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('seeks to the trim start once metadata loads, so iOS paints a frame instead of a black box', () => {
    const { container } = render(trimmer('blob:shot', 2))
    const video = container.querySelector('video') as HTMLVideoElement
    fireEvent(video, new Event('loadedmetadata'))
    expect(video.currentTime).toBe(2)
  })

  it('seeks slightly past 0 for an untrimmed start, since seeking to the current time paints nothing', () => {
    const { container } = render(trimmer('blob:shot', 0))
    const video = container.querySelector('video') as HTMLVideoElement
    fireEvent(video, new Event('loadedmetadata'))
    expect(video.currentTime).toBeGreaterThan(0)
    expect(video.currentTime).toBeLessThan(0.1)
  })

  it('releases its media player on unmount instead of leaving the decoder to GC', () => {
    const { container, unmount } = render(trimmer('blob:shot'))
    const video = container.querySelector('video') as HTMLVideoElement
    loadSpy.mockClear()

    unmount()
    expect(video.hasAttribute('src')).toBe(false)
    expect(loadSpy).toHaveBeenCalled()
  })

  it('keeps the on-screen player loaded when effects re-run without unmounting it (StrictMode)', () => {
    const { container } = render(<StrictMode>{trimmer('blob:shot')}</StrictMode>)
    expect(container.querySelector('video')!.getAttribute('src')).toBe('blob:shot')
  })

  it('shows the media error and remounts the player on 再読み込み, releasing the old one', () => {
    const { container } = render(trimmer('blob:shot'))
    const video = container.querySelector('video') as HTMLVideoElement
    failWith(video, 4, 'unsupported')

    expect(screen.getByText('この動画を再生できません（code 4: unsupported）')).toBeInTheDocument()

    fireEvent.click(screen.getByText('再読み込み'))
    expect(screen.queryByText(/この動画を再生できません/)).toBeNull()
    expect(container.querySelector('video')).not.toBe(video)
    expect(video.hasAttribute('src')).toBe(false)
  })

  it('clears a previous shot\'s error when switched to another shot', () => {
    const { container, rerender } = render(trimmer('blob:shot-a'))
    failWith(container.querySelector('video') as HTMLVideoElement, 3, 'decode')
    expect(screen.getByText(/この動画を再生できません/)).toBeInTheDocument()

    rerender(trimmer('blob:shot-b'))
    expect(screen.queryByText(/この動画を再生できません/)).toBeNull()
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(container.querySelector('video')!.getAttribute('src')).toBe('blob:shot-b')
  })
})
