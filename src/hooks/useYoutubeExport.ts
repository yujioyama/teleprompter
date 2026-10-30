import { useEffect, useState } from 'react'
import { mixYoutubeVersion, type YoutubeBgmSwap } from '../utils/youtubeVersion'
import { useObjectUrl } from './useObjectUrl'

export type YoutubeExportState = 'idle' | 'making' | 'failed'

interface Made {
  blob: Blob | null
  state: YoutubeExportState
}

const NOTHING: Made = { blob: null, state: 'idle' }

/**
 * The export's YouTube version. `finished` is the normal version before its
 * cover frames go in; null while there's to be no YouTube version, or the
 * normal one isn't ready yet (they're made one after the other, not side by
 * side, to spare an iPhone's memory). With no BGM on the normal version
 * there is none to swap, and the YouTube version is `finished` itself.
 * Null while it's being made; if that fails, `blob` stays null and `state`
 * says so, leaving the normal version to save on its own.
 */
export function useYoutubeExport(finished: Blob | null, swap: YoutubeBgmSwap | null) {
  const [made, setMade] = useState<Made>(NOTHING)

  useEffect(() => {
    if (!finished) {
      setMade(NOTHING)
      return
    }
    if (!swap) {
      setMade({ blob: finished, state: 'idle' })
      return
    }
    let cancelled = false
    setMade({ blob: null, state: 'making' })
    mixYoutubeVersion(swap).then(
      blob => {
        if (!cancelled) setMade({ blob, state: 'idle' })
      },
      err => {
        if (cancelled) return
        console.warn('[useYoutubeExport] making the YouTube version failed:', err)
        setMade({ blob: null, state: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [finished, swap])

  const url = useObjectUrl(made.blob)
  return { blob: made.blob, url, state: made.state }
}
