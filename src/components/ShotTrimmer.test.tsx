import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ShotTrimmer from './ShotTrimmer'

type IOCallback = (entries: { isIntersecting: boolean }[]) => void
let ioCallback: IOCallback | null = null

function installIntersectionObserver() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IOCallback) {
        ioCallback = cb
      }
      observe() {}
      disconnect() {}
    },
  )
}

function setInView(isIntersecting: boolean) {
  act(() => ioCallback!([{ isIntersecting }]))
}

function renderTrimmer(nextUrl: string | null = null) {
  return render(
    <ShotTrimmer
      url="blob:shot"
      nextUrl={nextUrl}
      duration={5}
      trimStart={0}
      trimEnd={5}
      onChange={() => {}}
      onDurationKnown={() => {}}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  ioCallback = null
})

describe('ShotTrimmer (issue #12: limit live players)', () => {
  it('mounts its <video> only while near the viewport', () => {
    installIntersectionObserver()
    const { container } = renderTrimmer()
    expect(container.querySelector('video')).toBeNull()

    setInView(true)
    expect(container.querySelector('video')).not.toBeNull()

    setInView(false)
    expect(container.querySelector('video')).toBeNull()
  })

  it('does not keep a hidden player for the next shot until the transition preview is requested', () => {
    const { container } = renderTrimmer('blob:next')
    // No IntersectionObserver in jsdom → always in view; only the shot's own player.
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('shows the media error and remounts the player on 再読み込み', () => {
    const { container } = renderTrimmer()
    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'error', { value: { code: 4, message: 'unsupported' }, configurable: true })
    fireEvent.error(video)

    expect(screen.getByText('この動画を再生できません（code 4: unsupported）')).toBeInTheDocument()

    fireEvent.click(screen.getByText('再読み込み'))
    expect(screen.queryByText(/この動画を再生できません/)).toBeNull()
    expect(container.querySelector('video')).not.toBe(video)
  })
})
