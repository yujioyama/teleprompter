import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useVideoFrameTime } from './useVideoFrameTime'

let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function Player({ onTime }: { onTime: (t: number) => void }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  useVideoFrameTime(video, onTime)
  return <video ref={setVideo} data-testid="v" />
}

function setTime(video: HTMLVideoElement, t: number) {
  Object.defineProperty(video, 'currentTime', { value: t, configurable: true })
}

describe('useVideoFrameTime', () => {
  it('reports the time on every frame while playing', () => {
    const onTime = vi.fn()
    const { getByTestId } = render(<Player onTime={onTime} />)
    const video = getByTestId('v') as HTMLVideoElement

    setTime(video, 0.4)
    fireEvent.play(video)
    expect(onTime).toHaveBeenLastCalledWith(0.4)
    setTime(video, 0.45)
    frames.shift()!(0)
    expect(onTime).toHaveBeenLastCalledWith(0.45)
  })

  it('stops following on pause', () => {
    const onTime = vi.fn()
    const { getByTestId } = render(<Player onTime={onTime} />)
    const video = getByTestId('v') as HTMLVideoElement

    fireEvent.play(video)
    fireEvent.pause(video)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    const calls = onTime.mock.calls.length
    frames.forEach(cb => cb(0))
    expect(onTime.mock.calls.length).toBe(calls)
  })
})
