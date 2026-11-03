import { useCallback, useRef } from 'react'
import { drawCinemaLook } from '../utils/drawCinemaLook'
import { lookOpacity, openingActive, type OpeningLook } from '../utils/openingLook'
import { useVideoFrameTime } from '../hooks/useVideoFrameTime'
import styles from './OpeningLookCanvas.module.css'

/** The size the look is graded at, which is also what the burn grades at. */
const WIDTH = 540
const HEIGHT = 960

/**
 * The picked film look over the preview video, while the opening is on
 * (2026-11-03). A <video> can't be graded, so each frame is copied onto this
 * canvas and drawn through the same code the burn uses, which is what makes
 * the preview show what will be burned. Outside the opening it draws nothing
 * and hides, so the video shows as shot.
 */
export default function OpeningLookCanvas({ video, opening }: { video: HTMLVideoElement | null; opening: OpeningLook | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const paint = useCallback(
    (t: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      if (video && openingActive(t, opening) && opening.grade) {
        ctx.drawImage(video, 0, 0, WIDTH, HEIGHT)
        drawCinemaLook(ctx, opening.grade, t, lookOpacity(t, opening), WIDTH, HEIGHT)
        canvas.style.visibility = 'visible'
      } else {
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        canvas.style.visibility = 'hidden'
      }
    },
    [video, opening],
  )

  useVideoFrameTime(video, paint)

  return <canvas ref={canvasRef} className={styles.canvas} width={WIDTH} height={HEIGHT} style={{ visibility: 'hidden' }} data-testid="opening-look" />
}
