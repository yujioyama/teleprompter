import { useRef, useState, type RefObject } from 'react'
import {
  processRecordedVideo,
  inferMimeType,
  isRemuxableContainer,
  type ProcessOptions,
} from '../utils/processRecordedVideo'
import { releaseFFmpeg } from '../utils/ffmpegClient'

// Takes are recorded in the native teleprompter-cam app and imported here;
// the page has no camera of its own.
export type RecordState = 'idle' | 'stopped' | 'remuxing'

interface UseRecorderResult {
  state: RecordState
  importFile: (file: File, options: ProcessOptions) => Promise<void>
  reset: () => void
  blobRef: Readonly<RefObject<Blob | null>>
}

export function useRecorder(): UseRecorderResult {
  const [state, setState] = useState<RecordState>('idle')
  const blobRef = useRef<Blob | null>(null)

  async function importFile(file: File, options: ProcessOptions) {
    if (state !== 'idle') return
    const mimeType = inferMimeType(file)
    blobRef.current = null
    const remuxable = isRemuxableContainer(mimeType)
    if (remuxable) {
      setState('remuxing')
    }

    const result = await processRecordedVideo(file, mimeType, options)
    // Free ffmpeg.wasm's grown heap before the user moves on to finalize.
    if (remuxable) releaseFFmpeg()
    blobRef.current = result.blob
    setState('stopped')
  }

  function reset() {
    blobRef.current = null
    setState('idle')
  }

  return { state, importFile, reset, blobRef }
}
