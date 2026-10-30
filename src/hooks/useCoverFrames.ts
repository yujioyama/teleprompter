import { useEffect, useState } from 'react'
import { insertCoverFrames, type CoverFramePlacement } from '../utils/coverFrames'
import { useObjectUrl } from './useObjectUrl'

export type CoverFramesState = 'idle' | 'inserting' | 'failed'

interface Covered {
  blob: Blob | null
  state: CoverFramesState
}

const NOTHING: Covered = { blob: null, state: 'idle' }

// One insert at a time: each holds a whole copy of the video, more than an
// iPhone can spare twice over when the settings are changed quickly.
let queue: Promise<unknown> = Promise.resolve()

/**
 * The export's video with the cover image put in as frames of its own (see
 * insertCoverFrames): `video` itself when there's no image or the
 * placement is `none`, so the output is then exactly what it was without
 * this step. Null while `video` is, and while the frames go in. If that
 * fails, `video` is still there to save without them, and `state` says so.
 */
export function useCoverFrames(
  video: Blob | null,
  image: Blob | null,
  placement: CoverFramePlacement,
  count: number,
) {
  const [covered, setCovered] = useState<Covered>(NOTHING)

  useEffect(() => {
    if (!video) {
      setCovered(NOTHING)
      return
    }
    if (!image || placement === 'none') {
      setCovered({ blob: video, state: 'idle' })
      return
    }
    let cancelled = false
    setCovered({ blob: null, state: 'inserting' })
    // Skipped once superseded while waiting its turn.
    const run = queue.then(() => (cancelled ? null : insertCoverFrames(video, image, placement, count)))
    queue = run.catch(() => {})
    run.then(
      blob => {
        if (!cancelled && blob) setCovered({ blob, state: 'idle' })
      },
      err => {
        if (cancelled) return
        console.warn('[useCoverFrames] inserting the cover frames failed:', err)
        setCovered({ blob: video, state: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [video, image, placement, count])

  const url = useObjectUrl(covered.blob)
  return { blob: covered.blob, url, state: covered.state }
}
