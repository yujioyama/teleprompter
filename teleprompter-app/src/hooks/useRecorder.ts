import { useRef, useState, type RefObject } from 'react'
import { remuxMp4 } from '../utils/remuxMp4'
import { detectSpeechBounds } from '../utils/detectSpeechBounds'

export type RecordState = 'idle' | 'recording' | 'stopped' | 'remuxing'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
}

interface UseRecorderResult {
  state: RecordState
  remuxOk: boolean | null
  remuxError: string | null
  startRecording: (stream: MediaStream, shotSettings: ShotTrimSettings) => void
  stopRecording: () => void
  shareOrDownload: (filename: string) => Promise<boolean>
  reset: () => void
  blobRef: Readonly<RefObject<Blob | null>>
}

function getSupportedMimeType(): string {
  const types = ['video/mp4', 'video/webm;codecs=h264', 'video/webm']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

function getExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

export function useRecorder(): UseRecorderResult {
  const [state, setState] = useState<RecordState>('idle')
  const [remuxOk, setRemuxOk] = useState<boolean | null>(null)
  const [remuxError, setRemuxError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const mimeTypeRef = useRef<string>('')

  function startRecording(stream: MediaStream, shotSettings: ShotTrimSettings) {
    const mimeType = getSupportedMimeType()
    mimeTypeRef.current = mimeType
    chunksRef.current = []
    blobRef.current = null
    setRemuxOk(null)
    setRemuxError(null)

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 256_000,
    })
    recorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const raw = new Blob(chunksRef.current, {
        type: mimeType || 'video/webm',
      })

      // Remux MP4 to move moov atom to front (faststart) for editor compatibility.
      // Also detect and trim leading/trailing silence in the same FFmpeg pass.
      if (mimeType.includes('mp4')) {
        setState('remuxing')
        let trim = null
        if (shotSettings.trimEnabled) {
          trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
        }
        const result = await remuxMp4(raw, { trim: trim ?? undefined })
        blobRef.current = result.blob
        setRemuxOk(result.ok)
        setRemuxError(result.error ?? null)
      } else {
        // webm: trimming not supported, silently ignored
        blobRef.current = raw
        setRemuxOk(true)
      }

      setState('stopped')
    }

    recorder.start() // collect all data at once on stop
    setState('recording')
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  async function shareOrDownload(filename: string): Promise<boolean> {
    if (!blobRef.current) return false

    const ext = getExtension(mimeTypeRef.current)
    const fullName = `${filename}.${ext}`
    const file = new File([blobRef.current], fullName, {
      type: mimeTypeRef.current || 'video/webm',
    })

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fullName })
        return true
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return false
        // Non-AbortError: share API failed for other reason — fall through to download fallback
      }
    }

    // Fallback: trigger download (always succeeds)
    const url = URL.createObjectURL(blobRef.current)
    const a = document.createElement('a')
    a.href = url
    a.download = fullName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
    return true
  }

  function reset() {
    blobRef.current = null
    chunksRef.current = []
    recorderRef.current = null
    setRemuxOk(null)
    setRemuxError(null)
    setState('idle')
  }

  return { state, remuxOk, remuxError, startRecording, stopRecording, shareOrDownload, reset, blobRef }
}
