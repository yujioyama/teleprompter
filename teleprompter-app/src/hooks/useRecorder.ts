import { useRef, useState, type RefObject } from 'react'
import { remuxMp4 } from '../utils/remuxMp4'

export type RecordState = 'idle' | 'recording' | 'stopped' | 'remuxing'

interface UseRecorderResult {
  state: RecordState
  remuxOk: boolean | null
  startRecording: (stream: MediaStream) => void
  stopRecording: () => void
  shareOrDownload: (filename: string) => Promise<void>
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
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const mimeTypeRef = useRef<string>('')

  function startRecording(stream: MediaStream) {
    const mimeType = getSupportedMimeType()
    mimeTypeRef.current = mimeType
    chunksRef.current = []
    blobRef.current = null
    setRemuxOk(null)

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    recorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const raw = new Blob(chunksRef.current, {
        type: mimeType || 'video/webm',
      })

      // Remux MP4 to move moov atom to front (faststart) for editor compatibility
      if (mimeType.includes('mp4')) {
        setState('remuxing')
        const result = await remuxMp4(raw)
        blobRef.current = result.blob
        setRemuxOk(result.ok)
      } else {
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

  async function shareOrDownload(filename: string): Promise<void> {
    if (!blobRef.current) return

    const ext = getExtension(mimeTypeRef.current)
    const fullName = `${filename}.${ext}`
    const file = new File([blobRef.current], fullName, {
      type: mimeTypeRef.current || 'video/webm',
    })

    // Try Web Share API first (saves to camera roll on iOS Safari 15+)
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fullName })
        return
      } catch (err) {
        // User cancelled share or share failed - fall through to download
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    // Fallback: trigger download
    const url = URL.createObjectURL(blobRef.current)
    const a = document.createElement('a')
    a.href = url
    a.download = fullName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  function reset() {
    blobRef.current = null
    chunksRef.current = []
    recorderRef.current = null
    setRemuxOk(null)
    setState('idle')
  }

  return { state, remuxOk, startRecording, stopRecording, shareOrDownload, reset, blobRef }
}
