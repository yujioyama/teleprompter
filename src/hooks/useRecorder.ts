import { useRef, useState, type RefObject } from 'react'
import { shareOrDownload as shareBlob } from '../utils/shareOrDownload'
import {
  processRecordedVideo,
  inferMimeType,
  isRemuxableContainer,
  type ShotTrimSettings,
} from '../utils/processRecordedVideo'

export type RecordState = 'idle' | 'recording' | 'stopped' | 'remuxing'

export type { ShotTrimSettings }

interface UseRecorderResult {
  state: RecordState
  remuxOk: boolean | null
  remuxError: string | null
  startRecording: (stream: MediaStream, shotSettings: ShotTrimSettings) => void
  stopRecording: () => void
  importFile: (file: File, shotSettings: ShotTrimSettings) => Promise<void>
  shareOrDownload: (filename: string) => Promise<boolean>
  reset: () => void
  blobRef: Readonly<RefObject<Blob | null>>
}

function getSupportedMimeType(): string {
  const types = ['video/mp4', 'video/webm;codecs=h264', 'video/webm']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
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
      // Explicit video bitrate cap: default iOS MediaRecorder can exceed 10 Mbps,
      // exhausting the encoder's internal buffer after ~10 s and stopping video early.
      // 2.5 Mbps gives excellent quality while keeping buffer usage well within limits.
      videoBitsPerSecond: 2_500_000,
    })
    recorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const raw = new Blob(chunksRef.current, {
        type: mimeType || 'video/webm',
      })
      await processFinishedBlob(raw, mimeType, shotSettings)
    }

    // Flush data every second — prevents the iOS video encoder's internal buffer from
    // accumulating too much data and stopping video capture mid-recording.
    recorder.start(1000)
    setState('recording')
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  // Shared by both a just-finished MediaRecorder take and an imported camera-roll file,
  // so trim/normalize/remux behave identically regardless of where the video came from.
  async function processFinishedBlob(raw: Blob, mimeType: string, shotSettings: ShotTrimSettings) {
    const remuxable = isRemuxableContainer(mimeType)
    if (remuxable) {
      setState('remuxing')
    }

    const result = await processRecordedVideo(raw, mimeType, shotSettings)
    blobRef.current = result.blob
    if (remuxable) {
      // remuxMp4's output is always video/mp4, regardless of the input container.
      mimeTypeRef.current = 'video/mp4'
    }
    setRemuxOk(result.ok)
    setRemuxError(result.error)

    setState('stopped')
  }

  async function importFile(file: File, shotSettings: ShotTrimSettings) {
    if (state !== 'idle') return
    const mimeType = inferMimeType(file)
    mimeTypeRef.current = mimeType
    chunksRef.current = []
    blobRef.current = null
    setRemuxOk(null)
    setRemuxError(null)
    await processFinishedBlob(file, mimeType, shotSettings)
  }

  async function shareOrDownload(filename: string): Promise<boolean> {
    if (!blobRef.current) return false
    return shareBlob(blobRef.current, filename)
  }

  function reset() {
    blobRef.current = null
    chunksRef.current = []
    recorderRef.current = null
    setRemuxOk(null)
    setRemuxError(null)
    setState('idle')
  }

  return { state, remuxOk, remuxError, startRecording, stopRecording, importFile, shareOrDownload, reset, blobRef }
}
