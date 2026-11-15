import { useEffect, useRef, useState } from 'react'
import { shapeVoice, type HeardVoice } from '../utils/voiceEffects'
import styles from './VoiceTry.module.css'

/** How long the sample said into the mic is. */
const SAMPLE_SECONDS = 3

interface Sample {
  samples: Float32Array
  sampleRate: number
}

// One sample for the whole session, so every line's voice is tried on the same words.
let kept: Sample | null = null

function audioContext(): AudioContext {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new Ctor()
}

async function recordSample(): Promise<Sample> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  try {
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = e => chunks.push(e.data)
    const stopped = new Promise<void>(resolve => (recorder.onstop = () => resolve()))
    recorder.start()
    await new Promise(resolve => setTimeout(resolve, SAMPLE_SECONDS * 1000))
    recorder.stop()
    await stopped
    const ctx = audioContext()
    try {
      const decoded = await ctx.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer())
      const samples = new Float32Array(decoded.length)
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = decoded.getChannelData(c)
        for (let i = 0; i < data.length; i++) samples[i] += data[i] / decoded.numberOfChannels
      }
      return { samples, sampleRate: decoded.sampleRate }
    } finally {
      void ctx.close()
    }
  } finally {
    stream.getTracks().forEach(track => track.stop())
  }
}

/**
 * 試し聞き for a 相手の声: say a few words into the mic once, then hear them
 * in `voice` (made as the import makes it, see shapeVoice) — and in any
 * other voice picked after, on the same words.
 */
export default function VoiceTry({ voice }: { voice: HeardVoice }) {
  const [state, setState] = useState<'idle' | 'recording' | 'playing'>('idle')
  const [hasSample, setHasSample] = useState(kept !== null)
  const [error, setError] = useState<string | null>(null)
  const playing = useRef<{ ctx: AudioContext } | null>(null)

  useEffect(() => () => void playing.current?.ctx.close(), [])

  function stop() {
    void playing.current?.ctx.close()
    playing.current = null
    setState('idle')
  }

  function play(sample: Sample) {
    stop()
    const shaped = shapeVoice(sample.samples, sample.sampleRate, voice)
    const ctx = audioContext()
    const buffer = ctx.createBuffer(1, Math.max(1, shaped.length), sample.sampleRate)
    buffer.getChannelData(0).set(shaped)
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (playing.current?.ctx === ctx) stop()
    }
    playing.current = { ctx }
    setState('playing')
    node.start()
  }

  async function record() {
    stop()
    setError(null)
    setState('recording')
    try {
      kept = await recordSample()
      setHasSample(true)
      play(kept)
    } catch (err) {
      console.warn('Could not record a sample to try the voice on', err)
      setError('マイクで録音できませんでした')
      setState('idle')
    }
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        disabled={state === 'recording'}
        onClick={() => (state === 'playing' ? stop() : kept ? play(kept) : void record())}
      >
        {state === 'recording' ? `🎙 話してください（${SAMPLE_SECONDS}秒）` : state === 'playing' ? '■ 止める' : '▶ 試し聞き'}
      </button>
      {hasSample && state === 'idle' && (
        <button type="button" className={styles.link} onClick={() => void record()}>
          録り直す
        </button>
      )}
      {!hasSample && state === 'idle' && <span className={styles.hint}>はじめに一言録ります</span>}
      {error && <span className={styles.hint}>{error}</span>}
    </span>
  )
}
