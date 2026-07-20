import { useRef, useState, type RefObject } from 'react'
import { remuxMp4 } from '../utils/remuxMp4'
import { detectSpeechBounds } from '../utils/detectSpeechBounds'

export type RecordState = 'idle' | 'recording' | 'stopped' | 'remuxing'

export interface ShotTrimSettings {
  trimEnabled: boolean
  trimPaddingStart: number
  trimPaddingEnd: number
  normalizeAudio: boolean
}

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

function getExtension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

// mov and mp4 are both the ISO base media container (ffmpeg's mov,mp4,m4a,3gp,3g2,mj2
// demuxer handles either identically), so a .mov clip imported from the camera roll
// (e.g. from the native Cinematic-capture companion app) is just as remuxable as mp4.
function isRemuxableContainer(mimeType: string): boolean {
  return mimeType.includes('mp4') || mimeType.includes('quicktime')
}

function inferMimeType(file: File): string {
  if (file.type) return file.type
  if (/\.mov$/i.test(file.name)) return 'video/quicktime'
  if (/\.mp4$/i.test(file.name)) return 'video/mp4'
  return 'video/webm'
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
    // Remux to move the moov atom to the front (faststart) for editor compatibility.
    // Also detect and trim leading/trailing silence in the same FFmpeg pass.
    if (isRemuxableContainer(mimeType)) {
      setState('remuxing')
      let trim = null
      if (shotSettings.trimEnabled) {
        trim = await detectSpeechBounds(raw, shotSettings.trimPaddingStart, shotSettings.trimPaddingEnd)
      }
      const result = await remuxMp4(raw, {
        trim: trim ?? undefined,
        normalize: shotSettings.normalizeAudio,
      })
      blobRef.current = result.blob
      // remuxMp4's output is always video/mp4, regardless of the input container.
      mimeTypeRef.current = 'video/mp4'
      setRemuxOk(result.ok)
      setRemuxError(result.error ?? null)
    } else {
      // webm: trimming not supported, silently ignored
      blobRef.current = raw
      setRemuxOk(true)
    }

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

    const ext = getExtension(mimeTypeRef.current)
    const fullName = `${filename}.${ext}`
    const file = new File([blobRef.current], fullName, {
      type: mimeTypeRef.current || 'video/webm',
    })

    // Try Web Share API first (saves to camera roll on iOS Safari 15+)
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

  return { state, remuxOk, remuxError, startRecording, stopRecording, importFile, shareOrDownload, reset, blobRef }
}
