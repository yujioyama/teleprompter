import { useEffect, useRef, useState } from 'react'
import { drawOpeningCard, layoutOpening, type OpeningCardPlan } from '../utils/openingCard'
import { firstFrameOf } from '../utils/webcodecs/openingClip'
import { openingVoiceByKey } from '../utils/webcodecs/openingVoice'
import styles from './OpeningCardPreview.module.css'

// Drawn at the output's size, shown small.
const WIDTH = 1080
const HEIGHT = 1920

/**
 * 冒頭カード as the video will open with it: line 1's first frame (from
 * `video`, the 結合, which starts with line 1) under the curtain, typed out
 * as it will be burned in, with its voice. Shows the last frame before the
 * curtain lifts until played.
 */
export default function OpeningCardPreview({ plan, video }: { plan: OpeningCardPlan; video: Blob }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<OffscreenCanvas | null>(null)
  const [playing, setPlaying] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let got: OffscreenCanvas | null = null
    firstFrameOf(video, 0).then(
      canvas => {
        got = canvas
        if (!cancelled) setFrame(canvas)
      },
      err => console.warn('[OpeningCardPreview] could not get line 1\'s first frame:', err),
    )
    return () => {
      cancelled = true
      if (got) {
        got.width = 0
        got.height = 0
      }
    }
  }, [video])

  // The still: everything typed, the Japanese in, the curtain still down.
  useEffect(() => {
    if (playing) return
    draw(canvasRef.current, frame, plan, Math.max(0, plan.timing.wipeAt - 0.05))
  }, [frame, plan, playing])

  useEffect(() => () => stopRef.current?.(), [])

  async function play() {
    stopRef.current?.()
    setPlaying(true)
    let audio: AudioContext | null = null
    try {
      const voice = plan.voiceKey ? await openingVoiceByKey(plan.voiceKey) : null
      if (voice && plan.timing.voiceAt !== null) {
        audio = new AudioContext()
        const buffer = audio.createBuffer(1, voice.samples.length, voice.sampleRate)
        buffer.getChannelData(0).set(voice.samples)
        const node = audio.createBufferSource()
        node.buffer = buffer
        node.connect(audio.destination)
        node.start(audio.currentTime + plan.timing.voiceAt)
      }
    } catch (err) {
      console.warn('[OpeningCardPreview] could not play the voice:', err)
    }
    const start = performance.now()
    let raf = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      void audio?.close().catch(() => undefined)
      stopRef.current = null
      setPlaying(false)
    }
    stopRef.current = stop
    const tick = () => {
      const t = (performance.now() - start) / 1000
      draw(canvasRef.current, frame, plan, Math.min(t, plan.timing.seconds))
      if (t >= plan.timing.seconds + 0.4) stop()
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }

  return (
    <div className={styles.preview}>
      <canvas ref={canvasRef} className={styles.canvas} width={WIDTH / 4} height={HEIGHT / 4} aria-label="冒頭カードのプレビュー" />
      <div className={styles.body}>
        <span className={styles.title}>冒頭カード</span>
        <span className={styles.meta}>
          {plan.timing.seconds.toFixed(1)}秒・{plan.voiceKey ? '声に合わせて打ちます' : '声なし（カメラアプリで録れます）'}
        </span>
        <button type="button" className={styles.play} onClick={() => (playing ? stopRef.current?.() : void play())}>
          {playing ? '停止' : '▶ 再生'}
        </button>
      </div>
    </div>
  )
}

function draw(canvas: HTMLCanvasElement | null, frame: OffscreenCanvas | null, plan: OpeningCardPlan, t: number) {
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.save()
  ctx.scale(canvas.width / WIDTH, canvas.height / HEIGHT)
  const measure = (text: string, font: string) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
  drawOpeningCard(ctx, frame, layoutOpening(plan.text, WIDTH, HEIGHT, measure, plan.ja), plan.timing, t)
  ctx.restore()
}
