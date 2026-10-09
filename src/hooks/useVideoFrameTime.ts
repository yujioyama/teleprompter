import { useEffect, useRef } from 'react'

/**
 * Report `video`'s current time on every displayed frame while it plays
 * (requestVideoFrameCallback, or requestAnimationFrame where missing).
 * `timeupdate` fires only about 4 times a second, too coarse to show the
 * first shot's 0.12 s snap zoom in the preview.
 */
export function useVideoFrameTime(video: HTMLVideoElement | null, onTime: (t: number) => void): void {
  const onTimeRef = useRef(onTime)
  onTimeRef.current = onTime

  useEffect(() => {
    if (!video) return
    const v = video
    const perFrame = typeof v.requestVideoFrameCallback === 'function'
    let handle = 0
    let running = false

    function tick() {
      if (!running) return
      onTimeRef.current(v.currentTime)
      handle = perFrame ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
    }
    function start() {
      if (running) return
      running = true
      tick()
    }
    function stop() {
      if (!running) return
      running = false
      if (perFrame) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }

    v.addEventListener('play', start)
    v.addEventListener('pause', stop)
    v.addEventListener('ended', stop)
    return () => {
      stop()
      v.removeEventListener('play', start)
      v.removeEventListener('pause', stop)
      v.removeEventListener('ended', stop)
    }
  }, [video])
}
