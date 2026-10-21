import { useEffect, useState } from 'react'
import { finishAudio } from '../utils/normalizeLoudness'
import { isNoFinish, type AudioFinish } from '../utils/audioFinish'
import { useObjectUrl } from './useObjectUrl'

export type LoudnessState = 'idle' | 'normalizing' | 'failed'

interface Finished {
  blob: Blob | null
  loudness: LoudnessState
}

const NOTHING: Finished = { blob: null, loudness: 'idle' }

/**
 * What the export step previews and saves: `finalBlob` with `finish`
 * applied to its audio, or `finalBlob` itself when there's nothing to
 * apply. Null while `finalBlob` is (off the export step) and while the
 * audio is being finished. If finishing fails, the video is still there to
 * save with its audio as it was, and `loudness` says so.
 */
export function useExport(finalBlob: Blob | null, finish: AudioFinish) {
  const [finished, setFinished] = useState<Finished>(NOTHING)
  const { voice, normalize } = finish

  useEffect(() => {
    if (!finalBlob) {
      setFinished(NOTHING)
      return
    }
    const wanted: AudioFinish = { voice, normalize }
    if (isNoFinish(wanted)) {
      setFinished({ blob: finalBlob, loudness: 'idle' })
      return
    }
    let cancelled = false
    setFinished({ blob: null, loudness: 'normalizing' })
    finishAudio(finalBlob, wanted).then(
      normalized => {
        if (!cancelled) setFinished({ blob: normalized, loudness: 'idle' })
      },
      err => {
        if (cancelled) return
        console.warn('[useExport] finishing the audio failed:', err)
        setFinished({ blob: finalBlob, loudness: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [finalBlob, voice, normalize])

  const url = useObjectUrl(finished.blob)
  return { blob: finished.blob, url, loudness: finished.loudness }
}
